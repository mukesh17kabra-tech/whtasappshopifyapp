// Thin wrapper around your WhatsApp Business Solution Provider (BSP).
// Swap the fetch() body/endpoint below for whichever provider you pick —
// Gupshup, Interakt, WATI, or Meta's own Cloud API directly. The interface
// (sendWhatsappTemplateMessage) stays the same for the rest of the app.

type SendResult = { success: boolean; messageId?: string };

export async function sendWhatsappTemplateMessage(params: {
  to: string; // E.164 format e.g. +919876543210
  templateName: string;
  variables: Record<string, string>;
}): Promise<SendResult> {
  const { to, templateName, variables } = params;

  // --- Example: Meta WhatsApp Cloud API ---
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
          name: templateName, // must exactly match a Meta-approved template
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

// Freeform text messages are only allowed within 24 hours of the customer's
// last inbound message (WhatsApp's "customer service window"). Do NOT use
// this for broadcasts/offers/order updates — those must use approved
// templates via sendWhatsappTemplateMessage above. This is only safe to call
// from the inbound webhook handler, replying to a message the customer just sent.
export async function sendWhatsappTextMessage(params: {
  to: string;
  text: string;
}): Promise<SendResult> {
  const { to, text } = params;
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
        type: "text",
        text: { body: text },
      }),
    },
  );

  const data = await res.json();

  if (!res.ok) {
    console.error("WhatsApp text send error:", data);
    return { success: false };
  }

  return { success: true, messageId: data.messages?.[0]?.id };
}
