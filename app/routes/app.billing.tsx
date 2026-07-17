import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useRouteError, useSubmit } from "@remix-run/react";
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
import { boundary } from "@shopify/shopify-app-remix/server";
import { authenticate } from "~/shopify.server";
import { BILLING_PLANS } from "~/billing-plans";
import { formatCaughtError } from "~/services/error-format.server";
import { isDevelopmentStore } from "~/services/store-type.server";
import prisma from "~/db.server";

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "dev-set-plan") {
    const plan = String(formData.get("plan"));
    await prisma.shop.update({
      where: { id: shop.id },
      data: { manualPlanOverride: plan },
    });
    return json({ success: true });
  }

  return json({ error: "Unknown action" }, { status: 400 });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, billing, admin } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });

  try {
    const isDevStore = await isDevelopmentStore(admin);
    const { hasActivePayment, appSubscriptions } = await billing.check({ isTest: isDevStore });
    return json({
      hasActivePayment,
      activePlan: appSubscriptions[0]?.name ?? null,
      billingCheckFailed: false,
      manualPlanOverride: shop?.manualPlanOverride ?? null,
    });
  } catch (err) {
    if (err instanceof Response && err.status >= 300 && err.status < 400) {
      throw err;
    }
    const detail = await formatCaughtError(err);
    console.error("billing.check failed — returning safe fallback so the page still renders:", detail);
    return json({
      hasActivePayment: false,
      activePlan: null,
      billingCheckFailed: true,
      manualPlanOverride: shop?.manualPlanOverride ?? null,
    });
  }
}

// Backstop: if authenticate.admin() itself throws (expired/invalid session),
// Shopify's boundary helper knows how to redirect the merchant back through
// re-auth instead of showing a bare "Application Error" in the iframe.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

const PLAN_FEATURES = {
  Basic: [
    "Popup number/name capture",
    "Order confirmation messages",
    "Shipment tracking updates",
    "Storefront product finder chatbot",
    "Up to 100 subscribers",
    "Up to 50 broadcast messages monthly",
  ],
  Growth: [
    "Everything in Basic",
    "Unlimited subscribers",
    "Marketing broadcasts",
    "CSV bulk import",
    "Up to 500 subscribers",
    "Up to 250 broadcast messages monthly",
  ],
  Pro: [
    "Everything in Growth",
    "Priority support",
    "Up to unlimited subscribers",
    "Up to unlimited broadcast messages monthly",
  ],
};

const COMPARISON_ROWS = [
  { feature: "Subscribers", Basic: "100", Growth: "500", Pro: "Unlimited" },
  { feature: "Broadcast messages / month", Basic: "50", Growth: "250", Pro: "Unlimited" },
  { feature: "Order confirmations", Basic: "✓", Growth: "✓", Pro: "✓" },
  { feature: "Shipment tracking", Basic: "✓", Growth: "✓", Pro: "✓" },
  { feature: "Storefront chatbot", Basic: "✓", Growth: "✓", Pro: "✓" },
  { feature: "Marketing broadcasts", Basic: "✕", Growth: "✓", Pro: "✓" },
  { feature: "CSV bulk import", Basic: "✕", Growth: "✓", Pro: "✓" },
];

export default function Billing() {
  const { hasActivePayment, activePlan, billingCheckFailed, manualPlanOverride } = useLoaderData<typeof loader>();
  const [yearly, setYearly] = useState(false);
  const submit = useSubmit();

  const effectivePlan = manualPlanOverride || (hasActivePayment ? activePlan : null);

  const handleDevSetPlan = useCallback(
    (plan: string) => {
      const formData = new FormData();
      formData.append("intent", "dev-set-plan");
      formData.append("plan", plan);
      submit(formData, { method: "post" });
    },
    [submit],
  );

  const prices = {
    Basic: yearly ? "$3.99" : "$4.99",
    Growth: yearly ? "$7.19" : "$8.99",
    Pro: yearly ? "$11.99" : "$14.99",
  };

  const planKeys = {
    Basic: yearly ? BILLING_PLANS.BASIC_YEARLY : BILLING_PLANS.BASIC,
    Growth: yearly ? BILLING_PLANS.GROWTH_YEARLY : BILLING_PLANS.GROWTH,
    Pro: yearly ? BILLING_PLANS.PRO_YEARLY : BILLING_PLANS.PRO,
  };

  function renderCard(name: "Basic" | "Growth" | "Pro", popular?: boolean) {
    const isCurrent = effectivePlan === planKeys[name] || effectivePlan === name;

    return (
      <Box width="33%" key={name}>
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingLg">{name}</Text>
              {popular && <Badge tone="attention">Most popular</Badge>}
            </InlineStack>
            <InlineStack gap="100" blockAlign="baseline">
              <Text as="p" variant="heading2xl">{prices[name]}</Text>
              <Text as="p" variant="bodySm" tone="subdued">/mo</Text>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">7-day free trial, then billed {yearly ? "yearly" : "monthly"}.</Text>
            <BlockStack gap="150">
              {PLAN_FEATURES[name].map((f) => (
                <Text key={f} as="p" variant="bodySm">✓ {f}</Text>
              ))}
            </BlockStack>
            <Box paddingBlockStart="200">
              {isCurrent ? (
                <Button fullWidth disabled>✓ Current plan</Button>
              ) : (
                <Form method="post" action="/app/billing/subscribe">
                  <input type="hidden" name="plan" value={planKeys[name]} />
                  <Button submit variant={popular ? "primary" : undefined} fullWidth>
                    Start {name} — 7 days free
                  </Button>
                </Form>
              )}
            </Box>
          </BlockStack>
        </Card>
      </Box>
    );
  }

  return (
    <Page title="Pricing plans" subtitle="Every plan includes a 7-day free trial. Choose the plan that fits your store.">
      <BlockStack gap="400">
        {billingCheckFailed && (
          <Banner tone="critical" title="Couldn't verify your billing status">
            We couldn't confirm your current plan just now, so we're showing
            plans as if you have none yet — reload the page to try again.
            If this keeps happening, the app may need to be reinstalled or
            reconnected.
          </Banner>
        )}

        {!effectivePlan && (
          <Banner tone="warning">
            You don't have an active plan yet — choose one below to start
            your 7-day free trial. All core features require an active
            subscription; there's no free tier.
          </Banner>
        )}

        {effectivePlan && (
          <Banner tone="success">
            You're on the <strong>{effectivePlan}</strong> plan.
          </Banner>
        )}

        <Box>
          <ButtonGroup variant="segmented">
            <Button pressed={!yearly} onClick={() => setYearly(false)}>Monthly</Button>
            <Button pressed={yearly} onClick={() => setYearly(true)}>Yearly · Save 20%</Button>
          </ButtonGroup>
        </Box>

        <InlineStack gap="400" align="start" wrap={false}>
          {renderCard("Basic")}
          {renderCard("Growth", true)}
          {renderCard("Pro")}
        </InlineStack>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Feature comparison</Text>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e1e3e5" }}>
                  <th style={{ textAlign: "left", padding: "8px 0", fontSize: 13, color: "#6b7177" }}>Feature</th>
                  <th style={{ textAlign: "left", padding: "8px 0", fontSize: 13, color: "#6b7177" }}>Basic</th>
                  <th style={{ textAlign: "left", padding: "8px 0", fontSize: 13, color: "#6b7177" }}>Growth</th>
                  <th style={{ textAlign: "left", padding: "8px 0", fontSize: 13, color: "#6b7177" }}>Pro</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.feature} style={{ borderBottom: "1px solid #f1f1f1" }}>
                    <td style={{ padding: "10px 0", fontSize: 14 }}>{row.feature}</td>
                    <td style={{ padding: "10px 0", fontSize: 14 }}>{row.Basic}</td>
                    <td style={{ padding: "10px 0", fontSize: 14, color: "#008060", fontWeight: 600 }}>{row.Growth}</td>
                    <td style={{ padding: "10px 0", fontSize: 14, color: "#008060", fontWeight: 600 }}>{row.Pro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </BlockStack>
        </Card>

        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
          Every plan includes a 7-day free trial. Cancel anytime. Payments processed securely by Shopify.
        </Text>

        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">Developer testing — bypass Shopify billing</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Use while Shopify's Billing API is unavailable for this
              account. Only sets a flag on this shop's row — no real charge.
            </Text>
            <ButtonGroup>
              <Button pressed={effectivePlan === "Basic"} onClick={() => handleDevSetPlan("Basic")}>Basic</Button>
              <Button pressed={effectivePlan === "Growth"} onClick={() => handleDevSetPlan("Growth")}>Growth</Button>
              <Button pressed={effectivePlan === "Pro"} onClick={() => handleDevSetPlan("Pro")}>Pro</Button>
            </ButtonGroup>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}