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

  // No isTest flag — this now triggers real Shopify billing. Merchants
  // will see an actual charge confirmation screen, and be genuinely billed
  // after their trial ends.
  return billing.request({
    plan,
    returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing`,
  });
}
