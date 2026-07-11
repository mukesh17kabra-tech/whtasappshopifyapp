// WhatsApp sending — per-shop credentials (Embedded Signup) or bridge.
//
// Each merchant connects their own WhatsApp Business Account via Meta's
// Embedded Signup flow (see app/routes/app.whatsapp-connect.tsx). Their
// phoneNumberId + accessToken are stored on their Shop row and passed into
// these functions — there is no shared/global WhatsApp account anymore for
// the Meta path. This is what makes the app usable by many merchants at once
// rather than funneling everyone through one number.
//
// The WhatsApp Bridge path (unofficial, WhatsApp Web-based) remains a
// single global connection for now — see whatsapp-bridge-service.

export type MetaCredentials = {
  phoneNumberId: string;
  accessToken: string;
};

type SendResult = { success: boolean; messageId?: string };

const USE_META = process.env.WHATSAPP_PROVIDER !== "bridge";
const GRAPH_VERSION = "v19.0";

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
  credentials: MetaCredentials;
}): Promise<SendResult> {
  const { to, templateName, variables, credentials } = params;

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${credentials.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: "en_US" },
          ...(Object.keys(variables).length > 0 && {
            components: [
              {
                type: "body",
                parameters: Object.values(variables).map((v) => ({
                  type: "text",
                  text: v,
                })),
              },
            ],
          }),
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
  credentials: MetaCredentials;
}): Promise<SendResult> {
  const { to, text, imageUrl, credentials } = params;

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
    `https://graph.facebook.com/${GRAPH_VERSION}/${credentials.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
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

// Used for order confirmations / shipment updates and approved marketing
// templates. `credentials` is required for the Meta path — callers must
// look up the shop's connected WhatsApp account first (see
// getShopWhatsappCredentials in this file).
export async function sendWhatsappTemplateMessage(params: {
  to: string;
  templateName: string;
  variables: Record<string, string>;
  credentials?: MetaCredentials | null;
}): Promise<SendResult> {
  if (USE_META) {
    if (!params.credentials) {
      console.error("No WhatsApp credentials for this shop — connect a WhatsApp Business Account first.");
      return { success: false };
    }
    return sendViaMetaTemplate({ ...params, credentials: params.credentials });
  }

  const text = `[${params.templateName}] ` +
    Object.entries(params.variables)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" | ");
  return sendViaBridge({ to: params.to, text });
}

// Used for in-app composed marketing broadcasts sent as freeform (draft/
// pending/rejected templates on the Meta path — within the 24h window only).
export async function sendWhatsappCustomMessage(params: {
  to: string;
  text: string;
  imageUrl?: string | null;
  credentials?: MetaCredentials | null;
}): Promise<SendResult> {
  if (USE_META) {
    if (!params.credentials) {
      console.error("No WhatsApp credentials for this shop — connect a WhatsApp Business Account first.");
      return { success: false };
    }
    return sendViaMetaFreeform({ ...params, credentials: params.credentials });
  }
  return sendViaBridge(params);
}

// Used for opt-out/opt-in confirmation replies from the inbound webhook.
export async function sendWhatsappTextMessage(params: {
  to: string;
  text: string;
  credentials?: MetaCredentials | null;
}): Promise<SendResult> {
  if (USE_META) {
    if (!params.credentials) {
      console.error("No WhatsApp credentials for this shop — connect a WhatsApp Business Account first.");
      return { success: false };
    }
    return sendViaMetaFreeform({ ...params, credentials: params.credentials });
  }
  return sendViaBridge(params);
}
