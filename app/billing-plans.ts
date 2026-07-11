// Plan name constants — kept in their own file with zero server-only
// imports, since these are referenced both in shopify.server.ts (for the
// billing config) and directly in route components (for rendering plan
// cards). Importing shopify.server.ts itself into a component breaks
// Remix's client/server code splitting — see app.billing.tsx.
export const BILLING_PLANS = {
  GROWTH: "Growth",
  PRO: "Pro",
} as const;
