import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useSubmit } from "@remix-run/react";
import { useState, useCallback } from "react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Banner,
  Box,
  ButtonGroup,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { BILLING_PLANS } from "~/billing-plans";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, billing } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });

  const { hasActivePayment, appSubscriptions } = await billing.check({ isTest: true });

  return json({
    hasActivePayment,
    activePlan: appSubscriptions[0]?.name ?? null,
    manualPlanOverride: shop?.manualPlanOverride ?? null,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  // Dev-only bypass: directly sets a local flag instead of going through
  // Shopify's Billing API. Use this only when billing.request() is blocked
  // (e.g. some dev store configs return 403) — never a substitute for real
  // billing once you're charging actual merchants.
  if (intent === "dev-set-plan") {
    const plan = String(formData.get("plan"));
    await prisma.shop.update({
      where: { id: shop.id },
      data: { manualPlanOverride: plan === "Starter" ? null : plan },
    });
    return json({ success: true });
  }

  return json({ error: "Unknown action" }, { status: 400 });
}

const PLAN_FEATURES = {
  Starter: [
    "Popup number/name capture",
    "Order confirmation messages",
    "Shipment tracking updates",
    "Up to 100 subscribers",
  ],
  Growth: [
    "Everything in Starter",
    "Unlimited subscribers",
    "Marketing broadcasts",
    "CSV bulk import",
  ],
  Pro: [
    "Everything in Growth",
    "Priority support",
    "Multiple popup campaigns (coming soon)",
  ],
};

const COMPARISON_ROWS = [
  { feature: "Subscribers", Starter: "100", Growth: "Unlimited", Pro: "Unlimited" },
  { feature: "Order confirmations", Starter: "✓", Growth: "✓", Pro: "✓" },
  { feature: "Shipment tracking", Starter: "✓", Growth: "✓", Pro: "✓" },
  { feature: "Marketing broadcasts", Starter: "✕", Growth: "✓", Pro: "✓" },
  { feature: "CSV bulk import", Starter: "✕", Growth: "✓", Pro: "✓" },
  { feature: "Support", Starter: "Email", Growth: "Priority email", Pro: "Dedicated" },
];

export default function Billing() {
  const { hasActivePayment, activePlan, manualPlanOverride } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const [yearly, setYearly] = useState(false);

  const effectivePlan = manualPlanOverride || (hasActivePayment ? activePlan : "Starter");

  const handleDevSetPlan = useCallback(
    (plan: string) => {
      const formData = new FormData();
      formData.append("intent", "dev-set-plan");
      formData.append("plan", plan);
      submit(formData, { method: "post" });
    },
    [submit],
  );

  const growthPrice = yearly ? "$7.99" : "$9.99";
  const proPrice = yearly ? "$23.99" : "$29.99";
  const growthPlanKey = yearly ? BILLING_PLANS.GROWTH_YEARLY : BILLING_PLANS.GROWTH;
  const proPlanKey = yearly ? BILLING_PLANS.PRO_YEARLY : BILLING_PLANS.PRO;

  return (
    <Page title="Pricing plans" subtitle="Choose the plan that fits your store. Upgrade or downgrade anytime.">
      <BlockStack gap="400">
        <Banner tone="info">
          <strong>Test mode active</strong> — billing.isTest is set to true,
          so no real charges happen anywhere in this flow, on any store.
          Flip isTest to false in app.billing.tsx, app.billing.subscribe.tsx,
          and app.broadcasts.tsx before charging real merchants.
        </Banner>

        <Box>
          <ButtonGroup variant="segmented">
            <Button pressed={!yearly} onClick={() => setYearly(false)}>
              Monthly
            </Button>
            <Button pressed={yearly} onClick={() => setYearly(true)}>
              Yearly · Save 20%
            </Button>
          </ButtonGroup>
        </Box>

        <InlineStack gap="400" align="start" wrap={false}>
          <Box width="33%">
            <Card>
              <BlockStack gap="300">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingLg">Starter</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Perfect for new stores getting started
                  </Text>
                </BlockStack>
                <Text as="p" variant="heading2xl">Free</Text>
                <BlockStack gap="150">
                  {PLAN_FEATURES.Starter.map((f) => (
                    <Text key={f} as="p" variant="bodySm">✓ {f}</Text>
                  ))}
                </BlockStack>
                <Box paddingBlockStart="200">
                  {effectivePlan === "Starter" ? (
                    <Button fullWidth disabled>
                      ✓ Current plan
                    </Button>
                  ) : (
                    <Text as="p" variant="bodySm" tone="subdued">
                      Downgrade by cancelling your paid plan below.
                    </Text>
                  )}
                </Box>
              </BlockStack>
            </Card>
          </Box>

          <Box width="33%">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingLg">Growth</Text>
                  <Badge tone="attention">Most popular</Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  For growing stores that want to reach customers directly
                </Text>
                <InlineStack gap="100" blockAlign="baseline">
                  <Text as="p" variant="heading2xl">{growthPrice}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">/mo</Text>
                </InlineStack>
                <BlockStack gap="150">
                  {PLAN_FEATURES.Growth.map((f) => (
                    <Text key={f} as="p" variant="bodySm">✓ {f}</Text>
                  ))}
                </BlockStack>
                <Box paddingBlockStart="200">
                  {effectivePlan === BILLING_PLANS.GROWTH || effectivePlan === BILLING_PLANS.GROWTH_YEARLY ? (
                    <Button fullWidth disabled>
                      ✓ Current plan
                    </Button>
                  ) : (
                    <Form method="post" action="/app/billing/subscribe">
                      <input type="hidden" name="plan" value={growthPlanKey} />
                      <Button submit variant="primary" fullWidth>
                        Start Growth — 7 days free
                      </Button>
                    </Form>
                  )}
                </Box>
              </BlockStack>
            </Card>
          </Box>

          <Box width="33%">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingLg">Pro</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  For high-volume stores that need everything
                </Text>
                <InlineStack gap="100" blockAlign="baseline">
                  <Text as="p" variant="heading2xl">{proPrice}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">/mo</Text>
                </InlineStack>
                <BlockStack gap="150">
                  {PLAN_FEATURES.Pro.map((f) => (
                    <Text key={f} as="p" variant="bodySm">✓ {f}</Text>
                  ))}
                </BlockStack>
                <Box paddingBlockStart="200">
                  {effectivePlan === BILLING_PLANS.PRO || effectivePlan === BILLING_PLANS.PRO_YEARLY ? (
                    <Button fullWidth disabled>
                      ✓ Current plan
                    </Button>
                  ) : (
                    <Form method="post" action="/app/billing/subscribe">
                      <input type="hidden" name="plan" value={proPlanKey} />
                      <Button submit fullWidth>
                        Start Pro — 7 days free
                      </Button>
                    </Form>
                  )}
                </Box>
              </BlockStack>
            </Card>
          </Box>
        </InlineStack>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Feature comparison</Text>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e1e3e5" }}>
                  <th style={{ textAlign: "left", padding: "8px 0", fontSize: 13, color: "#6b7177" }}>Feature</th>
                  <th style={{ textAlign: "left", padding: "8px 0", fontSize: 13, color: "#6b7177" }}>Starter</th>
                  <th style={{ textAlign: "left", padding: "8px 0", fontSize: 13, color: "#6b7177" }}>Growth</th>
                  <th style={{ textAlign: "left", padding: "8px 0", fontSize: 13, color: "#6b7177" }}>Pro</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.feature} style={{ borderBottom: "1px solid #f1f1f1" }}>
                    <td style={{ padding: "10px 0", fontSize: 14 }}>{row.feature}</td>
                    <td style={{ padding: "10px 0", fontSize: 14 }}>{row.Starter}</td>
                    <td style={{ padding: "10px 0", fontSize: 14, color: "#008060", fontWeight: 600 }}>{row.Growth}</td>
                    <td style={{ padding: "10px 0", fontSize: 14, color: "#008060", fontWeight: 600 }}>{row.Pro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">
              Developer testing — bypass Shopify billing
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              If the Billing API is blocked (403) on your dev store, use
              these buttons to simulate a plan locally for testing. This
              only sets a flag on this shop's row — no real charge, and it's
              separate from Shopify's actual billing state.
            </Text>
            <ButtonGroup>
              <Button
                pressed={effectivePlan === "Starter"}
                onClick={() => handleDevSetPlan("Starter")}
              >
                {effectivePlan === "Starter" && "✓ "}Starter
              </Button>
              <Button
                pressed={effectivePlan === BILLING_PLANS.GROWTH}
                onClick={() => handleDevSetPlan(BILLING_PLANS.GROWTH)}
              >
                {effectivePlan === BILLING_PLANS.GROWTH && "✓ "}Growth
              </Button>
              <Button
                pressed={effectivePlan === BILLING_PLANS.PRO}
                onClick={() => handleDevSetPlan(BILLING_PLANS.PRO)}
              >
                {effectivePlan === BILLING_PLANS.PRO && "✓ "}Pro
              </Button>
            </ButtonGroup>
          </BlockStack>
        </Card>

        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
          All paid plans include a 7-day free trial. Cancel anytime. Payments processed securely by Shopify.
        </Text>
      </BlockStack>
    </Page>
  );
}
