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
      amount: 9.99,
      currencyCode: "USD",
      interval: BillingInterval.Every30Days,
      trialDays: 7,
    },
    [BILLING_PLANS.GROWTH_YEARLY]: {
      amount: 95.90, // ~20% off 9.99 x 12
      currencyCode: "USD",
      interval: BillingInterval.Annual,
      trialDays: 7,
    },
    [BILLING_PLANS.PRO]: {
      amount: 18.99,
      currencyCode: "USD",
      interval: BillingInterval.Every30Days,
      trialDays: 7,
    },
    [BILLING_PLANS.PRO_YEARLY]: {
      amount: 182.30, // ~20% off 18.99 x 12
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
  },
  hooks: {
    afterAuth: async ({ session }) => {
      // Ensure a Shop row exists in our own tables right after install
      await prisma.shop.upsert({
        where: { shopDomain: session.shop },
        update: { uninstalled: false },
        create: { shopDomain: session.shop },
      });
    },
  },
});

export default shopify;
export const authenticate = shopify.authenticate;
export const sessionStorage = shopify.sessionStorage;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const unauthenticated = shopify.unauthenticated;
