import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
  DeliveryMethod,
  BillingInterval,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { BILLING_PLANS } from "./billing-plans";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: {
    [BILLING_PLANS.BASIC]: {
      amount: 4.99,
      currencyCode: "USD",
      interval: BillingInterval.Every30Days,
      trialDays: 7,
    },
    [BILLING_PLANS.BASIC_YEARLY]: {
      amount: 47.90, // ~20% off 4.99 x 12
      currencyCode: "USD",
      interval: BillingInterval.Annual,
      trialDays: 7,
    },
    [BILLING_PLANS.GROWTH]: {
      amount: 8.99,
      currencyCode: "USD",
      interval: BillingInterval.Every30Days,
      trialDays: 7,
    },
    [BILLING_PLANS.GROWTH_YEARLY]: {
      amount: 86.30, // ~20% off 8.99 x 12
      currencyCode: "USD",
      interval: BillingInterval.Annual,
      trialDays: 7,
    },
    [BILLING_PLANS.PRO]: {
      amount: 14.99,
      currencyCode: "USD",
      interval: BillingInterval.Every30Days,
      trialDays: 7,
    },
    [BILLING_PLANS.PRO_YEARLY]: {
      amount: 143.90, // ~20% off 14.99 x 12
      currencyCode: "USD",
      interval: BillingInterval.Annual,
      trialDays: 7,
    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
  },
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/app/uninstalled",
    },
    ORDERS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders/create",
    },
    FULFILLMENTS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/fulfillments/update",
    },
    FULFILLMENTS_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/fulfillments/update",
    },
    // GDPR-mandatory webhooks — required by Shopify for App Store listing,
    // regardless of whether you actually store EU customer data. Shopify
    // sends these automatically; every public app must handle them.
    CUSTOMERS_DATA_REQUEST: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/customers/data_request",
    },
    CUSTOMERS_REDACT: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/customers/redact",
    },
    SHOP_REDACT: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/shop/redact",
    },
  },
  hooks: {
    afterAuth: async ({ session }) => {
      // Ensure a Shop row exists in our own tables right after install
      await prisma.shop.upsert({
        where: { shopDomain: session.shop },
        update: { uninstalled: false },
        create: { shopDomain: session.shop },
      });

      // CRITICAL: this actually tells Shopify to start sending webhook
      // events (ORDERS_CREATE, FULFILLMENTS_UPDATE, etc.) to our callback
      // URLs for this specific shop. Without this call, the `webhooks`
      // config above only *describes* what we want — it never registers
      // it with Shopify's API, so no webhook ever actually fires.
      //
      // Logged explicitly (success or failure) so this is visible in
      // Vercel's runtime logs right at install time — search logs for
      // "registerWebhooks" to confirm this ran for a given shop.
      try {
        const results = await shopify.registerWebhooks({ session });
        console.log(`registerWebhooks succeeded for ${session.shop}:`, JSON.stringify(results));
      } catch (err) {
        console.error(`registerWebhooks FAILED for ${session.shop}:`, err);
      }
    },
  },
});

export default shopify;
export const authenticate = shopify.authenticate;
export const sessionStorage = shopify.sessionStorage;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const unauthenticated = shopify.unauthenticated;
