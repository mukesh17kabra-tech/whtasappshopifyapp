import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

// This route is exposed via Shopify's App Proxy (configured in shopify.app.toml
// as e.g. /apps/whatsapp-offers -> /api/optin). Shopify signs proxy requests,
// and authenticate.public.appProxy() verifies that signature — so this can
// safely be called from the storefront without a customer login.
export async function action({ request }: ActionFunctionArgs) {
  const { session, liquid } = await authenticate.public.appProxy(request);

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await request.json();
  const phoneNumber: string | undefined = body.phoneNumber;
  const consent: boolean = Boolean(body.consent);

  if (!phoneNumber || !consent) {
    return new Response(
      JSON.stringify({ error: "Phone number and consent are required" }),
      { status: 400 },
    );
  }

  // Basic E.164 sanity check — do stricter validation client-side too
  if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
    return new Response(JSON.stringify({ error: "Invalid phone number" }), {
      status: 400,
    });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) {
    return new Response(JSON.stringify({ error: "Shop not found" }), {
      status: 404,
    });
  }

  await prisma.optin.upsert({
    where: { shopId_phoneNumber: { shopId: shop.id, phoneNumber } },
    update: { optedOutAt: null },
    create: {
      shopId: shop.id,
      phoneNumber,
      source: "popup",
    },
  });

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
