import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

// Exposed via Shopify's App Proxy, configured in shopify.app.toml as:
//   [app_proxy] url = ".../api/proxy", subpath = "whatsapp-offers", prefix = "apps"
// Shopify only maps ONE base URL per app proxy config, then appends whatever
// comes after — so /apps/whatsapp-offers/optin and
// /apps/whatsapp-offers/popup-config both land here, and we dispatch based
// on the trailing segment (params["*"]).

// GET /apps/whatsapp-offers/popup-config — storefront popup fetches this on
// page load to get the merchant's current settings and decide whether to
// show at all.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const path = params["*"] ?? "";

  if (path === "chatbot-data") {
    const { session, admin } = await authenticate.public.appProxy(request);
    if (!session || !admin) {
      return Response.json({ collections: [], whatsappNumber: null });
    }

    const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
    const chatbotSettings = shop
      ? await prisma.chatbotSettings.findUnique({ where: { shopId: shop.id } })
      : null;

    if (chatbotSettings && !chatbotSettings.enabled) {
      return Response.json({ enabled: false, collections: [], whatsappNumber: null });
    }

    try {
      const response = await admin.graphql(`
        query ChatbotData {
          collections(first: 15, sortKey: TITLE) {
            nodes {
              title
              handle
              products(first: 20) {
                nodes {
                  title
                  handle
                  onlineStoreUrl
                  featuredImage { url }
                  priceRangeV2 { minVariantPrice { amount currencyCode } }
                }
              }
            }
          }
        }
      `);
      const data = await response.json();
      const collections = (data?.data?.collections?.nodes ?? [])
        .map((c: any) => ({
          title: c.title,
          products: (c.products?.nodes ?? [])
            .filter((p: any) => p.priceRangeV2?.minVariantPrice?.amount)
            .map((p: any) => ({
              title: p.title,
              url: p.onlineStoreUrl || `https://${session.shop}/products/${p.handle}`,
              image: p.featuredImage?.url ?? null,
              price: parseFloat(p.priceRangeV2.minVariantPrice.amount),
              currency: p.priceRangeV2.minVariantPrice.currencyCode,
            })),
        }))
        .filter((c: any) => c.products.length > 0);

      return Response.json({
        enabled: true,
        collections,
        whatsappNumber: shop?.whatsappDisplayNumber ?? null,
        title: chatbotSettings?.title ?? "Find your product",
        tooltipText: chatbotSettings?.tooltipText ?? "Let's chat to find your product!",
        logoUrl: chatbotSettings?.logoUrl ?? null,
        position: chatbotSettings?.position ?? "bottom-right",
      });
    } catch (err) {
      console.error("Chatbot data fetch failed", err);
      return Response.json({
        enabled: true,
        collections: [],
        whatsappNumber: shop?.whatsappDisplayNumber ?? null,
        title: chatbotSettings?.title ?? "Find your product",
        tooltipText: chatbotSettings?.tooltipText ?? "Let's chat to find your product!",
        logoUrl: chatbotSettings?.logoUrl ?? null,
        position: chatbotSettings?.position ?? "bottom-right",
      });
    }
  }

  if (path !== "popup-config") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return Response.json({ enabled: false }, { status: 200 });
  }

  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) {
    return Response.json({ enabled: false }, { status: 200 });
  }

  const settings = await prisma.popupSettings.findUnique({
    where: { shopId: shop.id },
  });

  return Response.json({
    enabled: settings?.enabled ?? true,
    heading: settings?.heading ?? "Get offers on WhatsApp",
    subheading:
      settings?.subheading ??
      "Share your name and WhatsApp number to get offer alerts and order tracking updates.",
    imageUrl: settings?.imageUrl ?? null,
    delayMs: settings?.delayMs ?? 3000,
  });
}

// POST /apps/whatsapp-offers/optin — storefront popup submits name + phone here
export async function action({ request, params }: ActionFunctionArgs) {
  const path = params["*"] ?? "";

  if (path !== "optin") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const phoneNumber: string | undefined = body.phoneNumber;
  const name: string | undefined = body.name;
  const consent: boolean = Boolean(body.consent);

  if (!phoneNumber || !consent) {
    return Response.json(
      { error: "Phone number and consent are required" },
      { status: 400 },
    );
  }

  if (!name || !name.trim()) {
    return Response.json({ error: "Name is required" }, { status: 400 });
  }

  if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
    return Response.json({ error: "Invalid phone number" }, { status: 400 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) {
    return Response.json({ error: "Shop not found" }, { status: 404 });
  }

  await prisma.optin.upsert({
    where: { shopId_phoneNumber: { shopId: shop.id, phoneNumber } },
    update: { optedOutAt: null, name: name.trim() },
    create: {
      shopId: shop.id,
      phoneNumber,
      name: name.trim(),
      source: "popup",
    },
  });

  return Response.json({ success: true });
}
