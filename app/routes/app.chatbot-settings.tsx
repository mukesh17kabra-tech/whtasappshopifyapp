import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { useCallback, useRef, useState } from "react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  InlineGrid,
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
  const widgetColor = String(formData.get("widgetColor") ?? "#25D366").trim();
  const headerText = String(formData.get("headerText") ?? "").trim();
  const teaserMessage = String(formData.get("teaserMessage") ?? "").trim();
  const bubbleIconUrl = String(formData.get("bubbleIconUrl") ?? "").trim() || null;
  const headerLogoUrl = String(formData.get("headerLogoUrl") ?? "").trim() || null;
  const position = String(formData.get("position") ?? "bottom-right");

  if (!headerText) {
    return json({ error: "Header text can't be empty." }, { status: 400 });
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(widgetColor)) {
    return json({ error: "Widget color must be a valid hex code, e.g. #25D366." }, { status: 400 });
  }

  await prisma.chatbotSettings.upsert({
    where: { shopId: shop.id },
    update: { enabled, widgetColor, headerText, teaserMessage, bubbleIconUrl, headerLogoUrl, position },
    create: { shopId: shop.id, enabled, widgetColor, headerText, teaserMessage, bubbleIconUrl, headerLogoUrl, position },
  });

  return json({ success: true });
}

function useImageUpload(onUploaded: (url: string) => void) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const handleSelect = useCallback(
    async (file: File) => {
      setUploading(true);
      setError("");
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload-image", { method: "POST", body: formData });
        let data;
        try {
          data = await res.json();
        } catch {
          setError("Upload failed — unexpected response from server.");
          return;
        }
        if (!res.ok) {
          setError(data.error || "Upload failed.");
          return;
        }
        if (data.url) onUploaded(data.url);
      } catch {
        setError("Network error — check your connection and try again.");
      } finally {
        setUploading(false);
      }
    },
    [onUploaded],
  );

  return { uploading, error, handleSelect };
}

export default function ChatbotSettingsPage() {
  const { settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [enabled, setEnabled] = useState(settings?.enabled ?? true);
  const [widgetColor, setWidgetColor] = useState(settings?.widgetColor ?? "#25D366");
  const [headerText, setHeaderText] = useState(settings?.headerText ?? "Find your product");
  const [teaserMessage, setTeaserMessage] = useState(settings?.teaserMessage ?? "Hello 👋 How can I help you?");
  const [bubbleIconUrl, setBubbleIconUrl] = useState(settings?.bubbleIconUrl ?? "");
  const [headerLogoUrl, setHeaderLogoUrl] = useState(settings?.headerLogoUrl ?? "");
  const [position, setPosition] = useState(settings?.position ?? "bottom-right");

  const bubbleUpload = useImageUpload(setBubbleIconUrl);
  const headerUpload = useImageUpload(setHeaderLogoUrl);
  const bubbleFileRef = useRef<HTMLInputElement | null>(null);
  const headerFileRef = useRef<HTMLInputElement | null>(null);

  const isSaving = navigation.state === "submitting";

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("enabled", String(enabled));
    formData.append("widgetColor", widgetColor);
    formData.append("headerText", headerText);
    formData.append("teaserMessage", teaserMessage);
    formData.append("bubbleIconUrl", bubbleIconUrl);
    formData.append("headerLogoUrl", headerLogoUrl);
    formData.append("position", position);
    submit(formData, { method: "post" });
  }, [enabled, widgetColor, headerText, teaserMessage, bubbleIconUrl, headerLogoUrl, position, submit]);

  return (
    <Page title="Chatbot Settings">
      <BlockStack gap="400">
        <Banner tone="info">
          This is a rule-based product finder shown on your storefront — not
          a live chat with a real person. It needs the "Product Finder
          Chatbot" app embed turned on in your theme editor too — this page
          controls its look and content, that toggle controls whether it
          shows on your site at all.
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

            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">Branding</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Customize how the chat widget looks on your storefront —
                your color, your logo, your wording.
              </Text>
            </BlockStack>

            <InlineGrid columns={2} gap="400">
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" fontWeight="medium">Widget color</Text>
                <InlineStack gap="200" blockAlign="center">
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(widgetColor) ? widgetColor : "#25D366"}
                    onChange={(e) => setWidgetColor(e.target.value)}
                    style={{ width: 44, height: 36, border: "1px solid #c9cccf", borderRadius: 6, padding: 2, cursor: "pointer" }}
                  />
                  <Box width="160px">
                    <TextField label="" labelHidden value={widgetColor} onChange={setWidgetColor} autoComplete="off" placeholder="#25D366" />
                  </Box>
                </InlineStack>
              </BlockStack>

              <TextField label="Header text" value={headerText} onChange={setHeaderText} autoComplete="off" />
            </InlineGrid>

            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" fontWeight="medium">Teaser message</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Pops up next to the bubble a few seconds after the page
                loads, before anyone clicks — like WhatsApp's chat widget.
              </Text>
              <TextField label="" labelHidden value={teaserMessage} onChange={setTeaserMessage} autoComplete="off" />
            </BlockStack>

            <InlineGrid columns={2} gap="400">
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" fontWeight="medium">Widget position</Text>
                <Select
                  label=""
                  labelHidden
                  options={[
                    { label: "Bottom right", value: "bottom-right" },
                    { label: "Bottom left", value: "bottom-left" },
                  ]}
                  value={position}
                  onChange={setPosition}
                />
              </BlockStack>

              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" fontWeight="medium">Chat bubble icon</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Replaces the default 💬 icon (recommend a square logo)
                </Text>
                <input
                  ref={bubbleFileRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) bubbleUpload.handleSelect(file);
                  }}
                />
                <InlineStack gap="200" blockAlign="center">
                  {bubbleIconUrl ? (
                    <Thumbnail source={bubbleIconUrl} alt="Bubble icon" size="small" />
                  ) : (
                    <div style={{ width: 40, height: 40, border: "1px dashed #c9cccf", borderRadius: 8 }} />
                  )}
                  <Button onClick={() => bubbleFileRef.current?.click()} loading={bubbleUpload.uploading}>
                    Upload
                  </Button>
                  {bubbleIconUrl && (
                    <Button variant="plain" tone="critical" onClick={() => setBubbleIconUrl("")}>Remove</Button>
                  )}
                </InlineStack>
                {bubbleUpload.error && <Text as="p" variant="bodySm" tone="critical">{bubbleUpload.error}</Text>}
              </BlockStack>
            </InlineGrid>

            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" fontWeight="medium">Header logo</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Shown next to the header text inside the chat window
              </Text>
              <input
                ref={headerFileRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) headerUpload.handleSelect(file);
                }}
              />
              <InlineStack gap="200" blockAlign="center">
                {headerLogoUrl && <Thumbnail source={headerLogoUrl} alt="Header logo" size="small" />}
                <Button onClick={() => headerFileRef.current?.click()} loading={headerUpload.uploading}>
                  Upload
                </Button>
                {headerLogoUrl && (
                  <Button variant="plain" tone="critical" onClick={() => setHeaderLogoUrl("")}>Remove</Button>
                )}
              </InlineStack>
              {headerUpload.error && <Text as="p" variant="bodySm" tone="critical">{headerUpload.error}</Text>}
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
