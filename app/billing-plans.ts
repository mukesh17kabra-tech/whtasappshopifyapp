// Plan name constants — kept in their own file with zero server-only
// imports, since these are referenced both in shopify.server.ts (for the
// billing config) and directly in route components (for rendering plan
// cards). Importing shopify.server.ts itself into a component breaks
// Remix's client/server code splitting — see app.billing.tsx.
//
// All plans are paid — no free tier. Every plan includes a 7-day free
// trial (configured in shopify.server.ts), so merchants get to try before
// being charged, but there's no permanent free usage.
export const BILLING_PLANS = {
  BASIC: "Basic",
  BASIC_YEARLY: "Basic (Yearly)",
  GROWTH: "Growth",
  GROWTH_YEARLY: "Growth (Yearly)",
  PRO: "Pro",
  PRO_YEARLY: "Pro (Yearly)",
} as const;

// Plans that unlock marketing broadcasts (Basic covers order/utility
// messaging + chatbot only — broadcasts are a Growth+ feature).
export const BROADCAST_ELIGIBLE_PLANS: string[] = [
  BILLING_PLANS.GROWTH,
  BILLING_PLANS.GROWTH_YEARLY,
  BILLING_PLANS.PRO,
  BILLING_PLANS.PRO_YEARLY,
];
