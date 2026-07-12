import type { ActionFunctionArgs } from "@remix-run/node";
import { Receiver } from "@upstash/qstash";
import prisma from "~/db.server";
import { sendWhatsappCustomMessage } from "~/services/whatsapp.server";
import { renderTemplateBody } from "~/services/template.server";
import type { WhatsappJob } from "~/services/queue.server";

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
});

// Built-in fallback text used only if a merchant hasn't composed their own
// Order Notification template yet for a given category — so orders still
// get *something* sent rather than nothing.
const DEFAULT_ORDER_TEMPLATES: Record<string, string> = {
  ORDER_CONFIRMATION: "Hi {first_name}, your order {order_number} has been confirmed! Total: {order_total}.",
  SHIPPED: "Hi {first_name}, your order {order_number} has shipped! Track it here: {tracking_url}",
  OUT_FOR_DELIVERY: "Hi {first_name}, your order {order_number} is out for delivery today!",
  DELIVERED: "Hi {first_name}, your order {order_number} has been delivered. Enjoy!",
  DELIVERY_ATTEMPTED: "Hi {first_name}, we attempted to deliver your order {order_number} but couldn't reach you. We'll try again soon.",
  DELIVERY_FAILED: "Hi {first_name}, unfortunately delivery of your order {order_number} failed. Please contact us for help.",
};

export async function action({ request }: ActionFunctionArgs) {
  const bodyText = await request.text();
  const signature = request.headers.get("upstash-signature");

  if (signature) {
    try {
      const valid = await receiver.verify({ signature, body: bodyText });
      if (!valid) return new Response("invalid signature", { status: 401 });
    } catch (err) {
      console.error("QStash signature verification failed", err);
      return new Response("invalid signature", { status: 401 });
    }
  } else {
    console.warn("Missing upstash-signature header on job request");
  }

  const job: WhatsappJob = JSON.parse(bodyText);

  const shop = await prisma.shop.findUnique({ where: { id: job.shopId } });
  if (!shop) return new Response("shop not found", { status: 200 });

  if (!shop.whatsappBridgeConnected) {
    console.error(`Shop ${job.shopId} hasn't connected WhatsApp yet — skipping send.`);
    return new Response("WhatsApp not connected for this shop", { status: 200 });
  }

  const optin = await prisma.optin.findUnique({
    where: { shopId_phoneNumber: { shopId: job.shopId, phoneNumber: job.phoneNumber } },
  });
  if (optin?.optedOutAt) {
    console.log(`Skipping send to ${job.phoneNumber}: opted out`);
    return new Response(null, { status: 200 });
  }

  try {
    let renderedText: string;
    let imageUrl: string | null = null;
    let templateNameForLog: string;

    if (job.type === "broadcast_message") {
      const template = await prisma.template.findUnique({ where: { id: job.templateId } });
      if (!template) throw new Error(`Template ${job.templateId} not found`);

      // Broadcasts only have first_name (from the popup's Name field) —
      // no order context exists for a generic broadcast.
      renderedText = renderTemplateBody(template.body, { first_name: optin?.name || "there" });
      imageUrl = template.imageUrl;
      templateNameForLog = template.name;
    } else {
      // order_confirmation or shipment_update — pull real order data and
      // the merchant's own composed template for this category (falling
      // back to a sensible default if they haven't made one yet).
      const tracking = await prisma.orderTracking.findFirst({
        where: { shopId: job.shopId, shopifyOrderId: job.orderId },
      });

      const category = job.type === "order_confirmation" ? "ORDER_CONFIRMATION" : (tracking?.lastTemplateSent || "SHIPPED");

      const template = await prisma.template.findFirst({
        where: { shopId: job.shopId, category },
        orderBy: { createdAt: "desc" },
      });

      const body = template?.body || DEFAULT_ORDER_TEMPLATES[category] || "Update on your order {order_number}.";
      imageUrl = template?.imageUrl ?? null;
      templateNameForLog = template?.name || `(default ${category})`;

      renderedText = renderTemplateBody(body, {
        first_name: tracking?.customerFirstName || optin?.name || "there",
        last_name: tracking?.customerLastName || undefined,
        order_id: job.orderId,
        order_number: tracking?.orderNumber || job.orderNumber || job.orderId,
        order_total: tracking?.orderTotal || undefined,
        order_url: tracking?.orderUrl || undefined,
        tracking_number: tracking?.trackingNumber || undefined,
        tracking_company: tracking?.trackingCompany || undefined,
        tracking_url: job.type === "shipment_update" ? (job.trackingUrl ?? tracking?.trackingUrl ?? undefined) : tracking?.trackingUrl || undefined,
      });
    }

    const result = await sendWhatsappCustomMessage({
      shopId: job.shopId,
      to: job.phoneNumber,
      text: renderedText,
      imageUrl,
    });

    await prisma.messageLog.create({
      data: {
        shopId: job.shopId,
        phoneNumber: job.phoneNumber,
        templateUsed: templateNameForLog,
        status: result.success ? "sent" : "failed",
        providerMessageId: result.messageId ?? null,
      },
    });

    if (job.type === "broadcast_message") {
      await prisma.broadcast.update({
        where: { id: job.broadcastId },
        data: { sentCount: { increment: 1 } },
      });
    }

    return new Response(null, { status: 200 });
  } catch (err) {
    console.error("WhatsApp send failed", err);
    return new Response("send failed", { status: 500 });
  }
}
