import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
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
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

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
