import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

export async function action({ request }: ActionFunctionArgs) {
  const { shop, session } = await authenticate.webhook(request);

  // Webhook can arrive after a shop was already uninstalled/re-installed;
  // session may be undefined in that race, so guard for it.
  if (session) {
    await prisma.session.deleteMany({ where: { shop } });
  }

  await prisma.shop.updateMany({
    where: { shopDomain: shop },
    data: { uninstalled: true },
  });

  return new Response(null, { status: 200 });
}
