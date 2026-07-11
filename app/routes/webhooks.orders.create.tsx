import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { queueWhatsappJob } from "~/services/queue.server";

// Shopify expects a response within ~5s. We write the event to Postgres
// and enqueue a background job, then return 200 immediately. The actual
// WhatsApp API call happens in the queue worker (see services/queue.server.ts),
// never inline here.
export async function action({ request }: ActionFunctionArgs) {
  const { shop, payload, topic } = await authenticate.webhook(request);

  const shopRow = await prisma.shop.findUnique({ where: { shopDomain: shop } });
  if (!shopRow) {
    // Shop not found locally (shouldn't normally happen) — ack anyway so
    // Shopify doesn't retry indefinitely.
    return new Response(null, { status: 200 });
  }

  const order = payload as any;
  const phoneNumber = order?.customer?.phone || order?.phone || null;

  if (phoneNumber) {
    await prisma.orderTracking.upsert({
      where: {
        shopId_shopifyOrderId: {
          shopId: shopRow.id,
          shopifyOrderId: String(order.id),
        },
      },
      update: { status: "confirmed" },
      create: {
        shopId: shopRow.id,
        shopifyOrderId: String(order.id),
        phoneNumber,
        status: "confirmed",
      },
    });

    // Fire-and-forget: enqueue actual WhatsApp send to a background worker
    await queueWhatsappJob({
      type: "order_confirmation",
      shopId: shopRow.id,
      phoneNumber,
      orderId: String(order.id),
      orderNumber: order.name,
    });
  }

  console.log(`Webhook ${topic} processed for ${shop}`);
  return new Response(null, { status: 200 });
}
