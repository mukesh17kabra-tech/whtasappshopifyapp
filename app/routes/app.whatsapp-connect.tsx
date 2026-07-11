import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useEffect, useState, useCallback } from "react";
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
  Spinner,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });

  return json({
    shopId: shop?.id ?? "",
    connected: shop?.whatsappBridgeConnected ?? false,
    connectedAt: shop?.whatsappConnectedAt?.toISOString() ?? null,
  });
}

// Proxies requests to the bridge service so the merchant's browser never
// needs the bridge's shared secret — this route holds it server-side and
// forwards calls scoped to this shop's own session.
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");
  const bridgeUrl = process.env.WHATSAPP_BRIDGE_URL;
  const bridgeSecret = process.env.WHATSAPP_BRIDGE_SECRET;

  if (!bridgeUrl || !bridgeSecret) {
    return json(
      { error: "WhatsApp bridge isn't configured yet. Set WHATSAPP_BRIDGE_URL and WHATSAPP_BRIDGE_SECRET." },
      { status: 500 },
    );
  }

  const headers = { Authorization: `Bearer ${bridgeSecret}` };

  try {
    if (intent === "connect") {
      await fetch(`${bridgeUrl}/connect/${shop.id}`, { method: "POST", headers });
      return json({ success: true });
    }

    if (intent === "poll") {
      const statusRes = await fetch(`${bridgeUrl}/status/${shop.id}`, { headers });
      const statusData = await statusRes.json();

      let qr = null;
      if (statusData.status === "qr_ready") {
        const qrRes = await fetch(`${bridgeUrl}/qr/${shop.id}`, { headers });
        const qrData = await qrRes.json();
        qr = qrData.qr ?? null;
      }

      if (statusData.status === "connected" && !shop.whatsappBridgeConnected) {
        await prisma.shop.update({
          where: { id: shop.id },
          data: { whatsappBridgeConnected: true, whatsappConnectedAt: new Date() },
        });
      }

      return json({ status: statusData.status, qr });
    }

    if (intent === "disconnect") {
      await fetch(`${bridgeUrl}/disconnect/${shop.id}`, { method: "POST", headers });
      await prisma.shop.update({
        where: { id: shop.id },
        data: { whatsappBridgeConnected: false, whatsappConnectedAt: null },
      });
      return json({ success: true, disconnected: true });
    }

    return json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("Bridge proxy request failed", err);
    return json({ error: "Couldn't reach the WhatsApp bridge service. Check it's deployed and running." }, { status: 500 });
  }
}

export default function WhatsappConnect() {
  const { connected: initiallyConnected, connectedAt } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [connected, setConnected] = useState(initiallyConnected);
  const [qr, setQr] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  const handleConnect = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "connect");
    fetcher.submit(formData, { method: "post" });
    setPolling(true);
  }, [fetcher]);

  const handleDisconnect = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "disconnect");
    fetcher.submit(formData, { method: "post" });
    setConnected(false);
    setQr(null);
    setPolling(false);
  }, [fetcher]);

  // Poll status every 2s while attempting to connect
  useEffect(() => {
    if (!polling) return;

    const interval = setInterval(() => {
      const formData = new FormData();
      formData.append("intent", "poll");
      fetcher.submit(formData, { method: "post" });
    }, 2000);

    return () => clearInterval(interval);
  }, [polling]);

  useEffect(() => {
    if (fetcher.data && "error" in fetcher.data && fetcher.data.error) {
      // Stop the spinner and show the real error instead of spinning forever
      setPolling(false);
    }
    if (fetcher.data && "status" in fetcher.data) {
      if (fetcher.data.status === "qr_ready" && fetcher.data.qr) {
        setQr(fetcher.data.qr);
      }
      if (fetcher.data.status === "connected") {
        setConnected(true);
        setQr(null);
        setPolling(false);
      }
    }
  }, [fetcher.data]);

  return (
    <Page title="Connect WhatsApp">
      <BlockStack gap="400">
        <Banner tone="info">
          This links your store's real WhatsApp Business number directly —
          no Meta Business account, no Facebook login, no template approval.
          Just scan a QR code with WhatsApp on your phone, the same way you'd
          link WhatsApp Web.
        </Banner>

        {fetcher.data && "error" in fetcher.data && fetcher.data.error && (
          <Banner tone="critical">{fetcher.data.error}</Banner>
        )}

        <Card>
          <BlockStack gap="400">
            {connected ? (
              <>
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="success">Connected</Badge>
                  <Text as="span" variant="bodyMd">
                    Your WhatsApp number is linked and ready to send.
                  </Text>
                </InlineStack>
                {connectedAt && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Connected on {new Date(connectedAt).toLocaleDateString()}
                  </Text>
                )}
                <Box>
                  <Button tone="critical" onClick={handleDisconnect}>
                    Disconnect
                  </Button>
                </Box>
              </>
            ) : qr ? (
              <>
                <Text as="h2" variant="headingMd">
                  Scan this QR code
                </Text>
                <Text as="p" tone="subdued">
                  Open WhatsApp on your phone → Settings → Linked Devices →
                  Link a Device → scan this code.
                </Text>
                <Box>
                  <img src={qr} alt="WhatsApp QR code" style={{ maxWidth: 280, borderRadius: 8, border: "1px solid #ddd" }} />
                </Box>
                <InlineStack gap="200" blockAlign="center">
                  <Spinner size="small" />
                  <Text as="span" variant="bodySm" tone="subdued">
                    Waiting for you to scan...
                  </Text>
                </InlineStack>
              </>
            ) : (
              <>
                <Text as="h2" variant="headingMd">
                  Connect your WhatsApp number
                </Text>
                <Text as="p" tone="subdued">
                  Click below to generate a QR code, then scan it with the
                  WhatsApp Business app on the phone number you want to send
                  from.
                </Text>
                <Box>
                  <Button variant="primary" onClick={handleConnect} loading={polling && !qr}>
                    Generate QR code
                  </Button>
                </Box>
              </>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              Good to know
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              This connects the same way WhatsApp Web does, not through
              Meta's official Business API — so there's no template approval
              step, and you can send freeform messages and images right
              away. The tradeoff: this isn't an officially sanctioned way to
              automate WhatsApp, so sending too much too fast or to people
              who haven't opted in risks the number being restricted. Use a
              dedicated number if you can, and grow your sending volume
              gradually.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
