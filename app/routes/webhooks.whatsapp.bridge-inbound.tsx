import type { ActionFunctionArgs } from "@remix-run/node";
import prisma from "~/db.server";
import { sendWhatsappTextMessage } from "~/services/whatsapp.server";

const OPT_OUT_KEYWORDS = ["stop", "unsubscribe", "opt out", "optout", "cancel"];
const OPT_IN_KEYWORDS = ["start", "subscribe", "opt in", "optin"];

// Receives forwarded inbound messages from whatsapp-bridge-service (see its
// index.js "messages.upsert" handler). Simpler payload than Meta's webhook:
// just { from: "+91...", text: "..." }. Same opt-out/opt-in logic as the
// Meta inbound webhook, just a different entry point.
export async function action({ request }: ActionFunctionArgs) {
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.WHATSAPP_BRIDGE_SECRET}`;
  if (!process.env.WHATSAPP_BRIDGE_SECRET || auth !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { from, text } = await request.json();
  if (!from || !text) {
    return new Response(null, { status: 200 });
  }

  const normalized = String(text).trim().toLowerCase();
  const isOptOut = OPT_OUT_KEYWORDS.some((kw) => normalized === kw || normalized.includes(kw));
  const isOptIn = OPT_IN_KEYWORDS.some((kw) => normalized === kw);

  if (isOptOut) {
    await prisma.optin.updateMany({
      where: { phoneNumber: from, optedOutAt: null },
      data: { optedOutAt: new Date() },
    });
    await sendWhatsappTextMessage({
      to: from,
      text: "You've been unsubscribed from offer and order updates. Reply START to opt back in anytime.",
    });
  } else if (isOptIn) {
    await prisma.optin.updateMany({
      where: { phoneNumber: from, optedOutAt: { not: null } },
      data: { optedOutAt: null },
    });
    await sendWhatsappTextMessage({
      to: from,
      text: "You're re-subscribed! You'll get offer and order updates on WhatsApp again.",
    });
  }

  return new Response(null, { status: 200 });
}
