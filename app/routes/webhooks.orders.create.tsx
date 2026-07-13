import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { queueWhatsappJob } from "~/services/queue.server";

// Shopify expects a response within ~5s. We write the event to Postgres
// and enqueue a background job, then return 200 immediately. The actual
// WhatsApp API call happens in the queue worker, never inline here.
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

  // Normalize to E.164 (+countrycode...) — Shopify sometimes stores phone
  // numbers without a leading '+' even when a country code is present.
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

    // Auto-add this customer to the Subscribers table so merchants can see
    // everyone who's placed an order — but with marketingConsent: false,
    // since placing an order isn't marketing opt-in. Utility messages
    // (this order confirmation, shipping updates) still send regardless;
    // only broadcast/marketing sends respect this flag. If this number
    // already opted in via the popup, don't downgrade their consent.
    await prisma.optin.upsert({
      where: { shopId_phoneNumber: { shopId: shopRow.id, phoneNumber } },
      update: { name: fullName ?? undefined },
      create: {
        shopId: shopRow.id,
        phoneNumber,
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
  }

  console.log(`Webhook ${topic} processed for ${shop}`);
  return new Response(null, { status: 200 });
}
