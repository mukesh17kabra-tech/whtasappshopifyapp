import { json, type ActionFunctionArgs } from "@remix-run/node";
import { useActionData } from "@remix-run/react";
import { Page, Card, Banner, BlockStack, Button } from "@shopify/polaris";
import { authenticate } from "~/shopify.server";

// Triggers billing.request(), which redirects the merchant to Shopify's own
// subscription approval page — Shopify handles collecting payment details,
// you never touch card numbers directly. After approval, Shopify redirects
// back into your app.
export async function action({ request }: ActionFunctionArgs) {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const plan = String(formData.get("plan"));

  if (!plan) {
    return json({ error: "No plan specified." }, { status: 400 });
  }

  try {
    // billing.request() normally throws a redirect Response internally to
    // send the merchant to Shopify's approval screen — that's expected and
    // will propagate correctly. We only want to catch a genuine failure
    // (e.g. Billing API blocked/misconfigured on this store), not the
    // redirect itself.
    return await billing.request({
      plan,
      returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing`,
    });
  } catch (err) {
    // A thrown Response with a redirect status is the normal success path
    // — let it through unchanged rather than treating it as an error.
    if (err instanceof Response && err.status >= 300 && err.status < 400) {
      throw err;
    }
    console.error(`billing.request failed for plan "${plan}":`, err);
    const detail = err instanceof Error ? err.message : String(err);
    return json(
      { error: `Couldn't start checkout for this plan: ${detail}` },
      { status: 500 },
    );
  }
}

// Only rendered if the action above returns an error instead of redirecting
// (the normal success path never reaches this — the browser gets redirected
// to Shopify's approval page before any component here would render).
export default function BillingSubscribeError() {
  const actionData = useActionData<typeof action>();
  const error = actionData && "error" in actionData ? actionData.error : "Something went wrong starting checkout.";

  return (
    <Page title="Checkout error">
      <Card>
        <BlockStack gap="400">
          <Banner tone="critical">{error}</Banner>
          <Button url="/app/billing" variant="primary">
            Back to Billing
          </Button>
        </BlockStack>
      </Card>
    </Page>
  );
}
