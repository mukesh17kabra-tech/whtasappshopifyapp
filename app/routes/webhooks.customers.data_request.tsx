import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

// GDPR mandatory webhook: a customer has requested their data from this
// merchant's store. Shopify requires every public app to handle this (even
// if you don't have EU customers) — you have 30 days to provide the data
// or confirm none is held. This just logs the request for the merchant to
// action manually; automating the actual data delivery back to the
// merchant/customer is out of scope for a first pass, but the mandatory
// endpoint itself must exist and return 200 for App Store approval.
export async function action({ request }: ActionFunctionArgs) {
  const { shop, payload, topic } = await authenticate.webhook(request);

  const shopRow = await prisma.shop.findUnique({ where: { shopDomain: shop } });
  if (shopRow) {
    const customerPhone = (payload as any)?.customer?.phone;
    if (customerPhone) {
      const optin = await prisma.optin.findFirst({
        where: { shopId: shopRow.id, phoneNumber: customerPhone },
      });
      console.log(
        `[GDPR] customers/data_request for ${customerPhone} on ${shop}: ` +
          (optin ? `found subscriber record (id: ${optin.id})` : "no matching subscriber record"),
      );
    }
  }

  console.log(`Webhook ${topic} processed for ${shop}`);
  return new Response(null, { status: 200 });
}
