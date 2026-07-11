import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { sendWhatsappTextMessage } from "../services/whatsapp.server";

// Meta calls this with a GET request once, when you register the webhook
// URL in your App's WhatsApp > Configuration settings, to verify you control
// this endpoint. It sends hub.challenge and expects it echoed back verbatim.
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
// ANY message to your WhatsApp number (replies, or the words STOP/START).
// This is the mechanism required for compliant opt-out handling: WhatsApp
// requires you to honor STOP-style replies immediately.
export async function action({ request }: ActionFunctionArgs) {
  const body = await request.json();

  // Meta's webhook payload shape: entry[].changes[].value.messages[]
  const entries = body.entry ?? [];

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const messages = value?.messages ?? [];

      for (const message of messages) {
        const from: string = message.from; // phone number without '+'
        const phoneNumber = from.startsWith("+") ? from : `+${from}`;
        const text: string = (message.text?.body ?? "").trim().toLowerCase();

        if (!text) continue;

        const isOptOut = OPT_OUT_KEYWORDS.some((kw) => text === kw || text.includes(kw));
        const isOptIn = OPT_OUT_KEYWORDS.length && OPT_IN_KEYWORDS.some((kw) => text === kw);

        if (isOptOut) {
          await handleOptOut(phoneNumber, value?.metadata?.phone_number_id);
        } else if (isOptIn) {
          await handleOptIn(phoneNumber, value?.metadata?.phone_number_id);
        }
        // Any other inbound text is just logged/ignored here — you could
        // route it to a support inbox if you want two-way chat later.
      }
    }
  }

  // Always ack 200 quickly — Meta retries aggressively on non-200 responses
  return new Response(null, { status: 200 });
}

async function handleOptOut(phoneNumber: string, phoneNumberId?: string) {
  // A phone number can be opted in across multiple shops (each shop has its
  // own popup), so we opt them out everywhere that number appears active.
  await prisma.optin.updateMany({
    where: { phoneNumber, optedOutAt: null },
    data: { optedOutAt: new Date() },
  });

  await sendWhatsappTextMessage({
    to: phoneNumber,
    text: "You've been unsubscribed from offer and order updates. Reply START to opt back in anytime.",
  });
}

async function handleOptIn(phoneNumber: string, phoneNumberId?: string) {
  await prisma.optin.updateMany({
    where: { phoneNumber, optedOutAt: { not: null } },
    data: { optedOutAt: null },
  });

  await sendWhatsappTextMessage({
    to: phoneNumber,
    text: "You're re-subscribed! You'll get offer and order updates on WhatsApp again.",
  });
}
