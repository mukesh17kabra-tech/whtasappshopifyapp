// WhatsApp sending — entirely via the bridge service (whatsapp-bridge-service),
// which connects through each merchant's own real WhatsApp Business number
// (linked by scanning a QR code, same as WhatsApp Web). No Meta Business API,
// no template approval, no Facebook login anywhere in this flow.
//
// Every send is scoped by shopId, since the bridge holds one session per
// merchant — see whatsapp-bridge-service/index.js.

type SendResult = { success: boolean; messageId?: string };

async function sendViaBridge(params: {
  shopId: string;
  to: string;
  text: string;
  imageUrl?: string | null;
}): Promise<SendResult> {
  const bridgeUrl = process.env.WHATSAPP_BRIDGE_URL;
  const bridgeSecret = process.env.WHATSAPP_BRIDGE_SECRET;

  if (!bridgeUrl || !bridgeSecret) {
    console.error(
      "WHATSAPP_BRIDGE_URL or WHATSAPP_BRIDGE_SECRET not set — deploy whatsapp-bridge-service first and set these env vars.",
    );
    return { success: false };
  }

  try {
    const res = await fetch(`${bridgeUrl}/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bridgeSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        shopId: params.shopId,
        to: params.to,
        text: params.text,
        imageUrl: params.imageUrl || undefined,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("Bridge send error:", data);
      return { success: false };
    }
    return { success: true, messageId: data.messageId };
  } catch (err) {
    console.error("Bridge send failed:", err);
    return { success: false };
  }
}

// Used for order confirmations / shipment updates and marketing broadcasts.
// Since there's no Meta template mechanism anymore, this just renders the
// variables into a readable line — real formatting comes from the
// merchant's own composed template text (see template.server.ts), this is
// only used for the two fixed system flows (order_confirmation, shipment_update).
export async function sendWhatsappTemplateMessage(params: {
  shopId: string;
  to: string;
  templateName: string;
  variables: Record<string, string>;
}): Promise<SendResult> {
  const text = `[${params.templateName}] ` +
    Object.entries(params.variables)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" | ");
  return sendViaBridge({ shopId: params.shopId, to: params.to, text });
}

// Used for in-app composed marketing broadcasts — the merchant's exact
// composed text + optional image, sent directly, no approval mechanism.
export async function sendWhatsappCustomMessage(params: {
  shopId: string;
  to: string;
  text: string;
  imageUrl?: string | null;
}): Promise<SendResult> {
  return sendViaBridge(params);
}

// Used for opt-out/opt-in confirmation replies from the inbound webhook.
export async function sendWhatsappTextMessage(params: {
  shopId: string;
  to: string;
  text: string;
}): Promise<SendResult> {
  return sendViaBridge(params);
}
