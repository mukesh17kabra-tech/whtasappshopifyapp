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
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });

  if (!shop) {
    return json({ settings: null });
  }

  const settings = await prisma.popupSettings.upsert({
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
  const heading = String(formData.get("heading") ?? "").trim();
  const subheading = String(formData.get("subheading") ?? "").trim();
  const imageUrl = String(formData.get("imageUrl") ?? "").trim() || null;
  const delayMs = Number(formData.get("delayMs") ?? 3000);

  if (!heading) {
    return json({ error: "Heading can't be empty." }, { status: 400 });
  }

  await prisma.popupSettings.upsert({
    where: { shopId: shop.id },
    update: { enabled, heading, subheading, imageUrl, delayMs },
    create: { shopId: shop.id, enabled, heading, subheading, imageUrl, delayMs },
  });

  return json({ success: true });
}

export default function PopupSettings() {
  const { settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [enabled, setEnabled] = useState(settings?.enabled ?? true);
  const [heading, setHeading] = useState(settings?.heading ?? "Get offers on WhatsApp");
  const [subheading, setSubheading] = useState(
    settings?.subheading ??
      "Share your name and WhatsApp number to get offer alerts and order tracking updates.",
  );
  const [imageUrl, setImageUrl] = useState(settings?.imageUrl ?? "");
  const [delayMs, setDelayMs] = useState(String(settings?.delayMs ?? 3000));
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
      if (data.url) setImageUrl(data.url);
    } catch {
      setImageUploadError("Network error — check your connection and try again.");
    } finally {
      setImageUploading(false);
    }
  }, []);

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("enabled", String(enabled));
    formData.append("heading", heading);
    formData.append("subheading", subheading);
    formData.append("imageUrl", imageUrl);
    formData.append("delayMs", delayMs);
    submit(formData, { method: "post" });
  }, [enabled, heading, subheading, imageUrl, delayMs, submit]);

  return (
    <Page title="Popup Settings">
      <BlockStack gap="400">
        <Banner tone="info">
          This popup appears on your storefront asking visitors for their
          name and WhatsApp number. It needs the "WhatsApp Offer Popup" app
          embed turned on in your theme editor too — Online Store → Themes →
          Customize → App embeds — this page controls its content, that
          toggle controls whether it shows on your site at all.
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
                {enabled ? "Popup is ON" : "Popup is OFF"}
              </Button>
              <Text as="span" variant="bodySm" tone="subdued">
                Click to {enabled ? "turn off" : "turn on"}
              </Text>
            </InlineStack>

            <TextField
              label="Heading"
              value={heading}
              onChange={setHeading}
              autoComplete="off"
            />

            <TextField
              label="Subheading / message"
              value={subheading}
              onChange={setSubheading}
              multiline={3}
              autoComplete="off"
            />

            <TextField
              label="Delay before showing (milliseconds)"
              type="number"
              value={delayMs}
              onChange={setDelayMs}
              autoComplete="off"
              helpText="How long a visitor waits before the popup appears, e.g. 3000 = 3 seconds."
            />

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
                    <Thumbnail source={imageUrl} alt="Popup image" size="small" />
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

            <Box>
              <Button variant="primary" onClick={handleSave} loading={isSaving}>
                Save popup settings
              </Button>
            </Box>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Preview
            </Text>
            <div
              style={{
                background: "#f1f1f1",
                borderRadius: 12,
                padding: 24,
                display: "flex",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  padding: 24,
                  maxWidth: 340,
                  width: "100%",
                  boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
                  textAlign: "center",
                }}
              >
                {imageUrl && (
                  <img
                    src={imageUrl}
                    alt="preview"
                    style={{ width: "100%", borderRadius: 8, marginBottom: 12 }}
                  />
                )}
                <Text as="h3" variant="headingMd">
                  {heading || "Heading goes here"}
                </Text>
                <Box paddingBlockStart="200">
                  <Text as="p" variant="bodySm">
                    {subheading || "Subheading goes here"}
                  </Text>
                </Box>
                <Box paddingBlockStart="300">
                  <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8, marginBottom: 8, textAlign: "left", color: "#999" }}>
                    Your name
                  </div>
                  <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8, marginBottom: 8, textAlign: "left", color: "#999" }}>
                    +91 98765 43210
                  </div>
                  <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8, marginBottom: 8, textAlign: "left", color: "#999" }}>
                    Email (optional)
                  </div>
                  <div style={{ background: "#25D366", color: "#fff", borderRadius: 6, padding: 10, fontWeight: 600 }}>
                    Notify me on WhatsApp
                  </div>
                </Box>
              </div>
            </div>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
