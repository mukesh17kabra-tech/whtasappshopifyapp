import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { useCallback, useRef, useState } from "react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  TextField,
  Button,
  Banner,
  Thumbnail,
  Box,
  Select,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });

  if (!shop) return json({ settings: null });

  const settings = await prisma.chatbotSettings.upsert({
    where: { shopId: shop.id },
    update: {},
    create: { shopId: shop.id },
  });

  return json({ settings });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const enabled = formData.get("enabled") === "true";
  const title = String(formData.get("title") ?? "").trim();
  const tooltipText = String(formData.get("tooltipText") ?? "").trim();
  const logoUrl = String(formData.get("logoUrl") ?? "").trim() || null;
  const position = String(formData.get("position") ?? "bottom-right");

  if (!title) {
    return json({ error: "Title can't be empty." }, { status: 400 });
  }

  await prisma.chatbotSettings.upsert({
    where: { shopId: shop.id },
    update: { enabled, title, tooltipText, logoUrl, position },
    create: { shopId: shop.id, enabled, title, tooltipText, logoUrl, position },
  });

  return json({ success: true });
}

export default function ChatbotSettingsPage() {
  const { settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [enabled, setEnabled] = useState(settings?.enabled ?? true);
  const [title, setTitle] = useState(settings?.title ?? "Find your product");
  const [tooltipText, setTooltipText] = useState(settings?.tooltipText ?? "Let's chat to find your product!");
  const [logoUrl, setLogoUrl] = useState(settings?.logoUrl ?? "");
  const [position, setPosition] = useState(settings?.position ?? "bottom-right");
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadError, setImageUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isSaving = navigation.state === "submitting";

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
      if (data.url) setLogoUrl(data.url);
    } catch {
      setImageUploadError("Network error — check your connection and try again.");
    } finally {
      setImageUploading(false);
    }
  }, []);

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("enabled", String(enabled));
    formData.append("title", title);
    formData.append("tooltipText", tooltipText);
    formData.append("logoUrl", logoUrl);
    formData.append("position", position);
    submit(formData, { method: "post" });
  }, [enabled, title, tooltipText, logoUrl, position, submit]);

  return (
    <Page title="Chatbot Settings">
      <BlockStack gap="400">
        <Banner tone="info">
          This is a rule-based product finder (pick a category, pick a
          budget, get suggestions) shown on your storefront — not a live
          chat with a real person, and not connected to real WhatsApp
          messages unless a visitor clicks the WhatsApp handoff button at
          the end. It needs the "Product Finder Chatbot" app embed turned
          on in your theme editor too — this page controls its content,
          that toggle controls whether it shows on your site at all.
        </Banner>

        {actionData && "error" in actionData && actionData.error && (
          <Banner tone="critical">{actionData.error}</Banner>
        )}
        {actionData && "success" in actionData && actionData.success && (
          <Banner tone="success">Saved.</Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <InlineStack gap="200" blockAlign="center">
              <Button pressed={enabled} onClick={() => setEnabled(!enabled)}>
                {enabled ? "Chatbot is ON" : "Chatbot is OFF"}
              </Button>
              <Text as="span" variant="bodySm" tone="subdued">
                Click to {enabled ? "turn off" : "turn on"}
              </Text>
            </InlineStack>

            <TextField label="Chatbot title" value={title} onChange={setTitle} autoComplete="off" />

            <TextField
              label="Tooltip message"
              value={tooltipText}
              onChange={setTooltipText}
              autoComplete="off"
              helpText="Shown briefly near the chat bubble a few seconds after page load."
            />

            <Select
              label="Position"
              options={[
                { label: "Bottom right", value: "bottom-right" },
                { label: "Bottom left", value: "bottom-left" },
              ]}
              value={position}
              onChange={setPosition}
            />

            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" fontWeight="medium">Logo (optional)</Text>
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
                  {logoUrl ? "Change logo" : "Upload logo"}
                </Button>
                {logoUrl && (
                  <>
                    <Thumbnail source={logoUrl} alt="Chatbot logo" size="small" />
                    <Button variant="plain" tone="critical" onClick={() => setLogoUrl("")}>Remove</Button>
                  </>
                )}
              </InlineStack>
              {imageUploadError && (
                <Text as="p" variant="bodySm" tone="critical">{imageUploadError}</Text>
              )}
              <Text as="p" variant="bodySm" tone="subdued">
                Shown as the chat bubble icon instead of the default 💬 emoji, if set.
              </Text>
            </BlockStack>

            <Box>
              <Button variant="primary" onClick={handleSave} loading={isSaving}>
                Save chatbot settings
              </Button>
            </Box>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
