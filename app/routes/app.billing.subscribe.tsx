import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";

// Triggers billing.request(), which redirects the merchant to Shopify's own
// subscription approval page — Shopify handles collecting payment details,
// you never touch card numbers directly. After approval, Shopify redirects
// back into your app.
export async function action({ request }: ActionFunctionArgs) {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const plan = String(formData.get("plan"));

  // isTest: true means no real money changes hands — this is required while
  // developing/testing. Set to false (or remove entirely) before submitting
  // your app for the Shopify App Store review / going live with real billing.
  return billing.request({
    plan,
    isTest: true,
    returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing`,
  });
}
