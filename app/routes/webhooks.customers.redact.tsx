import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

// GDPR mandatory webhook: erase a specific customer's data. Shopify sends
// this 10 days after a customer requests deletion (or 48 hours after
// certain account deletions) — must actually delete matching records, not
// just acknowledge.
export async function action({ request }: ActionFunctionArgs) {
  const { shop, payload, topic } = await authenticate.webhook(request);

  const shopRow = await prisma.shop.findUnique({ where: { shopDomain: shop } });
  if (shopRow) {
    const customerPhone = (payload as any)?.customer?.phone;
    if (customerPhone) {
      // Delete their subscriber/opt-in record and any message history tied
      // to their number for this shop.
      await prisma.optin.deleteMany({
        where: { shopId: shopRow.id, phoneNumber: customerPhone },
      });
      await prisma.messageLog.deleteMany({
        where: { shopId: shopRow.id, phoneNumber: customerPhone },
      });
      await prisma.orderTracking.deleteMany({
        where: { shopId: shopRow.id, phoneNumber: customerPhone },
      });
      console.log(`[GDPR] Erased data for customer ${customerPhone} on ${shop}`);
    }
  }

  console.log(`Webhook ${topic} processed for ${shop}`);
  return new Response(null, { status: 200 });
}
