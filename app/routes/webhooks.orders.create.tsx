import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { queueWhatsappJob } from "~/services/queue.server";
import { startFlowRun } from "~/services/flow-engine.server";

export async function action({ request }: ActionFunctionArgs) {
  const { shop, payload, topic } = await authenticate.webhook(request);

  const shopRow = await prisma.shop.findUnique({ where: { shopDomain: shop } });
  if (!shopRow) {
    return new Response(null, { status: 200 });
  }

  const order = payload as any;
  const rawPhoneNumber =
    order?.customer?.phone ||
    order?.phone ||
    order?.shipping_address?.phone ||
    order?.billing_address?.phone ||
    null;

  const phoneNumber = rawPhoneNumber
    ? (rawPhoneNumber.trim().startsWith("+") ? rawPhoneNumber.trim() : `+${rawPhoneNumber.replace(/\D/g, "")}`)
    : null;

  if (!rawPhoneNumber) {
    console.warn(
      `Order ${order?.id} has no phone number anywhere (customer, order, shipping, or billing address) — skipping WhatsApp send.`,
    );
  }

  if (phoneNumber) {
    const firstName = order?.customer?.first_name || "";
    const lastName = order?.customer?.last_name || "";
    const fullName = `${firstName} ${lastName}`.trim() || null;
    const orderTotal = order?.total_price ? `${order.currency ?? ""} ${order.total_price}`.trim() : null;
    const orderUrl = order?.order_status_url || null;
    const email = order?.customer?.email || order?.email || order?.contact_email || null;

    await prisma.optin.upsert({
      where: { shopId_phoneNumber: { shopId: shopRow.id, phoneNumber } },
      update: { name: fullName ?? undefined, email: email ?? undefined },
      create: {
        shopId: shopRow.id,
        phoneNumber,
        email,
        name: fullName,
        source: "order",
        marketingConsent: false,
      },
    });

    await prisma.orderTracking.upsert({
      where: {
        shopId_shopifyOrderId: { shopId: shopRow.id, shopifyOrderId: String(order.id) },
      },
      update: {
        status: "confirmed",
        customerFirstName: firstName || null,
        customerLastName: lastName || null,
        orderNumber: order.name,
        orderTotal,
        orderUrl,
      },
      create: {
        shopId: shopRow.id,
        shopifyOrderId: String(order.id),
        phoneNumber,
        customerFirstName: firstName || null,
        customerLastName: lastName || null,
        orderNumber: order.name,
        orderTotal,
        orderUrl,
        status: "confirmed",
      },
    });

    await queueWhatsappJob({
      type: "order_confirmation",
      shopId: shopRow.id,
      phoneNumber,
      orderId: String(order.id),
      orderNumber: order.name,
    });

    try {
      const orderFlows = await prisma.flow.findMany({
        where: { shopId: shopRow.id, trigger: "ORDER_PLACED", enabled: true },
      });
      for (const flow of orderFlows) {
        await startFlowRun({
          flowId: flow.id,
          shopId: shopRow.id,
          phoneNumber,
          email,
          customerName: firstName || fullName,
          orderId: String(order.id),
        });
      }
    } catch (err) {
      console.error(`Failed to start ORDER_PLACED flows for shop ${shopRow.id}:`, err);
    }
  }

  console.log(`Webhook ${topic} processed for ${shop}`);
  return new Response(null, { status: 200 });
}
