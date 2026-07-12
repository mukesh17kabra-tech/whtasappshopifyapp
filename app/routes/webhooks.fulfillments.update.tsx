import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { queueWhatsappJob } from "~/services/queue.server";

// Handles both FULFILLMENTS_CREATE and FULFILLMENTS_UPDATE. Maps Shopify's
// shipment_status to one of our Order Template categories (see
// app.templates.tsx / ORDER_TEMPLATE_CATEGORIES) — each merchant composes
// their own wording for these in the Order Notifications tab; this webhook
// just supplies the real order data to fill in at send time.
export async function action({ request }: ActionFunctionArgs) {
  const { shop, payload, topic } = await authenticate.webhook(request);

  const shopRow = await prisma.shop.findUnique({ where: { shopDomain: shop } });
  if (!shopRow) {
    return new Response(null, { status: 200 });
  }

  const fulfillment = payload as any;
  const shopifyOrderId = String(fulfillment.order_id ?? fulfillment.id);
  const trackingUrl: string | undefined =
    fulfillment.tracking_url ||
    (Array.isArray(fulfillment.tracking_urls) ? fulfillment.tracking_urls[0] : undefined);
  const trackingNumber: string | undefined = fulfillment.tracking_number;
  const trackingCompany: string | undefined = fulfillment.tracking_company;

  const rawStatus: string | null = fulfillment.shipment_status ?? null;
  const statusMap: Record<string, { status: string; category: string }> = {
    in_transit: { status: "shipped", category: "SHIPPED" },
    out_for_delivery: { status: "out_for_delivery", category: "OUT_FOR_DELIVERY" },
    delivered: { status: "delivered", category: "DELIVERED" },
    attempted_delivery: { status: "delivery_attempted", category: "DELIVERY_ATTEMPTED" },
    failure: { status: "delivery_failed", category: "DELIVERY_FAILED" },
  };
  const mapped = rawStatus ? statusMap[rawStatus] : { status: "shipped", category: "SHIPPED" };

  const existing = await prisma.orderTracking.findUnique({
    where: { shopId_shopifyOrderId: { shopId: shopRow.id, shopifyOrderId } },
  });

  const phoneNumber = existing?.phoneNumber || fulfillment.destination?.phone || null;

  if (!phoneNumber || !mapped) {
    console.log(`Skipping ${topic}: no phone number or unmapped status (${rawStatus})`);
    return new Response(null, { status: 200 });
  }

  if (existing?.lastTemplateSent === mapped.category) {
    return new Response(null, { status: 200 });
  }

  await prisma.orderTracking.upsert({
    where: { shopId_shopifyOrderId: { shopId: shopRow.id, shopifyOrderId } },
    update: {
      status: mapped.status,
      trackingUrl: trackingUrl ?? existing?.trackingUrl,
      trackingNumber: trackingNumber ?? existing?.trackingNumber,
      trackingCompany: trackingCompany ?? existing?.trackingCompany,
      lastTemplateSent: mapped.category,
    },
    create: {
      shopId: shopRow.id,
      shopifyOrderId,
      phoneNumber,
      status: mapped.status,
      trackingUrl,
      trackingNumber,
      trackingCompany,
      lastTemplateSent: mapped.category,
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
