import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useFetcher, useActionData } from "@remix-run/react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  Tabs,
  Autocomplete,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

const MARKETING_VARIABLES = [{ label: "First Name", tag: "{first_name}" }];

const ORDER_VARIABLES = [
  { label: "First Name", tag: "{first_name}" },
  { label: "Last Name", tag: "{last_name}" },
  { label: "Order ID", tag: "{order_id}" },
  { label: "Order Number", tag: "{order_number}" },
  { label: "Order Total", tag: "{order_total}" },
  { label: "Order URL", tag: "{order_url}" },
  { label: "Tracking Number", tag: "{tracking_number}" },
  { label: "Tracking Company", tag: "{tracking_company}" },
  { label: "Tracking URL", tag: "{tracking_url}" },
];

const ORDER_CATEGORIES = [
  { key: "ORDER_CONFIRMATION", label: "Order Confirmation" },
  { key: "SHIPPED", label: "Shipped" },
  { key: "OUT_FOR_DELIVERY", label: "Out for Delivery" },
  { key: "DELIVERED", label: "Delivered" },
  { key: "DELIVERY_ATTEMPTED", label: "Delivery Attempted" },
  { key: "DELIVERY_FAILED", label: "Delivery Failed" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });

  if (!shop) return json({ marketingTemplates: [], orderTemplates: [], connected: false });

  const allTemplates = await prisma.template.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
  });

  const marketingTemplates = allTemplates.filter((t) => t.category === "MARKETING");
  const orderCategoryKeys = ORDER_CATEGORIES.map((c) => c.key);
  const orderTemplates = allTemplates.filter((t) => orderCategoryKeys.includes(t.category));

  return json({
    marketingTemplates: marketingTemplates.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
    orderTemplates: orderTemplates.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
    connected: shop.whatsappBridgeConnected,
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
    try {
      await prisma.template.delete({ where: { id } });
    } catch (err) {
      // Most likely cause: already deleted (e.g. a double-click sent two
      // delete requests) — not a real error worth crashing the page over.
      console.warn(`Delete failed for template ${id}, likely already deleted`, err);
    }
    return json({ success: true });
  }

  const name = String(formData.get("name") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const category = String(formData.get("category") ?? "MARKETING");
  const imageUrl = String(formData.get("imageUrl") ?? "").trim() || null;

  if (!body) {
    return json({ error: "Message body is required" }, { status: 400 });
  }

  const isOrderCategory = ORDER_CATEGORIES.some((c) => c.key === category);

  try {
    if (isOrderCategory) {
      const existing = await prisma.template.findFirst({
        where: { shopId: shop.id, category },
        orderBy: { createdAt: "desc" },
      });

      if (existing) {
        await prisma.template.update({
          where: { id: existing.id },
          data: { body, imageUrl, name: name || existing.name },
        });
      } else {
        await prisma.template.create({
          data: {
            shopId: shop.id,
            name: name || ORDER_CATEGORIES.find((c) => c.key === category)?.label || category,
            body,
            category,
            imageUrl,
            status: "active",
          },
        });
      }
    } else {
      if (!name) {
        return json({ error: "Template name is required" }, { status: 400 });
      }
      await prisma.template.create({
        data: { shopId: shop.id, name, body, category: "MARKETING", imageUrl, status: "active" },
      });
    }
  } catch (err) {
    console.error("Failed to save template", err);
    const detail = err instanceof Error ? err.message : String(err);
    return json({ error: `Couldn't save template: ${detail}` }, { status: 500 });
  }

  return json({ success: true });
}

export default function Templates() {
  const { marketingTemplates, orderTemplates, connected } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [selectedTab, setSelectedTab] = useState(0);

  const isSaving = navigation.state === "submitting";
  const saveError = actionData && "error" in actionData ? actionData.error : null;

  const handleDelete = useCallback(
    (id: string) => {
      const formData = new FormData();
      formData.append("intent", "delete");
      formData.append("id", id);
      submit(formData, { method: "post" });
    },
    [submit],
  );

  return (
    <Page title="Message Templates">
      <BlockStack gap="400">
        {!connected && (
          <Banner tone="warning" action={{ content: "Connect WhatsApp", url: "/app/whatsapp-connect" }}>
            You haven't connected your WhatsApp number yet — templates can
            be composed here, but sending requires connecting first.
          </Banner>
        )}

        {saveError && <Banner tone="critical">{saveError}</Banner>}

        <Tabs
          tabs={[
            { id: "marketing", content: "Marketing" },
            { id: "order-notifications", content: "Order Notifications" },
          ]}
          selected={selectedTab}
          onSelect={setSelectedTab}
        />

        {selectedTab === 0 ? (
          <MarketingTab templates={marketingTemplates} isSaving={isSaving} onDelete={handleDelete} submit={submit} />
        ) : (
          <OrderTab templates={orderTemplates} isSaving={isSaving} submit={submit} />
        )}
      </BlockStack>
    </Page>
  );
}

function MarketingTab({ templates, isSaving, onDelete, submit }: any) {
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadError, setImageUploadError] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resourcesFetcher = useFetcher<{ products: any[]; collections: any[]; discounts: any[] }>();

  const [linkType, setLinkType] = useState<"product" | "collection">("product");
  const [selectedLink, setSelectedLink] = useState("");
  const [linkSearch, setLinkSearch] = useState("");
  const [selectedDiscount, setSelectedDiscount] = useState("");
  const [discountSearch, setDiscountSearch] = useState("");

  useEffect(() => {
    resourcesFetcher.load("/api/store-resources");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const products = resourcesFetcher.data?.products ?? [];
  const collections = resourcesFetcher.data?.collections ?? [];
  const discounts = resourcesFetcher.data?.discounts ?? [];
  const linkOptions = linkType === "product" ? products : collections;

  const filteredLinkOptions = linkSearch
    ? linkOptions.filter((item: any) => item.title.toLowerCase().includes(linkSearch.toLowerCase()))
    : linkOptions;

  const filteredDiscounts = discountSearch
    ? discounts.filter((d: any) =>
        d.title.toLowerCase().includes(discountSearch.toLowerCase()) ||
        d.code.toLowerCase().includes(discountSearch.toLowerCase()),
      )
    : discounts;

  const insertAtCursor = useCallback(
    (text: string) => {
      const el = bodyRef.current;
      if (!el) {
        setBody((prev: string) => `${prev} ${text}`);
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
        setImageUploadError("Upload failed — unexpected response from server.");
        return;
      }
      if (!res.ok) {
        setImageUploadError(data.error || "Upload failed.");
        return;
      }
      if (data.url) setImageUrl(data.url);
    } catch {
      setImageUploadError("Network error — check your connection and try again.");
    } finally {
      setImageUploading(false);
    }
  }, []);

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("name", name);
    formData.append("body", body);
    formData.append("category", "MARKETING");
    formData.append("imageUrl", imageUrl);
    submit(formData, { method: "post" });
    setName("");
    setBody("");
    setImageUrl("");
  }, [name, body, imageUrl, submit]);

  const previewText = body.split("{first_name}").join("Rahul") || "Your message preview will appear here...";

  const rows = templates.map((t: any) => [
    t.name,
    <Badge key={`${t.id}-cat`} tone="attention">MARKETING</Badge>,
    t.imageUrl ? <Thumbnail key={`${t.id}-img`} source={t.imageUrl} alt={t.name} size="small" /> : "—",
    new Date(t.createdAt).toLocaleDateString(),
    <Button key={`${t.id}-del`} variant="plain" tone="critical" onClick={() => onDelete(t.id)}>
      Remove
    </Button>,
  ]);

  return (
    <BlockStack gap="400">
      <Banner tone="info">
        Marketing templates are for broadcasts — they only support{" "}
        <strong>First Name</strong> as a variable, since a broadcast has no
        single order tied to it. For order-specific details, use the Order
        Notifications tab instead.
      </Banner>

      <InlineStack gap="400" align="start" wrap={false}>
        <Box width="55%">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Create a marketing template</Text>

              <TextField
                label="Template name"
                value={name}
                onChange={setName}
                autoComplete="off"
                placeholder="Diwali Sale Offer"
              />

              <div>
                <Text as="p" variant="bodyMd" fontWeight="medium">Message</Text>
                <div style={{ marginTop: 4 }}>
                  <textarea
                    ref={bodyRef}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={6}
                    placeholder="Hello {first_name}, special Diwali offer just for you!"
                    style={{
                      width: "100%", padding: "8px 12px", border: "1px solid #c9cccf",
                      borderRadius: 8, fontFamily: "inherit", fontSize: 14, resize: "vertical",
                    }}
                  />
                </div>
              </div>

              <InlineStack gap="150" wrap>
                {MARKETING_VARIABLES.map((v) => (
                  <Button key={v.tag} size="micro" onClick={() => insertAtCursor(v.tag)}>
                    {v.label}
                  </Button>
                ))}
              </InlineStack>

              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" fontWeight="medium">
                  Product / Collection link + discount code
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Pulled live from your store — same for every recipient.
                </Text>
                <InlineStack gap="200" blockAlign="end" wrap>
                  <Box minWidth="140px">
                    <Select
                      label="Type"
                      options={[
                        { label: "Product", value: "product" },
                        { label: "Collection", value: "collection" },
                      ]}
                      value={linkType}
                      onChange={(v) => {
                        setLinkType(v as "product" | "collection");
                        setSelectedLink("");
                        setLinkSearch("");
                      }}
                    />
                  </Box>
                  <Box minWidth="240px">
                    <Autocomplete
                      options={filteredLinkOptions.map((item: any) => ({ label: item.title, value: item.url }))}
                      selected={selectedLink ? [selectedLink] : []}
                      onSelect={(selected) => setSelectedLink(selected[0] || "")}
                      textField={
                        <Autocomplete.TextField
                          label={linkType === "product" ? "Search products" : "Search collections"}
                          value={linkSearch}
                          onChange={setLinkSearch}
                          placeholder={resourcesFetcher.state === "loading" ? "Loading..." : "Type to search..."}
                          autoComplete="off"
                        />
                      }
                    />
                  </Box>
                  <Button onClick={() => insertAtCursor(selectedLink)} disabled={!selectedLink}>
                    Insert link
                  </Button>
                </InlineStack>
                <InlineStack gap="200" blockAlign="end" wrap>
                  <Box minWidth="240px">
                    <Autocomplete
                      options={filteredDiscounts.map((d: any) => ({ label: `${d.title} (${d.code})`, value: d.code }))}
                      selected={selectedDiscount ? [selectedDiscount] : []}
                      onSelect={(selected) => setSelectedDiscount(selected[0] || "")}
                      textField={
                        <Autocomplete.TextField
                          label="Search discount codes"
                          value={discountSearch}
                          onChange={setDiscountSearch}
                          placeholder={discounts.length === 0 ? "No active codes found" : "Type to search..."}
                          autoComplete="off"
                        />
                      }
                    />
                  </Box>
                  <Button onClick={() => insertAtCursor(selectedDiscount)} disabled={!selectedDiscount}>
                    Insert code
                  </Button>
                </InlineStack>
              </BlockStack>

              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" fontWeight="medium">Image (optional)</Text>
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
                      <Button variant="plain" tone="critical" onClick={() => setImageUrl("")}>Remove</Button>
                    </>
                  )}
                </InlineStack>
                {imageUploadError && (
                  <Text as="p" variant="bodySm" tone="critical">{imageUploadError}</Text>
                )}
              </BlockStack>

              <Button variant="primary" onClick={handleSave} loading={isSaving} disabled={!name || !body}>
                Save template
              </Button>
            </BlockStack>
          </Card>
        </Box>

        <Box width="45%">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Preview</Text>
              <div style={{ background: "#e5ddd5", borderRadius: 12, padding: 16 }}>
                <div style={{ background: "#fff", borderRadius: 8, padding: 12, maxWidth: 320, boxShadow: "0 1px 2px rgba(0,0,0,0.15)" }}>
                  {imageUrl && (
                    <img src={imageUrl} alt="preview" style={{ width: "100%", borderRadius: 6, marginBottom: 8, display: "block" }} />
                  )}
                  <Text as="p" variant="bodyMd">{previewText}</Text>
                </div>
              </div>
            </BlockStack>
          </Card>
        </Box>
      </InlineStack>

      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">Your marketing templates</Text>
          {rows.length > 0 ? (
            <DataTable
              columnContentTypes={["text", "text", "text", "text", "text"]}
              headings={["Name", "Category", "Image", "Created", ""]}
              rows={rows}
            />
          ) : (
            <EmptyState heading="No marketing templates yet" image="">
              <p>Create your first one above.</p>
            </EmptyState>
          )}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

function OrderTab({ templates, isSaving, submit }: any) {
  const [activeCategory, setActiveCategory] = useState(ORDER_CATEGORIES[0].key);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [body, setBody] = useState(() => {
    const t = templates.find((tp: any) => tp.category === activeCategory);
    return t?.body || "";
  });

  useEffect(() => {
    const t = templates.find((tp: any) => tp.category === activeCategory);
    setBody(t?.body || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory]);

  const insertAtCursor = useCallback(
    (text: string) => {
      const el = bodyRef.current;
      if (!el) {
        setBody((prev: string) => `${prev} ${text}`);
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

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("body", body);
    formData.append("category", activeCategory);
    formData.append("name", ORDER_CATEGORIES.find((c) => c.key === activeCategory)?.label || "");
    submit(formData, { method: "post" });
  }, [body, activeCategory, submit]);

  return (
    <BlockStack gap="400">
      <Banner tone="info">
        These send automatically when an order is placed or its shipment
        status changes — all variables here use the real order's data, no
        manual entry needed. If you don't set one, a sensible default
        message is used instead.
      </Banner>

      <InlineStack gap="150" wrap>
        {ORDER_CATEGORIES.map((c) => (
          <Button
            key={c.key}
            pressed={activeCategory === c.key}
            onClick={() => setActiveCategory(c.key)}
          >
            {templates.some((t: any) => t.category === c.key) ? "✓ " : ""}
            {c.label}
          </Button>
        ))}
      </InlineStack>

      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            {ORDER_CATEGORIES.find((c) => c.key === activeCategory)?.label}
          </Text>

          <div>
            <Text as="p" variant="bodyMd" fontWeight="medium">Message</Text>
            <div style={{ marginTop: 4 }}>
              <textarea
                ref={bodyRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                placeholder="Hi {first_name}, your order {order_number} is confirmed!"
                style={{
                  width: "100%", padding: "8px 12px", border: "1px solid #c9cccf",
                  borderRadius: 8, fontFamily: "inherit", fontSize: 14, resize: "vertical",
                }}
              />
            </div>
          </div>

          <InlineStack gap="150" wrap>
            {ORDER_VARIABLES.map((v) => (
              <Button key={v.tag} size="micro" onClick={() => insertAtCursor(v.tag)}>
                {v.label}
              </Button>
            ))}
          </InlineStack>

          <Button variant="primary" onClick={handleSave} loading={isSaving} disabled={!body}>
            Save {ORDER_CATEGORIES.find((c) => c.key === activeCategory)?.label} template
          </Button>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
