import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { queueWhatsappJob } from "../services/queue.server";

// Handles both FULFILLMENTS_CREATE and FULFILLMENTS_UPDATE.
// Shopify's fulfillment payload includes tracking_company, tracking_number,
// tracking_url, and shipment_status (e.g. "in_transit", "out_for_delivery",
// "delivered"). We map shipment_status to a WhatsApp template and send it.
export async function action({ request }: ActionFunctionArgs) {
  const { shop, payload, topic } = await authenticate.webhook(request);

  const shopRow = await prisma.shop.findUnique({ where: { shopDomain: shop } });
  if (!shopRow) {
    return new Response(null, { status: 200 });
  }

  const fulfillment = payload as any;

  // order_id is present directly on the fulfillment payload
  const shopifyOrderId = String(fulfillment.order_id ?? fulfillment.id);
  const trackingUrl: string | undefined =
    fulfillment.tracking_url ||
    (Array.isArray(fulfillment.tracking_urls) ? fulfillment.tracking_urls[0] : undefined);
  const trackingNumber: string | undefined = fulfillment.tracking_number;
  const trackingCompany: string | undefined = fulfillment.tracking_company;

  // Map Shopify's shipment_status to our own status + which template to send.
  // shipment_status can be: null (just created), "in_transit", "out_for_delivery",
  // "delivered", "failure", "attempted_delivery"
  const rawStatus: string | null = fulfillment.shipment_status ?? null;
  const statusMap: Record<string, { status: string; template: string }> = {
    in_transit: { status: "shipped", template: "shipment_update" },
    out_for_delivery: { status: "out_for_delivery", template: "out_for_delivery" },
    delivered: { status: "delivered", template: "order_delivered" },
    attempted_delivery: { status: "delivery_attempted", template: "delivery_attempted" },
    failure: { status: "delivery_failed", template: "delivery_failed" },
  };
  const mapped = rawStatus
    ? statusMap[rawStatus]
    : { status: "shipped", template: "shipment_update" }; // null status = fulfillment just created

  const existing = await prisma.orderTracking.findUnique({
    where: {
      shopId_shopifyOrderId: { shopId: shopRow.id, shopifyOrderId },
    },
  });

  // Fall back to fulfillment's destination phone if we don't have it stored yet
  const phoneNumber =
    existing?.phoneNumber ||
    fulfillment.destination?.phone ||
    null;

  if (!phoneNumber || !mapped) {
    console.log(`Skipping ${topic}: no phone number or unmapped status (${rawStatus})`);
    return new Response(null, { status: 200 });
  }

  // Avoid sending duplicate messages for the same status
  if (existing?.lastTemplateSent === mapped.template) {
    return new Response(null, { status: 200 });
  }

  await prisma.orderTracking.upsert({
    where: { shopId_shopifyOrderId: { shopId: shopRow.id, shopifyOrderId } },
    update: {
      status: mapped.status,
      trackingUrl: trackingUrl ?? existing?.trackingUrl,
      lastTemplateSent: mapped.template,
    },
    create: {
      shopId: shopRow.id,
      shopifyOrderId,
      phoneNumber,
      status: mapped.status,
      trackingUrl,
      lastTemplateSent: mapped.template,
    },
  });

  await queueWhatsappJob({
    type: "shipment_update",
    shopId: shopRow.id,
    phoneNumber,
    orderId: shopifyOrderId,
    trackingUrl,
  });

  console.log(
    `Webhook ${topic} processed for ${shop}: order ${shopifyOrderId} -> ${mapped.status}` +
      (trackingCompany ? ` via ${trackingCompany}` : "") +
      (trackingNumber ? ` (#${trackingNumber})` : ""),
  );

  return new Response(null, { status: 200 });
}
