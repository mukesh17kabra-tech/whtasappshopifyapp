import { json, type ActionFunctionArgs } from "@remix-run/node";
import { useActionData } from "@remix-run/react";
import { Page, Card, Banner, BlockStack, Button } from "@shopify/polaris";
import { authenticate } from "~/shopify.server";

export async function action({ request }: ActionFunctionArgs) {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const plan = String(formData.get("plan"));

  if (!plan) {
    return json({ error: "No plan specified." }, { status: 400 });
  }

  try {
    // Hardcoded true for now while testing on a development store — dev
    // stores cannot process real charges, so this must be true here.
    // Before submitting for App Store review, this needs to become
    // conditional again (false for real merchant stores) or the review
    // team's real paid-store test will be charged as a test transaction
    // instead of a real one.
    return await billing.request({
      plan,
      isTest: true,
      returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing`,
    });
  } catch (err) {
    if (err instanceof Response && err.status >= 300 && err.status < 400) {
      throw err;
    }
    console.error(`billing.request failed for plan "${plan}":`, err);
    if (err && typeof err === "object" && "errorData" in err) {
      console.error("billing.request errorData detail:", JSON.stringify((err as any).errorData));
    }
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