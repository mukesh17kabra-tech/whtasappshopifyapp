import type { ActionFunctionArgs } from "@remix-run/node";
import { verifySignatureAppRouter } from "@upstash/qstash/dist/nextjs"; // swap for remix-compatible verify if needed
import prisma from "../db.server";
import { sendWhatsappTemplateMessage } from "../services/whatsapp.server";
import type { WhatsappJob } from "../services/queue.server";

// This route is called by QStash (not by the browser or Shopify).
// It performs the real WhatsApp send and logs the result.
export async function action({ request }: ActionFunctionArgs) {
  const job: WhatsappJob = await request.json();

  const shop = await prisma.shop.findUnique({ where: { id: job.shopId } });
  if (!shop) return new Response("shop not found", { status: 200 });

  // Defense in depth: re-check opt-out status right before sending, in case
  // the customer opted out after the broadcast was queued but before this
  // job ran (QStash jobs can sit in the queue for a bit under load).
  const optin = await prisma.optin.findUnique({
    where: { shopId_phoneNumber: { shopId: job.shopId, phoneNumber: job.phoneNumber } },
  });
  if (optin?.optedOutAt) {
    console.log(`Skipping send to ${job.phoneNumber}: opted out`);
    return new Response(null, { status: 200 });
  }


  try {
    let templateName: string;
    let variables: Record<string, string> = {};

    if (job.type === "order_confirmation") {
      templateName = "order_confirmation";
      variables = { order_number: job.orderNumber ?? job.orderId };
    } else if (job.type === "shipment_update") {
      // template name is stored per-order (set by the fulfillment webhook)
      // so out_for_delivery / delivered / delivery_failed all route through
      // this same job type but render different approved templates
      const tracking = await prisma.orderTracking.findFirst({
        where: { shopId: job.shopId, shopifyOrderId: job.orderId },
      });
      templateName = tracking?.lastTemplateSent || "shipment_update";
      variables = {
        order_number: job.orderId,
        tracking_url: job.trackingUrl ?? tracking?.trackingUrl ?? "",
      };
    } else {
      templateName = job.templateId;
    }


    const result = await sendWhatsappTemplateMessage({
      to: job.phoneNumber,
      templateName,
      variables,
    });

    await prisma.messageLog.create({
      data: {
        shopId: job.shopId,
        phoneNumber: job.phoneNumber,
        templateUsed: templateName,
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
    // Returning 500 lets QStash retry automatically per the retry policy
    return new Response("send failed", { status: 500 });
  }
}
