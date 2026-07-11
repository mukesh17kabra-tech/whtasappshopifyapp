// WhatsApp sending — two possible providers:
//
// 1. BRIDGE (default, recommended per your request): sends through the
//    whatsapp-bridge-service (separate repo, see its README), which connects
//    via a real WhatsApp number using the WhatsApp Web protocol. No Meta
//    approval needed for any message content. Set WHATSAPP_PROVIDER=bridge
//    (or just leave WHATSAPP_BRIDGE_URL set, since that's the default below).
//
// 2. META — the official WhatsApp Cloud API. Requires pre-approved templates
//    for marketing/utility broadcasts. Falls back to this only if
//    WHATSAPP_PROVIDER=meta is explicitly set.

type SendResult = { success: boolean; messageId?: string };

const USE_META = process.env.WHATSAPP_PROVIDER !== "bridge";

async function sendViaBridge(params: {
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

async function sendViaMetaTemplate(params: {
  to: string;
  templateName: string;
  variables: Record<string, string>;
}): Promise<SendResult> {
  const { to, templateName, variables } = params;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: "en" },
          components: [
            {
              type: "body",
              parameters: Object.values(variables).map((v) => ({
                type: "text",
                text: v,
              })),
            },
          ],
        },
      }),
    },
  );

  const data = await res.json();
  if (!res.ok) {
    console.error("WhatsApp API error:", data);
    return { success: false };
  }
  return { success: true, messageId: data.messages?.[0]?.id };
}

async function sendViaMetaFreeform(params: {
  to: string;
  text: string;
  imageUrl?: string | null;
}): Promise<SendResult> {
  const { to, text, imageUrl } = params;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  const body = imageUrl
    ? {
        messaging_product: "whatsapp",
        to,
        type: "image",
        image: { link: imageUrl, caption: text },
      }
    : {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      };

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  const data = await res.json();
  if (!res.ok) {
    console.error("WhatsApp custom message error:", data);
    return { success: false };
  }
  return { success: true, messageId: data.messages?.[0]?.id };
}

// Used for order confirmations / shipment updates. On the bridge path, the
// "template" is just rendered as plain text (no Meta template registration
// needed) — variables get formatted into a readable line since there are no
// approved template components to fill.
export async function sendWhatsappTemplateMessage(params: {
  to: string;
  templateName: string;
  variables: Record<string, string>;
}): Promise<SendResult> {
  if (USE_META) {
    return sendViaMetaTemplate(params);
  }

  const text = `[${params.templateName}] ` +
    Object.entries(params.variables)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" | ");
  return sendViaBridge({ to: params.to, text });
}

// Used for in-app composed marketing broadcasts (Templates page). This is
// the main path for your "no Meta approval" requirement — sends the
// merchant's exact composed text + optional image directly.
export async function sendWhatsappCustomMessage(params: {
  to: string;
  text: string;
  imageUrl?: string | null;
}): Promise<SendResult> {
  if (USE_META) {
    return sendViaMetaFreeform(params);
  }
  return sendViaBridge(params);
}

// Used for opt-out/opt-in confirmation replies from the inbound webhook.
export async function sendWhatsappTextMessage(params: {
  to: string;
  text: string;
}): Promise<SendResult> {
  if (USE_META) {
    return sendViaMetaFreeform(params);
  }
  return sendViaBridge(params);
}
