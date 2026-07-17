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

const MARKETING_STARTERS = [
  { name: "Welcome Offer (WhatsApp)", channel: "whatsapp", body: "Hi {first_name}! Thanks for joining us. Here's 10% off your first order — use code WELCOME10 at checkout." },
  { name: "We Miss You (WhatsApp)", channel: "whatsapp", body: "Hey {first_name}, it's been a while! Come back and check out what's new — we've got some great picks waiting for you." },
  { name: "Flash Sale (WhatsApp)", channel: "whatsapp", body: "{first_name}, our flash sale is live for the next 24 hours only! Don't miss out." },
  { name: "Welcome Offer (Email)", channel: "email", subject: "Welcome! Here's 10% off your first order", body: "Hi {first_name},\n\nThanks for joining us! As a welcome gift, enjoy 10% off your first order with code WELCOME10.\n\nHappy shopping!" },
  { name: "We Miss You (Email)", channel: "email", subject: "We miss you!", body: "Hi {first_name},\n\nIt's been a while since we've seen you! We've added some great new products we think you'll love.\n\nCome take a look." },
  { name: "Flash Sale (Email)", channel: "email", subject: "24-hour flash sale — don't miss it!", body: "Hi {first_name},\n\nOur flash sale just went live and it's only running for 24 hours. Shop now before it's gone!" },
];

const ORDER_STARTERS: Record<string, string> = {
  ORDER_CONFIRMATION: "Hi {first_name}, your order {order_number} has been confirmed! Total: {order_total}. We'll let you know as soon as it ships.",
  SHIPPED: "Hi {first_name}, your order {order_number} has shipped! Track it here: {tracking_url}",
  OUT_FOR_DELIVERY: "Hi {first_name}, your order {order_number} is out for delivery today — keep an eye out!",
  DELIVERED: "Hi {first_name}, your order {order_number} has been delivered. We hope you love it!",
  DELIVERY_ATTEMPTED: "Hi {first_name}, we attempted to deliver your order {order_number} but couldn't reach you. We'll try again soon.",
  DELIVERY_FAILED: "Hi {first_name}, unfortunately delivery of your order {order_number} failed. Please contact us for help.",
};

const FLOW_STARTERS = [
  { name: "Thank You for Your Order", body: "Hi {first_name}, thank you so much for your order {order_number}! We really appreciate your business." },
  { name: "How Was Your Experience?", body: "Hi {first_name}, your order {order_number} should have arrived by now — we'd love to hear how everything went!" },
  { name: "Leave Us a Review", body: "Hi {first_name}, if you're happy with your order {order_number}, would you mind leaving us a quick review? It really helps us out." },
  { name: "Complete Your Purchase", body: "Hi {first_name}, just checking in about order {order_number} — let us know if you have any questions!" },
  { name: "Time to Restock?", body: "Hi {first_name}, it's been a little while since order {order_number} — running low on anything? We're here if you need to reorder." },
  { name: "Loyalty Check-in", body: "Hi {first_name}, just a friendly note to say thanks for being a customer since order {order_number}. We've got new arrivals you might like!" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });

  if (!shop) return json({ marketingTemplates: [], orderTemplates: [], flowTemplates: [], connected: false });

  const allTemplates = await prisma.template.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
  });

  const marketingTemplates = allTemplates.filter((t) => t.category === "MARKETING");
  const orderCategoryKeys = ORDER_CATEGORIES.map((c) => c.key);
  const orderTemplates = allTemplates.filter((t) => orderCategoryKeys.includes(t.category));
  const flowTemplates = allTemplates.filter((t) => t.category === "FLOW");

  return json({
    marketingTemplates: marketingTemplates.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
    orderTemplates: orderTemplates.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
    flowTemplates: flowTemplates.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
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
      console.warn(`Delete failed for template ${id}, likely already deleted`, err);
    }
    return json({ success: true });
  }

  if (intent === "seed-marketing" || intent === "seed-flow") {
    const category = intent === "seed-marketing" ? "MARKETING" : "FLOW";
    const existing = await prisma.template.count({ where: { shopId: shop.id, category } });
    if (existing > 0) {
      return json({ error: "You already have templates here — starter templates are only added once." }, { status: 400 });
    }

    const starters =
      category === "MARKETING"
        ? MARKETING_STARTERS.map((s) => ({ ...s, subject: (s as any).subject ?? null }))
        : FLOW_STARTERS.map((s) => ({ name: s.name, channel: "whatsapp", subject: null, body: s.body }));

    await prisma.template.createMany({
      data: starters.map((s: any) => ({
        shopId: shop.id,
        name: s.name,
        category,
        channel: s.channel,
        subject: s.subject ?? null,
        body: s.body,
        status: "active",
      })),
    });

    return json({ success: true, seeded: starters.length });
  }

  if (intent === "seed-order") {
    const existing = await prisma.template.count({
      where: { shopId: shop.id, category: { in: ORDER_CATEGORIES.map((c) => c.key) } },
    });
    if (existing > 0) {
      return json({ error: "You already have Order Notification templates — starters are only added once." }, { status: 400 });
    }

    await prisma.template.createMany({
      data: ORDER_CATEGORIES.map((c) => ({
        shopId: shop.id,
        name: c.label,
        category: c.key,
        channel: "whatsapp",
        body: ORDER_STARTERS[c.key],
        status: "active",
      })),
    });

    return json({ success: true, seeded: ORDER_CATEGORIES.length });
  }

  const templateId = String(formData.get("templateId") ?? "").trim() || null;
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
      if (templateId) {
        const existing = await prisma.template.findUnique({ where: { id: templateId } });
        if (!existing || existing.shopId !== shop.id) {
          return json({ error: "Template not found" }, { status: 404 });
        }
        await prisma.template.update({
          where: { id: templateId },
          data: { name, body, imageUrl },
        });
      } else {
        await prisma.template.create({
          data: { shopId: shop.id, name, body, category, imageUrl, status: "active" },
        });
      }
    }
  } catch (err) {
    console.error("Failed to save template", err);
    const detail = err instanceof Error ? err.message : String(err);
    return json({ error: `Couldn't save template: ${detail}` }, { status: 500 });
  }

  return json({ success: true });
}

export default function Templates() {
  const { marketingTemplates, orderTemplates, flowTemplates, connected } = useLoaderData<typeof loader>();
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
            { id: "flow-template", content: "Flow Template" },
          ]}
          selected={selectedTab}
          onSelect={setSelectedTab}
        />

        {selectedTab === 0 ? (
          <TemplateComposerTab
            key="marketing"
            category="MARKETING"
            templates={marketingTemplates}
            isSaving={isSaving}
            onDelete={handleDelete}
            submit={submit}
            variables={MARKETING_VARIABLES}
            showResourcePicker
            seedIntent="seed-marketing"
            intro='Marketing templates are for broadcasts — they only support First Name as a variable, since a broadcast has no single order tied to it.'
          />
        ) : selectedTab === 1 ? (
          <OrderTab templates={orderTemplates} isSaving={isSaving} submit={submit} />
        ) : (
          <TemplateComposerTab
            key="flow"
            category="FLOW"
            templates={flowTemplates}
            isSaving={isSaving}
            onDelete={handleDelete}
            submit={submit}
            variables={ORDER_VARIABLES}
            showResourcePicker
            seedIntent="seed-flow"
            intro="Flow templates are used as steps inside your Flows (Flows page) — since flows trigger from a real order, the full set of order variables works here."
          />
        )}
      </BlockStack>
    </Page>
  );
}

function TemplateComposerTab({ category, templates, isSaving, onDelete, submit, variables, showResourcePicker, seedIntent, intro }: any) {
  const [editingId, setEditingId] = useState<string | null>(null);
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
    if (showResourcePicker) resourcesFetcher.load("/api/store-resources");
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
    ? discounts.filter((d: any) => d.title.toLowerCase().includes(discountSearch.toLowerCase()) || d.code.toLowerCase().includes(discountSearch.toLowerCase()))
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

  const resetForm = useCallback(() => {
    setEditingId(null);
    setName("");
    setBody("");
    setImageUrl("");
  }, []);

  const handleEdit = useCallback((t: any) => {
    setEditingId(t.id);
    setName(t.name);
    setBody(t.body);
    setImageUrl(t.imageUrl || "");
  }, []);

  const handleSave = useCallback(() => {
    const formData = new FormData();
    if (editingId) formData.append("templateId", editingId);
    formData.append("name", name);
    formData.append("body", body);
    formData.append("category", category);
    formData.append("imageUrl", imageUrl);
    submit(formData, { method: "post" });
    resetForm();
  }, [editingId, name, body, category, imageUrl, submit, resetForm]);

  const previewText = body.split("{first_name}").join("Rahul") || "Your message preview will appear here...";

  const rows = templates.map((t: any) => [
    t.name,
    <Badge key={`${t.id}-cat`} tone="attention">{category}</Badge>,
    t.imageUrl ? <Thumbnail key={`${t.id}-img`} source={t.imageUrl} alt={t.name} size="small" /> : "—",
    new Date(t.createdAt).toLocaleDateString(),
    <InlineStack key={`${t.id}-actions`} gap="200">
      <Button onClick={() => handleEdit(t)}>Edit</Button>
      <Button variant="plain" tone="critical" onClick={() => onDelete(t.id)}>Remove</Button>
    </InlineStack>,
  ]);

  return (
    <BlockStack gap="400">
      <Banner tone="info">{intro}</Banner>

      {templates.length === 0 && seedIntent && (
        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <Text as="p" variant="bodyMd">
              New here? Add 6 ready-made templates to get started quickly.
            </Text>
            <Button
              onClick={() => {
                const formData = new FormData();
                formData.append("intent", seedIntent);
                submit(formData, { method: "post" });
              }}
            >
              Add starter templates
            </Button>
          </InlineStack>
        </Card>
      )}

      <InlineStack gap="400" align="start" wrap={false}>
        <Box width="55%">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{editingId ? "Edit template" : "Create a template"}</Text>

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
                    placeholder="Hello {first_name}, special offer just for you!"
                    style={{
                      width: "100%", padding: "8px 12px", border: "1px solid #c9cccf",
                      borderRadius: 8, fontFamily: "inherit", fontSize: 14, resize: "vertical",
                    }}
                  />
                </div>
              </div>

              <InlineStack gap="150" wrap>
                {variables.map((v: any) => (
                  <Button key={v.tag} size="micro" onClick={() => insertAtCursor(v.tag)}>
                    {v.label}
                  </Button>
                ))}
              </InlineStack>

              {showResourcePicker && (
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" fontWeight="medium">
                    Product / Collection link + discount code
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Pulled live from your store.
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
              )}

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

              <InlineStack gap="200">
                <Button variant="primary" onClick={handleSave} loading={isSaving} disabled={!name || !body}>
                  {editingId ? "Save changes" : "Save template"}
                </Button>
                {editingId && <Button onClick={resetForm}>Cancel edit</Button>}
              </InlineStack>
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
          <Text as="h2" variant="headingMd">Your templates</Text>
          {rows.length > 0 ? (
            <DataTable
              columnContentTypes={["text", "text", "text", "text", "text"]}
              headings={["Name", "Category", "Image", "Created", ""]}
              rows={rows}
            />
          ) : (
            <EmptyState heading="No templates yet" image="">
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
  const [imageUrl, setImageUrl] = useState(() => {
    const t = templates.find((tp: any) => tp.category === activeCategory);
    return t?.imageUrl || "";
  });
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadError, setImageUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const t = templates.find((tp: any) => tp.category === activeCategory);
    setBody(t?.body || "");
    setImageUrl(t?.imageUrl || "");
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
    formData.append("body", body);
    formData.append("category", activeCategory);
    formData.append("imageUrl", imageUrl);
    formData.append("name", ORDER_CATEGORIES.find((c) => c.key === activeCategory)?.label || "");
    submit(formData, { method: "post" });
  }, [body, activeCategory, imageUrl, submit]);

  return (
    <BlockStack gap="400">
      <Banner tone="info">
        These send automatically when an order is placed or its shipment
        status changes — all variables here use the real order's data, no
        manual entry needed. If you don't set one, a sensible default
        message is used instead.
      </Banner>

      {templates.length === 0 && (
        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <Text as="p" variant="bodyMd">
              Add ready-made templates for all 6 order stages at once.
            </Text>
            <Button
              onClick={() => {
                const formData = new FormData();
                formData.append("intent", "seed-order");
                submit(formData, { method: "post" });
              }}
            >
              Add starter templates
            </Button>
          </InlineStack>
        </Card>
      )}

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

          <Button variant="primary" onClick={handleSave} loading={isSaving} disabled={!body}>
            Save {ORDER_CATEGORIES.find((c) => c.key === activeCategory)?.label} template
          </Button>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
