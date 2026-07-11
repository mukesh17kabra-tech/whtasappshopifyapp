import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { useEffect, useCallback, useState } from "react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  Banner,
  Button,
  Box,
  InlineStack,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { exchangeCodeForToken, getLongLivedToken, subscribeAppToWaba, getPhoneNumberDisplay } from "~/services/embedded-signup.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });

  return json({
    connected: Boolean(shop?.whatsappAccessToken && shop?.whatsappPhoneNumberId),
    displayPhoneNumber: shop?.whatsappDisplayPhoneNumber ?? null,
    connectedAt: shop?.whatsappConnectedAt?.toISOString() ?? null,
    metaAppId: process.env.WHATSAPP_APP_ID || "",
    metaConfigId: process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID || "",
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "disconnect") {
    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        whatsappPhoneNumberId: null,
        whatsappBusinessAccountId: null,
        whatsappAccessToken: null,
        whatsappDisplayPhoneNumber: null,
        whatsappConnectedAt: null,
      },
    });
    return json({ success: true, disconnected: true });
  }

  if (intent === "complete-signup") {
    const code = String(formData.get("code") ?? "");
    const wabaId = String(formData.get("wabaId") ?? "");
    const phoneNumberId = String(formData.get("phoneNumberId") ?? "");

    if (!code || !wabaId || !phoneNumberId) {
      return json({ error: "Missing signup data — please try connecting again." }, { status: 400 });
    }

    // 1. Exchange the authorization code for a short-lived access token
    const shortLived = await exchangeCodeForToken(code);
    if (!shortLived) {
      return json({ error: "Couldn't exchange authorization code with Meta. Please try again." }, { status: 400 });
    }

    // 2. Exchange that for a long-lived token (valid ~60 days; you'll want a
    // refresh flow before it expires — see README note on this)
    const longLived = await getLongLivedToken(shortLived);
    const accessToken = longLived || shortLived;

    // 3. Subscribe your app to this WABA's webhooks (required for receiving
    // message status updates / inbound messages for this merchant's number)
    await subscribeAppToWaba(wabaId, accessToken);

    // 4. Get the human-readable phone number for display in the UI
    const displayPhoneNumber = await getPhoneNumberDisplay(phoneNumberId, accessToken);

    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        whatsappBusinessAccountId: wabaId,
        whatsappPhoneNumberId: phoneNumberId,
        whatsappAccessToken: accessToken,
        whatsappDisplayPhoneNumber: displayPhoneNumber,
        whatsappConnectedAt: new Date(),
      },
    });

    return json({ success: true, connected: true });
  }

  return json({ error: "Unknown action" }, { status: 400 });
}

export default function WhatsappConnect() {
  const { connected, displayPhoneNumber, connectedAt, metaAppId, metaConfigId } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [signingUp, setSigningUp] = useState(false);

  const isSubmitting = navigation.state === "submitting";

  // Load Facebook's JS SDK once, needed for the Embedded Signup popup
  useEffect(() => {
    if (document.getElementById("facebook-jssdk")) {
      setSdkLoaded(true);
      return;
    }

    (window as any).fbAsyncInit = function () {
      (window as any).FB.init({
        appId: metaAppId,
        autoLogAppEvents: true,
        xfbml: true,
        version: "v19.0",
      });
      setSdkLoaded(true);
    };

    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    document.body.appendChild(script);
  }, [metaAppId]);

  // Listen for Meta's Embedded Signup postMessage events, which carry the
  // wabaId + phoneNumberId once the merchant finishes picking/creating their
  // WhatsApp number inside the popup.
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!event.origin.endsWith("facebook.com")) return;

      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data.type === "WA_EMBEDDED_SIGNUP" && data.event === "FINISH") {
          const { phone_number_id, waba_id } = data.data || {};
          if (phone_number_id && waba_id) {
            (window as any).__waEmbeddedSignupResult = { phoneNumberId: phone_number_id, wabaId: waba_id };
          }
        }
      } catch {
        // Not a JSON message we care about — ignore
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleConnect = useCallback(() => {
    if (!sdkLoaded || !(window as any).FB) {
      alert("Facebook SDK still loading, please wait a moment and try again.");
      return;
    }

    setSigningUp(true);
    (window as any).__waEmbeddedSignupResult = null;

    (window as any).FB.login(
      (response: any) => {
        setSigningUp(false);

        if (response.authResponse && response.authResponse.code) {
          const code = response.authResponse.code;
          const result = (window as any).__waEmbeddedSignupResult;

          if (!result) {
            alert("Signup didn't complete — please make sure you finish selecting or creating a WhatsApp number in the popup.");
            return;
          }

          const formData = new FormData();
          formData.append("intent", "complete-signup");
          formData.append("code", code);
          formData.append("wabaId", result.wabaId);
          formData.append("phoneNumberId", result.phoneNumberId);
          submit(formData, { method: "post" });
        } else {
          alert("WhatsApp connection was cancelled or didn't complete.");
        }
      },
      {
        config_id: metaConfigId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "",
          sessionInfoVersion: "3",
        },
      },
    );
  }, [sdkLoaded, metaConfigId, submit]);

  const handleDisconnect = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "disconnect");
    submit(formData, { method: "post" });
  }, [submit]);

  return (
    <Page title="Connect WhatsApp">
      <BlockStack gap="400">
        {actionData && "error" in actionData && actionData.error && (
          <Banner tone="critical">{actionData.error}</Banner>
        )}
        {actionData && "connected" in actionData && actionData.connected && (
          <Banner tone="success">WhatsApp Business Account connected!</Banner>
        )}

        <Card>
          <BlockStack gap="400">
            {connected ? (
              <>
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="success">Connected</Badge>
                  <Text as="span" variant="bodyMd">
                    {displayPhoneNumber || "WhatsApp Business Account"}
                  </Text>
                </InlineStack>
                {connectedAt && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Connected on {new Date(connectedAt).toLocaleDateString()}
                  </Text>
                )}
                <Box>
                  <Button tone="critical" onClick={handleDisconnect} loading={isSubmitting}>
                    Disconnect
                  </Button>
                </Box>
              </>
            ) : (
              <>
                <Text as="h2" variant="headingMd">
                  Connect your WhatsApp Business Account
                </Text>
                <Text as="p" tone="subdued">
                  Sends go out through your own WhatsApp number, not a shared
                  one. Click below to link an existing WhatsApp Business
                  Account, or create a new one — Meta walks you through it.
                </Text>
                <Box>
                  <Button
                    variant="primary"
                    onClick={handleConnect}
                    loading={signingUp || isSubmitting}
                    disabled={!sdkLoaded}
                  >
                    Connect WhatsApp Business Account
                  </Button>
                </Box>
              </>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
