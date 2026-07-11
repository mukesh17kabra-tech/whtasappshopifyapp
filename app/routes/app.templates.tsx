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

  if (!shop) return json({ templates: [] });

  const templates = await prisma.template.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
  });

  return json({
    templates: templates.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
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

  const name = String(formData.get("name") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const category = String(formData.get("category") ?? "UTILITY");
  const imageUrl = String(formData.get("imageUrl") ?? "").trim() || null;

  if (!name || !body) {
    return json({ error: "Name and message body are required" }, { status: 400 });
  }

  await prisma.template.create({
    data: {
      shopId: shop.id,
      name,
      body,
      category,
      imageUrl,
      // Composed entirely in-app — no Meta approval step in this flow.
      // See README for the compliance tradeoff of sending unapproved
      // freeform content via the official WhatsApp Cloud API.
      status: "draft",
    },
  });

  return json({ success: true });
}

export default function Templates() {
  const { templates } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("MARKETING");
  const [imageUrl, setImageUrl] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isSaving = navigation.state === "submitting";

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
  const handleImageSelect = useCallback(async (file: File) => {
    setImageUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload-image", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok && data.url) {
        setImageUrl(data.url);
      }
    } catch (err) {
      console.error("Image upload failed", err);
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

  // Live preview: swap {tags} for readable sample values so the merchant can
  // see roughly what the customer will receive.
  const previewText = ORDER_VARIABLES.reduce(
    (text, v) => text.split(v.tag).join(sampleValue(v.tag)),
    body || "Your message preview will appear here...",
  );

  const rows = templates.map((t) => [
    t.name,
    <Badge key={`${t.id}-cat`} tone={t.category === "MARKETING" ? "attention" : "info"}>
      {t.category}
    </Badge>,
    t.imageUrl ? (
      <Thumbnail key={`${t.id}-img`} source={t.imageUrl} alt={t.name} size="small" />
    ) : (
      "—"
    ),
    new Date(t.createdAt).toLocaleDateString(),
    <Button key={`${t.id}-del`} variant="plain" tone="critical" onClick={() => handleDelete(t.id)}>
      Remove
    </Button>,
  ]);

  return (
    <Page title="Message Templates">
      <BlockStack gap="400">
        <Banner tone="info">
          Templates you create here are composed entirely in this app — no
          Meta or Google approval step in this flow. If you're sending via
          the official WhatsApp Cloud API, keep in mind Meta still requires
          marketing broadcasts to use an approved template; using unapproved
          freeform content works only with an unofficial WhatsApp connection,
          which risks your number getting banned. Ask if you want help
          weighing that tradeoff.
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
                    Insert a dynamic tag — click to add at your cursor:
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
                headings={["Name", "Category", "Image", "Created", ""]}
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
