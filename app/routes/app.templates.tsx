import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { useCallback, useRef, useState } from "react";
import {
  Page,
  Card,
  DataTable,
  Text,
  BlockStack,
  InlineStack,
  TextField,
  Select,
  Button,
  Banner,
  Badge,
  EmptyState,
  Thumbnail,
  Box,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { submitMetaTemplate, checkMetaTemplateStatus, convertToMetaPlaceholders } from "~/services/meta-templates.server";

// Variables a merchant can insert into a template body. These get substituted
// with real order/customer data at send time (see services/template.server.ts).
const ORDER_VARIABLES = [
  { label: "First Name", tag: "{first_name}" },
  { label: "Last Name", tag: "{last_name}" },
  { label: "Order ID", tag: "{order_id}" },
  { label: "Order Number", tag: "{order_number}" },
  { label: "Order Date", tag: "{order_date}" },
  { label: "Order URL", tag: "{order_url}" },
  { label: "Order Total", tag: "{order_total}" },
  { label: "Tracking Number", tag: "{tracking_number}" },
  { label: "Tracking Company", tag: "{tracking_company}" },
  { label: "Tracking URL", tag: "{tracking_url}" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });

  if (!shop) return json({ templates: [], connected: false });

  const templates = await prisma.template.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
  });

  return json({
    templates: templates.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
    connected: Boolean(shop.whatsappAccessToken && shop.whatsappPhoneNumberId),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    const id = String(formData.get("id"));
    await prisma.template.delete({ where: { id } });
    return json({ success: true });
  }

  if (intent === "submit") {
    const id = String(formData.get("id"));
    const template = await prisma.template.findUnique({ where: { id } });
    if (!template || template.shopId !== shop.id) {
      return json({ error: "Template not found" }, { status: 404 });
    }

    if (!shop.whatsappBusinessAccountId || !shop.whatsappAccessToken) {
      return json(
        { error: "Connect your WhatsApp Business Account first — see the Connect WhatsApp page." },
        { status: 400 },
      );
    }

    const result = await submitMetaTemplate({
      displayName: template.name,
      category: template.category as "MARKETING" | "UTILITY",
      body: template.body,
      imageUrl: template.imageUrl,
      businessAccountId: shop.whatsappBusinessAccountId,
      accessToken: shop.whatsappAccessToken,
    });

    if (!result.success) {
      await prisma.template.update({
        where: { id },
        data: { status: "rejected", rejectionReason: result.error },
      });
      return json({ error: result.error }, { status: 400 });
    }

    await prisma.template.update({
      where: { id },
      data: {
        whatsappTemplateId: result.metaTemplateId,
        status: result.status,
        rejectionReason: null,
      },
    });

    return json({ success: true });
  }

  if (intent === "refresh-status") {
    const id = String(formData.get("id"));
    const template = await prisma.template.findUnique({ where: { id } });
    if (!template?.whatsappTemplateId || template.shopId !== shop.id) {
      return json({ error: "Not submitted yet" }, { status: 400 });
    }

    if (!shop.whatsappAccessToken) {
      return json({ error: "WhatsApp not connected for this shop" }, { status: 400 });
    }

    const result = await checkMetaTemplateStatus(template.whatsappTemplateId, shop.whatsappAccessToken);
    if (!result.success) {
      return json({ error: result.error }, { status: 400 });
    }

    await prisma.template.update({
      where: { id },
      data: {
        status: result.status,
        rejectionReason: result.rejectionReason ?? null,
      },
    });

    return json({ success: true });
  }

  const name = String(formData.get("name") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const category = String(formData.get("category") ?? "UTILITY");
  const imageUrl = String(formData.get("imageUrl") ?? "").trim() || null;

  if (!name || !body) {
    return json({ error: "Name and message body are required" }, { status: 400 });
  }

  const { variableKeys } = convertToMetaPlaceholders(body);

  await prisma.template.create({
    data: {
      shopId: shop.id,
      name,
      body,
      category,
      imageUrl,
      variableKeys: JSON.stringify(variableKeys),
      // Composed in-app; submit for Meta approval separately via the
      // "Submit for approval" button once you're happy with the wording.
      status: "draft",
    },
  });

  return json({ success: true });
}

export default function Templates() {
  const { templates, connected } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("MARKETING");
  const [imageUrl, setImageUrl] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [discountCode, setDiscountCode] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isSaving = navigation.state === "submitting";

  // Inserts literal text (not a {tag}) at the cursor — used for product/
  // collection links and discount codes, since those are the same for every
  // recipient in a broadcast rather than per-customer data.
  const insertText = useCallback(
    (text: string) => {
      const el = bodyRef.current;
      if (!el) {
        setBody((prev) => `${prev} ${text}`);
        return;
      }
      const start = el.selectionStart ?? body.length;
      const end = el.selectionEnd ?? body.length;
      const next = body.slice(0, start) + text + body.slice(end);
      setBody(next);
      requestAnimationFrame(() => {
        el.focus();
        el.selectionStart = el.selectionEnd = start + text.length;
      });
    },
    [body],
  );

  // Insert a variable tag at the current cursor position in the textarea,
  // rather than always appending to the end.
  const insertVariable = useCallback(
    (tag: string) => {
      const el = bodyRef.current;
      if (!el) {
        setBody((prev) => `${prev} ${tag}`);
        return;
      }
      const start = el.selectionStart ?? body.length;
      const end = el.selectionEnd ?? body.length;
      const next = body.slice(0, start) + tag + body.slice(end);
      setBody(next);
      requestAnimationFrame(() => {
        el.focus();
        el.selectionStart = el.selectionEnd = start + tag.length;
      });
    },
    [body],
  );

  // Uploads the image to our own /api/upload-image route, which stores it
  // and returns a public URL — this is a lightweight image host for template
  // headers, not a Meta/Google integration.
  const [imageUploadError, setImageUploadError] = useState("");

  const handleImageSelect = useCallback(async (file: File) => {
    setImageUploading(true);
    setImageUploadError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload-image", { method: "POST", body: formData });

      let data;
      try {
        data = await res.json();
      } catch {
        setImageUploadError("Upload failed — got an unexpected response from the server.");
        return;
      }

      if (!res.ok) {
        setImageUploadError(data.error || "Upload failed.");
        return;
      }

      if (data.url) {
        setImageUrl(data.url);
      }
    } catch (err) {
      setImageUploadError("Network error — check your connection and try again.");
    } finally {
      setImageUploading(false);
    }
  }, []);

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("name", name);
    formData.append("body", body);
    formData.append("category", category);
    formData.append("imageUrl", imageUrl);
    submit(formData, { method: "post" });
    setName("");
    setBody("");
    setImageUrl("");
  }, [name, body, category, imageUrl, submit]);

  const handleDelete = useCallback(
    (id: string) => {
      const formData = new FormData();
      formData.append("intent", "delete");
      formData.append("id", id);
      submit(formData, { method: "post" });
    },
    [submit],
  );

  const handleSubmitForApproval = useCallback(
    (id: string) => {
      const formData = new FormData();
      formData.append("intent", "submit");
      formData.append("id", id);
      submit(formData, { method: "post" });
    },
    [submit],
  );

  const handleRefreshStatus = useCallback(
    (id: string) => {
      const formData = new FormData();
      formData.append("intent", "refresh-status");
      formData.append("id", id);
      submit(formData, { method: "post" });
    },
    [submit],
  );

  // Live preview: swap {tags} for readable sample values so the merchant can
  // see roughly what the customer will receive.
  const previewText = ORDER_VARIABLES.reduce(
    (text, v) => text.split(v.tag).join(sampleValue(v.tag)),
    body || "Your message preview will appear here...",
  );

  const rows = templates.map((t) => [
    <BlockStack key={`${t.id}-name`} gap="050">
      <Text as="span" fontWeight="medium">{t.name}</Text>
      {t.status === "rejected" && t.rejectionReason && (
        <Text as="span" variant="bodySm" tone="critical">
          {t.rejectionReason}
        </Text>
      )}
    </BlockStack>,
    <Badge key={`${t.id}-cat`} tone={t.category === "MARKETING" ? "attention" : "info"}>
      {t.category}
    </Badge>,
    <Badge
      key={`${t.id}-status`}
      tone={
        t.status === "approved"
          ? "success"
          : t.status === "rejected"
          ? "critical"
          : t.status === "pending"
          ? "warning"
          : undefined
      }
    >
      {t.status}
    </Badge>,
    t.imageUrl ? (
      <Thumbnail key={`${t.id}-img`} source={t.imageUrl} alt={t.name} size="small" />
    ) : (
      "—"
    ),
    <InlineStack key={`${t.id}-actions`} gap="200">
      {t.status === "draft" && (
        <Button size="slim" onClick={() => handleSubmitForApproval(t.id)}>
          Submit for approval
        </Button>
      )}
      {t.status === "pending" && (
        <Button size="slim" onClick={() => handleRefreshStatus(t.id)}>
          Refresh status
        </Button>
      )}
      {t.status === "rejected" && (
        <Button size="slim" onClick={() => handleSubmitForApproval(t.id)}>
          Resubmit
        </Button>
      )}
      <Button size="slim" variant="plain" tone="critical" onClick={() => handleDelete(t.id)}>
        Remove
      </Button>
    </InlineStack>,
  ]);

  return (
    <Page title="Message Templates">
      <BlockStack gap="400">
        {!connected && (
          <Banner tone="warning" action={{ content: "Connect WhatsApp", url: "/app/whatsapp-connect" }}>
            You haven't connected a WhatsApp Business Account yet — templates
            can be composed here, but submitting for approval or sending
            requires connecting first.
          </Banner>
        )}

        <Banner tone="info">
          Compose your message here, then click <strong>Submit for approval</strong> —
          this submits it directly to Meta's API for you, including the image
          if you added one. Approval is usually automatic within minutes to
          a few hours.
        </Banner>

        <InlineStack gap="400" align="start" wrap={false}>
          <Box width="55%">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Create a template
                </Text>

                <TextField
                  label="Template name"
                  value={name}
                  onChange={setName}
                  autoComplete="off"
                  placeholder="Diwali Sale Offer"
                />

                <Select
                  label="Category"
                  options={[
                    { label: "Marketing (offers/broadcasts)", value: "MARKETING" },
                    { label: "Utility (order/tracking updates)", value: "UTILITY" },
                  ]}
                  value={category}
                  onChange={setCategory}
                />

                <div>
                  <Text as="p" variant="bodyMd" fontWeight="medium">
                    Message
                  </Text>
                  <div style={{ marginTop: 4 }}>
                    <textarea
                      ref={bodyRef}
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      rows={6}
                      placeholder="Hello {first_name}, your order {order_id} is confirmed!"
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        border: "1px solid #c9cccf",
                        borderRadius: 8,
                        fontFamily: "inherit",
                        fontSize: 14,
                        resize: "vertical",
                      }}
                    />
                  </div>
                </div>

                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Insert a dynamic tag — click to add at your cursor.
                    <strong> First Name</strong> works in broadcast/marketing
                    templates too, since we capture that from the popup now.
                    The others (Order ID, Tracking URL, etc.) only work for
                    order confirmation/shipping templates, which have that
                    per-customer context — a broadcast with those will be
                    skipped rather than sent with wrong data.
                  </Text>
                  <InlineStack gap="150" wrap>
                    {ORDER_VARIABLES.map((v) => (
                      <Button key={v.tag} size="micro" onClick={() => insertVariable(v.tag)}>
                        {v.label}
                      </Button>
                    ))}
                  </InlineStack>
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" fontWeight="medium">
                    Product / Collection link + discount code
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Paste a product or collection URL from your store, add a
                    discount code if this offer has one, then click Insert to
                    drop them into your message. These are the same for every
                    recipient, so they're inserted as plain text.
                  </Text>
                  <InlineStack gap="200" blockAlign="end" wrap>
                    <Box minWidth="260px">
                      <TextField
                        label="Product or collection URL"
                        labelHidden
                        placeholder="https://yourstore.com/products/your-product"
                        value={linkUrl}
                        onChange={setLinkUrl}
                        autoComplete="off"
                      />
                    </Box>
                    <Button onClick={() => insertText(linkUrl)} disabled={!linkUrl}>
                      Insert link
                    </Button>
                    <Box minWidth="160px">
                      <TextField
                        label="Discount code"
                        labelHidden
                        placeholder="WHATSAPP20"
                        value={discountCode}
                        onChange={setDiscountCode}
                        autoComplete="off"
                      />
                    </Box>
                    <Button onClick={() => insertText(discountCode)} disabled={!discountCode}>
                      Insert code
                    </Button>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Tip: find the product/collection URL from your Shopify
                    admin — Products (or Collections) → open the item →
                    "View" on the storefront, then copy that page's URL.
                    Create the discount code first under Discounts in your
                    Shopify admin if you want to offer one.
                  </Text>
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" fontWeight="medium">
                    Image (optional)
                  </Text>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImageSelect(file);
                    }}
                  />
                  <InlineStack gap="200" blockAlign="center">
                    <Button onClick={() => fileInputRef.current?.click()} loading={imageUploading}>
                      {imageUrl ? "Change image" : "Upload image"}
                    </Button>
                    {imageUrl && (
                      <>
                        <Thumbnail source={imageUrl} alt="Template image" size="small" />
                        <Button variant="plain" tone="critical" onClick={() => setImageUrl("")}>
                          Remove
                        </Button>
                      </>
                    )}
                  </InlineStack>
                  {imageUploadError && (
                    <Text as="p" variant="bodySm" tone="critical">
                      {imageUploadError}
                    </Text>
                  )}
                </BlockStack>

                <Button
                  variant="primary"
                  onClick={handleSave}
                  loading={isSaving}
                  disabled={!name || !body}
                >
                  Save template
                </Button>
              </BlockStack>
            </Card>
          </Box>

          <Box width="45%">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Preview
                </Text>
                <div
                  style={{
                    background: "#e5ddd5",
                    borderRadius: 12,
                    padding: 16,
                  }}
                >
                  <div
                    style={{
                      background: "#fff",
                      borderRadius: 8,
                      padding: 12,
                      maxWidth: 320,
                      boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
                    }}
                  >
                    {imageUrl && (
                      <img
                        src={imageUrl}
                        alt="preview"
                        style={{
                          width: "100%",
                          borderRadius: 6,
                          marginBottom: 8,
                          display: "block",
                        }}
                      />
                    )}
                    <Text as="p" variant="bodyMd">
                      {previewText}
                    </Text>
                  </div>
                </div>
              </BlockStack>
            </Card>
          </Box>
        </InlineStack>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Your templates
            </Text>
            {rows.length > 0 ? (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text"]}
                headings={["Name", "Category", "Approval Status", "Image", "Actions"]}
                rows={rows}
              />
            ) : (
              <EmptyState heading="No templates yet" image="">
                <p>Create your first message template above.</p>
              </EmptyState>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

function sampleValue(tag: string): string {
  const samples: Record<string, string> = {
    "{first_name}": "Rahul",
    "{last_name}": "Sharma",
    "{order_id}": "1023",
    "{order_number}": "#1023",
    "{order_date}": "11 Jul 2026",
    "{order_url}": "https://yourstore.com/orders/1023",
    "{order_total}": "₹1,299",
    "{tracking_number}": "TRK123456789",
    "{tracking_company}": "Delhivery",
    "{tracking_url}": "https://track.delhivery.com/TRK123456789",
  };
  return samples[tag] ?? tag;
}
