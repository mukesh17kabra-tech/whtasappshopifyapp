import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useActionData, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineGrid,
  DataTable,
  Badge,
  EmptyState,
  Button,
  Banner,
  InlineStack,
} from "@shopify/polaris";
import shopify, { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { formatCaughtError } from "~/services/error-format.server";

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "cancel-subscriptions") {
    try {
      // List every subscription (active, pending, or otherwise) on this
      // shop's installation — a leftover PENDING one from an earlier failed
      // attempt commonly blocks creating a new subscription entirely.
      const listResponse = await admin.graphql(`
        query { currentAppInstallation { activeSubscriptions { id name status } } }
      `);
      const listData = await listResponse.json();
      const subs = listData?.data?.currentAppInstallation?.activeSubscriptions ?? [];

      const cancelled = [];
      for (const sub of subs) {
        const cancelResponse = await admin.graphql(
          `mutation CancelSub($id: ID!) { appSubscriptionCancel(id: $id) { userErrors { message } appSubscription { id status } } }`,
          { variables: { id: sub.id } },
        );
        const cancelData = await cancelResponse.json();
        cancelled.push({ name: sub.name, status: sub.status, result: cancelData?.data?.appSubscriptionCancel });
      }

      console.log(`Cancelled subscriptions for ${session.shop}:`, JSON.stringify(cancelled));
      return json({ subsSuccess: true, found: subs.length, cancelled });
    } catch (err) {
      const detail = await formatCaughtError(err);
      console.error(`Cancel subscriptions FAILED for ${session.shop}:`, detail);
      return json({ subsError: detail }, { status: 500 });
    }
  }

  try {
    const results = await shopify.registerWebhooks({ session });
    console.log(`Manual re-register webhooks for ${session.shop}:`, JSON.stringify(results));
    return json({ success: true, results });
  } catch (err) {
    const detail = await formatCaughtError(err);
    console.error(`Manual re-register webhooks FAILED for ${session.shop}:`, detail);
    return json({ error: detail }, { status: 500 });
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });

  if (!shop) {
    return json({
      optinCount: 0,
      messagesSent: 0,
      messagesFailed: 0,
      recentMessages: [],
    });
  }

  const [optinCount, messagesSent, messagesFailed, recentMessages] =
    await Promise.all([
      prisma.optin.count({
        where: { shopId: shop.id, optedOutAt: null },
      }),
      prisma.messageLog.count({
        where: { shopId: shop.id, status: "sent" },
      }),
      prisma.messageLog.count({
        where: { shopId: shop.id, status: "failed" },
      }),
      prisma.messageLog.findMany({
        where: { shopId: shop.id },
        orderBy: { sentAt: "desc" },
        take: 10,
      }),
    ]);

  return json({
    optinCount,
    messagesSent,
    messagesFailed,
    recentMessages: recentMessages.map((m) => ({
      ...m,
      sentAt: m.sentAt.toISOString(),
    })),
  });
}

export default function Dashboard() {
  const { optinCount, messagesSent, messagesFailed, recentMessages } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const handleReRegister = () => {
    submit({}, { method: "post" });
  };

  const rows = recentMessages.map((m) => [
    m.phoneNumber,
    m.templateUsed,
    <Badge key={m.id} tone={m.status === "sent" ? "success" : "critical"}>
      {m.status}
    </Badge>,
    new Date(m.sentAt).toLocaleString(),
  ]);

  return (
    <Page title="WhatsApp Offers Dashboard">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingSm">
                  Troubleshooting: webhook registration
                </Text>
                <Button onClick={handleReRegister} loading={navigation.state === "submitting"}>
                  Re-register webhooks
                </Button>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                If order confirmations or shipping updates aren't sending,
                click this to re-tell Shopify to send order/fulfillment
                events to this app — normally happens automatically on
                install, this is a manual fallback for troubleshooting.
              </Text>
              {actionData && "success" in actionData && (
                <Banner tone="success">
                  Webhooks re-registered successfully. Check Vercel logs for
                  the full response if you want to confirm exact topics.
                </Banner>
              )}
              {actionData && "error" in actionData && (
                <Banner tone="critical">Failed: {actionData.error}</Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <InlineGrid columns={3} gap="400">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Active Subscribers
                </Text>
                <Text as="p" variant="heading2xl">
                  {optinCount}
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Messages Sent
                </Text>
                <Text as="p" variant="heading2xl">
                  {messagesSent}
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Failed Sends
                </Text>
                <Text as="p" variant="heading2xl" tone={messagesFailed > 0 ? "critical" : undefined}>
                  {messagesFailed}
                </Text>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Recent Message Activity
              </Text>
              {rows.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["Phone", "Template", "Status", "Sent At"]}
                  rows={rows}
                />
              ) : (
                <EmptyState
                  heading="No messages sent yet"
                  image=""
                >
                  <p>
                    Once customers opt in and place orders, message activity
                    will show up here.
                  </p>
                </EmptyState>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}