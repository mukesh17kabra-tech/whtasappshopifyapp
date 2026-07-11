import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineGrid,
  Button,
  Badge,
  List,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import { BILLING_PLANS } from "~/billing-plans";

export async function loader({ request }: LoaderFunctionArgs) {
  const { billing } = await authenticate.admin(request);

  // Checks which (if any) paid plan is currently active for this shop.
  // isTest: true means charges won't actually bill real money — flip to
  // false (or remove) once you're ready to charge real merchants for real.
  const { hasActivePayment, appSubscriptions } = await billing.check({
    isTest: true,
  });

  return json({
    hasActivePayment,
    activePlan: appSubscriptions[0]?.name ?? null,
  });
}

const PLAN_DETAILS = [
  {
    key: "FREE",
    name: "Free",
    price: "$0",
    features: [
      "Popup number/name capture",
      "Order confirmation messages",
      "Shipment tracking updates",
      "Up to 100 subscribers",
    ],
  },
  {
    key: BILLING_PLANS.GROWTH,
    name: "Growth",
    price: "$9.99/mo",
    features: [
      "Everything in Free",
      "Unlimited subscribers",
      "Marketing broadcasts",
      "CSV bulk import",
      "7-day free trial",
    ],
  },
  {
    key: BILLING_PLANS.PRO,
    name: "Pro",
    price: "$29.99/mo",
    features: [
      "Everything in Growth",
      "Priority support",
      "Multiple popup campaigns (coming soon)",
      "7-day free trial",
    ],
  },
];

export default function Billing() {
  const { hasActivePayment, activePlan } = useLoaderData<typeof loader>();

  return (
    <Page title="Plans & Billing">
      <BlockStack gap="400">
        {hasActivePayment ? (
          <Banner tone="success">
            You're on the <strong>{activePlan}</strong> plan.
          </Banner>
        ) : (
          <Banner tone="info">
            You're on the Free plan. Upgrade to unlock marketing broadcasts
            and unlimited subscribers.
          </Banner>
        )}

        <InlineGrid columns={3} gap="400">
          {PLAN_DETAILS.map((plan) => {
            const isCurrent =
              (plan.key === "FREE" && !hasActivePayment) ||
              plan.key === activePlan;

            return (
              <Card key={plan.key}>
                <BlockStack gap="300">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      {plan.name}
                    </Text>
                    <Text as="p" variant="heading2xl">
                      {plan.price}
                    </Text>
                  </BlockStack>

                  <List type="bullet">
                    {plan.features.map((f) => (
                      <List.Item key={f}>{f}</List.Item>
                    ))}
                  </List>

                  {isCurrent ? (
                    <Badge tone="success">Current plan</Badge>
                  ) : plan.key === "FREE" ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      Downgrade by cancelling your plan in Shopify's billing
                      settings.
                    </Text>
                  ) : (
                    <Form method="post" action="/app/billing/subscribe">
                      <input type="hidden" name="plan" value={plan.key} />
                      <Button submit variant="primary">
                        Choose {plan.name}
                      </Button>
                    </Form>
                  )}
                </BlockStack>
              </Card>
            );
          })}
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}
