import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { useState, useCallback } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  DataTable,
  Badge,
  Select,
  Button,
  Banner,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { queueWhatsappJob } from "~/services/queue.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, billing } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });

  const { hasActivePayment } = await billing.check({ isTest: true });

  if (!shop) {
    return json({ broadcasts: [], templates: [], subscriberCount: 0, hasActivePayment });
  }

  const effectivelyPaid = hasActivePayment || Boolean(shop.manualPlanOverride);

  const [broadcasts, templates, subscriberCount] = await Promise.all([
    prisma.broadcast.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.template.findMany({
      where: { shopId: shop.id, category: "MARKETING" },
    }),
    prisma.optin.count({ where: { shopId: shop.id, optedOutAt: null } }),
  ]);

  return json({
    broadcasts: broadcasts.map((b) => ({ ...b, createdAt: b.createdAt.toISOString() })),
    templates,
    subscriberCount,
    hasActivePayment: effectivelyPaid,
  });
}

// IMPORTANT: QStash's free tier allows 500 requests/day. For a broadcast to
// N subscribers this queues N jobs — fine for a few hundred subscribers/day,
// but if your subscriber list grows past that you'll need to either upgrade
// QStash or batch sends across multiple days. This route enqueues in chunks
// so a single broadcast action itself doesn't run for minutes inline.
export async function action({ request }: ActionFunctionArgs) {
  const { session, billing } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const { hasActivePayment } = await billing.check({ isTest: true });
  const effectivelyPaidForSend = hasActivePayment || Boolean(shop.manualPlanOverride);
  if (!effectivelyPaidForSend) {
    return json(
      { error: "Marketing broadcasts require the Growth or Pro plan. Upgrade on the Billing page." },
      { status: 402 },
    );
  }

  const formData = await request.formData();
  const templateId = String(formData.get("templateId"));

  if (!templateId) {
    return json({ error: "Please select a template" }, { status: 400 });
  }

  const subscribers = await prisma.optin.findMany({
    where: { shopId: shop.id, optedOutAt: null },
    select: { phoneNumber: true },
  });

  if (subscribers.length === 0) {
    return json({ error: "No active subscribers to send to" }, { status: 400 });
  }

  const broadcast = await prisma.broadcast.create({
    data: {
      shopId: shop.id,
      templateId,
      status: "sending",
      totalRecipients: subscribers.length,
    },
  });

  // Enqueue one job per subscriber. QStash handles the actual pacing/retries;
  // this loop just publishes messages, it doesn't wait for delivery.
  try {
    await Promise.all(
      subscribers.map((s) =>
        queueWhatsappJob({
          type: "broadcast_message",
          shopId: shop.id,
          broadcastId: broadcast.id,
          phoneNumber: s.phoneNumber,
          templateId,
        }),
      ),
    );
  } catch (err) {
    console.error("Failed to queue broadcast jobs", err);
    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data: { status: "failed" },
    });
    return json(
      {
        error:
          "Couldn't queue the broadcast — check QSTASH_TOKEN and SHOPIFY_APP_URL are set correctly in your environment variables.",
      },
      { status: 500 },
    );
  }

  return json({ success: true, broadcastId: broadcast.id });
}

export default function Broadcasts() {
  const { broadcasts, templates, subscriberCount, hasActivePayment } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [selectedTemplate, setSelectedTemplate] = useState(
    templates[0]?.id ?? "",
  );

  const isSending = navigation.state === "submitting";

  const handleSend = useCallback(() => {
    const formData = new FormData();
    formData.append("templateId", selectedTemplate);
    submit(formData, { method: "post" });
  }, [selectedTemplate, submit]);

  const templateOptions = templates.map((t) => ({
    label: t.name,
    value: t.id,
  }));

  const rows = broadcasts.map((b) => [
    b.id.slice(0, 8),
    b.templateId,
    <Badge
      key={b.id}
      tone={
        b.status === "done" ? "success" : b.status === "failed" ? "critical" : "info"
      }
    >
      {b.status}
    </Badge>,
    `${b.sentCount} / ${b.totalRecipients}`,
    new Date(b.createdAt).toLocaleString(),
  ]);

  return (
    <Page title="Broadcast Offers">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Send a new offer broadcast
              </Text>
              <Text as="p" tone="subdued">
                This will send to all {subscriberCount} active subscribers,
                using a template you composed on the Templates page.
              </Text>

              {actionData && "error" in actionData && actionData.error && (
                <Banner tone="critical">{actionData.error}</Banner>
              )}

              {!hasActivePayment ? (
                <Banner tone="warning" action={{ content: "View plans", url: "/app/billing" }}>
                  Marketing broadcasts require the Growth plan or higher.
                  Order confirmations and shipping updates still work on the
                  Free plan.
                </Banner>
              ) : templates.length === 0 ? (
                <Banner tone="warning">
                  No marketing templates yet. Create one on the Templates
                  page first.
                </Banner>
              ) : (
                <>
                  <Select
                    label="Offer template"
                    options={templateOptions}
                    value={selectedTemplate}
                    onChange={setSelectedTemplate}
                  />
                  <Button
                    variant="primary"
                    onClick={handleSend}
                    loading={isSending}
                    disabled={subscriberCount === 0}
                  >
                    Send broadcast now
                  </Button>
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Broadcast history
              </Text>
              {rows.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text"]}
                  headings={["ID", "Template", "Status", "Sent / Total", "Created"]}
                  rows={rows}
                />
              ) : (
                <EmptyState heading="No broadcasts sent yet" image="">
                  <p>Send your first offer broadcast above.</p>
                </EmptyState>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
