import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

// GDPR mandatory webhook: Shopify sends this 48 hours after a shop
// uninstalls the app, requiring you to erase all of that shop's data.
// Deletes everything tied to this shop across every table.
export async function action({ request }: ActionFunctionArgs) {
  const { shop, topic } = await authenticate.webhook(request);

  const shopRow = await prisma.shop.findUnique({ where: { shopDomain: shop } });
  if (shopRow) {
    const shopId = shopRow.id;
    await prisma.$transaction([
      prisma.optin.deleteMany({ where: { shopId } }),
      prisma.orderTracking.deleteMany({ where: { shopId } }),
      prisma.template.deleteMany({ where: { shopId } }),
      prisma.broadcast.deleteMany({ where: { shopId } }),
      prisma.messageLog.deleteMany({ where: { shopId } }),
      prisma.popupSettings.deleteMany({ where: { shopId } }),
      prisma.chatbotSettings.deleteMany({ where: { shopId } }),
      prisma.supportMessage.deleteMany({ where: { shopId } }),
      prisma.session.deleteMany({ where: { shop } }),
      prisma.shop.delete({ where: { id: shopId } }),
    ]);
    console.log(`[GDPR] Erased all data for shop ${shop}`);
  }

  console.log(`Webhook ${topic} processed for ${shop}`);
  return new Response(null, { status: 200 });
}
