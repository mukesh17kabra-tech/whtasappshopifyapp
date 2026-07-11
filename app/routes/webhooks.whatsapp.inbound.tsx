import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "~/db.server";
import { sendWhatsappTextMessage } from "~/services/whatsapp.server";

// Meta calls this with a GET request once, when you register the webhook
// URL in your Meta app's WhatsApp > Configuration settings, to verify you
// control this endpoint. Note: with per-shop Embedded Signup accounts, this
// single webhook URL receives inbound messages for EVERY connected
// merchant's number — Meta routes all of them here since you (the Tech
// Provider) own the webhook subscription. Individual messages carry
// metadata.phone_number_id telling you which merchant's number it's for.
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

const OPT_OUT_KEYWORDS = ["stop", "unsubscribe", "opt out", "optout", "cancel"];
const OPT_IN_KEYWORDS = ["start", "subscribe", "opt in", "optin"];

// This is Meta's inbound message webhook — fires whenever a customer sends
// ANY message to any connected merchant's WhatsApp number. Required for
// compliant opt-out handling: WhatsApp requires you to honor STOP-style
// replies immediately.
export async function action({ request }: ActionFunctionArgs) {
  const body = await request.json();
  const entries = body.entry ?? [];

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const messages = value?.messages ?? [];
      const phoneNumberId: string | undefined = value?.metadata?.phone_number_id;

      if (!phoneNumberId) continue;

      // Route to the correct shop by which merchant's number received this
      const shop = await prisma.shop.findFirst({
        where: { whatsappPhoneNumberId: phoneNumberId },
      });
      if (!shop) {
        console.warn(`Inbound message for unknown phone_number_id ${phoneNumberId}`);
        continue;
      }

      for (const message of messages) {
        const from: string = message.from;
        const phoneNumber = from.startsWith("+") ? from : `+${from}`;
        const text: string = (message.text?.body ?? "").trim().toLowerCase();
        if (!text) continue;

        const isOptOut = OPT_OUT_KEYWORDS.some((kw) => text === kw || text.includes(kw));
        const isOptIn = OPT_IN_KEYWORDS.some((kw) => text === kw);

        const credentials = {
          phoneNumberId: shop.whatsappPhoneNumberId!,
          accessToken: shop.whatsappAccessToken!,
        };

        if (isOptOut) {
          await prisma.optin.updateMany({
            where: { shopId: shop.id, phoneNumber, optedOutAt: null },
            data: { optedOutAt: new Date() },
          });
          await sendWhatsappTextMessage({
            to: phoneNumber,
            text: "You've been unsubscribed from offer and order updates. Reply START to opt back in anytime.",
            credentials,
          });
        } else if (isOptIn) {
          await prisma.optin.updateMany({
            where: { shopId: shop.id, phoneNumber, optedOutAt: { not: null } },
            data: { optedOutAt: null },
          });
          await sendWhatsappTextMessage({
            to: phoneNumber,
            text: "You're re-subscribed! You'll get offer and order updates on WhatsApp again.",
            credentials,
          });
        }
        // Any other inbound text is just logged/ignored here — you could
        // route it to a support inbox if you want two-way chat later.
      }
    }
  }

  // Always ack 200 quickly — Meta retries aggressively on non-200 responses
  return new Response(null, { status: 200 });
}
