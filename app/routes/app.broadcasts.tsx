import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { useState, useCallback, useMemo } from "react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  DataTable,
  Badge,
  Select,
  Button,
  Banner,
  EmptyState,
  Tabs,
  RadioButton,
  Checkbox,
  TextField,
  Box,
  InlineStack,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { queueWhatsappJob } from "~/services/queue.server";
import { BROADCAST_ELIGIBLE_PLANS } from "~/billing-plans";
import { isDevelopmentStore } from "~/services/store-type.server";
import { formatCaughtError } from "~/services/error-format.server";
import { boundary } from "@shopify/shopify-app-remix/server";
import { useRouteError } from "@remix-run/react";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, billing, admin } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });

  let onEligiblePlan = false;
  let billingCheckFailed = false;
  try {
    const isDevStore = await isDevelopmentStore(admin);
    const { hasActivePayment, appSubscriptions } = await billing.check({ isTest: isDevStore });
    onEligiblePlan = hasActivePayment && BROADCAST_ELIGIBLE_PLANS.includes(appSubscriptions[0]?.name ?? "");
  } catch (err) {
    const detail = await formatCaughtError(err);
    console.error("Broadcasts: billing.check failed — showing page with no active plan assumed:", detail);
    billingCheckFailed = true;
  }

  if (!shop) {
    return json({ broadcasts: [], templates: [], subscribers: [], hasActivePayment: onEligiblePlan, billingCheckFailed });
  }

  const effectivelyPaid = onEligiblePlan;

  const [broadcasts, templates, subscribers] = await Promise.all([
    prisma.broadcast.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.template.findMany({
      where: { shopId: shop.id, category: "MARKETING" },
    }),
    prisma.optin.findMany({
      where: { shopId: shop.id, optedOutAt: null, marketingConsent: true },
      select: { id: true, name: true, phoneNumber: true },
      orderBy: { consentAt: "desc" },
    }),
  ]);

  const templateIds = [...new Set(broadcasts.map((b) => b.templateId))];
  const templateNames = await prisma.template.findMany({
    where: { id: { in: templateIds } },
    select: { id: true, name: true },
  });
  const templateNameMap = Object.fromEntries(templateNames.map((t) => [t.id, t.name]));

  return json({
    broadcasts: broadcasts.map((b) => ({
      ...b,
      createdAt: b.createdAt.toISOString(),
      templateName: templateNameMap[b.templateId] ?? "(deleted template)",
    })),
    templates,
    subscribers,
    hasActivePayment: effectivelyPaid,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, billing, admin } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  let onEligiblePlan = false;
  try {
    const isDevStore = await isDevelopmentStore(admin);
    const { hasActivePayment, appSubscriptions } = await billing.check({ isTest: isDevStore });
    onEligiblePlan = hasActivePayment && BROADCAST_ELIGIBLE_PLANS.includes(appSubscriptions[0]?.name ?? "");
  } catch (err) {
    const detail = await formatCaughtError(err);
    console.error("Broadcasts action: billing.check failed:", detail);
    return json(
      { error: `Couldn't verify your billing status (${detail}). Please reload and try again.` },
      { status: 502 },
    );
  }
  const effectivelyPaidForSend = onEligiblePlan;
  if (!effectivelyPaidForSend) {
    return json(
      { error: "Marketing broadcasts require the Growth or Pro plan. Upgrade on the Billing page." },
      { status: 402 },
    );
  }

  const formData = await request.formData();
  const templateId = String(formData.get("templateId"));
  const audience = String(formData.get("audience") ?? "all");
  const selectedIds = formData.getAll("subscriberIds").map(String);

  if (!templateId) {
    return json({ error: "Please select a template" }, { status: 400 });
  }

  const where =
    audience === "selected"
      ? { shopId: shop.id, optedOutAt: null, marketingConsent: true, id: { in: selectedIds } }
      : { shopId: shop.id, optedOutAt: null, marketingConsent: true };

  const subscribers = await prisma.optin.findMany({
    where,
    select: { phoneNumber: true },
  });

  if (subscribers.length === 0) {
    return json(
      { error: audience === "selected" ? "No subscribers selected" : "No active subscribers to send to" },
      { status: 400 },
    );
  }

  const broadcast = await prisma.broadcast.create({
    data: {
      shopId: shop.id,
      templateId,
      status: "sending",
      totalRecipients: subscribers.length,
    },
  });

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
    const detail = err instanceof Error ? err.message : String(err);
    return json({ error: `Couldn't queue the broadcast: ${detail}` }, { status: 500 });
  }

  return json({ success: true, broadcastId: broadcast.id });
}

export default function Broadcasts() {
  const { broadcasts, templates, subscribers, hasActivePayment, billingCheckFailed } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [selectedTab, setSelectedTab] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState(templates[0]?.id ?? "");
  const [audience, setAudience] = useState<"all" | "selected">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const isSending = navigation.state === "submitting";

  const filteredSubscribers = useMemo(() => {
    if (!search) return subscribers;
    const q = search.toLowerCase();
    return subscribers.filter(
      (s) => s.phoneNumber.toLowerCase().includes(q) || (s.name ?? "").toLowerCase().includes(q),
    );
  }, [subscribers, search]);

  const toggleOne = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(
    (checked: boolean) => {
      setSelectedIds(checked ? new Set(filteredSubscribers.map((s) => s.id)) : new Set());
    },
    [filteredSubscribers],
  );

  const handleSend = useCallback(() => {
    const formData = new FormData();
    formData.append("templateId", selectedTemplate);
    formData.append("audience", audience);
    if (audience === "selected") {
      selectedIds.forEach((id) => formData.append("subscriberIds", id));
    }
    submit(formData, { method: "post" });
  }, [selectedTemplate, audience, selectedIds, submit]);

  const templateOptions = templates.map((t) => ({ label: t.name, value: t.id }));

  const recipientCount = audience === "all" ? subscribers.length : selectedIds.size;

  const historyRows = broadcasts.map((b) => [
    b.id.slice(0, 8),
    b.templateName,
    <Badge key={b.id} tone={b.status === "done" ? "success" : b.status === "failed" ? "critical" : "info"}>
      {b.status}
    </Badge>,
    `${b.sentCount} / ${b.totalRecipients}`,
    new Date(b.createdAt).toLocaleString(),
  ]);

  return (
    <Page title="Broadcast Offers">
      <BlockStack gap="400">
        {billingCheckFailed && (
          <Banner tone="critical" title="Couldn't verify your billing status">
            Reload the page to try again. If this keeps happening, the app
            may need to be reinstalled or reconnected.
          </Banner>
        )}

        <Tabs
          tabs={[
            { id: "send", content: "Send Broadcast" },
            { id: "history", content: "Broadcast History" },
          ]}
          selected={selectedTab}
          onSelect={setSelectedTab}
        />

        {selectedTab === 0 ? (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Send a new offer broadcast</Text>

              {actionData && "error" in actionData && actionData.error && (
                <Banner tone="critical">{actionData.error}</Banner>
              )}

              {!hasActivePayment ? (
                <Banner tone="warning" action={{ content: "View plans", url: "/app/billing" }}>
                  Marketing broadcasts require the Growth plan or higher.
                  Order confirmations and shipping updates still work on the
                  Basic plan.
                </Banner>
              ) : templates.length === 0 ? (
                <Banner tone="warning">
                  No marketing templates yet. Create one on the Templates page first.
                </Banner>
              ) : (
                <>
                  <Select
                    label="Offer template"
                    options={templateOptions}
                    value={selectedTemplate}
                    onChange={setSelectedTemplate}
                  />

                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd" fontWeight="medium">Send to</Text>
                    <RadioButton
                      label={`All active subscribers (${subscribers.length})`}
                      checked={audience === "all"}
                      onChange={() => setAudience("all")}
                    />
                    <RadioButton
                      label="Select specific subscribers"
                      checked={audience === "selected"}
                      onChange={() => setAudience("selected")}
                    />
                  </BlockStack>

                  {audience === "selected" && (
                    <Card>
                      <BlockStack gap="300">
                        <TextField
                          label="Search"
                          labelHidden
                          placeholder="Search name or phone number..."
                          value={search}
                          onChange={setSearch}
                          autoComplete="off"
                        />
                        <InlineStack align="space-between">
                          <Checkbox
                            label={`Select all (${filteredSubscribers.length})`}
                            checked={
                              filteredSubscribers.length > 0 &&
                              filteredSubscribers.every((s) => selectedIds.has(s.id))
                            }
                            onChange={toggleAll}
                          />
                          <Text as="span" variant="bodySm" tone="subdued">
                            {selectedIds.size} selected
                          </Text>
                        </InlineStack>
                        <Box maxWidth="100%" overflowX="hidden">
                          <div style={{ maxHeight: 280, overflowY: "auto" }}>
                            <BlockStack gap="150">
                              {filteredSubscribers.map((s) => (
                                <Checkbox
                                  key={s.id}
                                  label={`${s.name || "—"}  ·  ${s.phoneNumber}`}
                                  checked={selectedIds.has(s.id)}
                                  onChange={(checked) => toggleOne(s.id, checked)}
                                />
                              ))}
                              {filteredSubscribers.length === 0 && (
                                <Text as="p" tone="subdued">No matching subscribers.</Text>
                              )}
                            </BlockStack>
                          </div>
                        </Box>
                      </BlockStack>
                    </Card>
                  )}

                  <Text as="p" variant="bodySm" tone="subdued">
                    This will send to {recipientCount} recipient{recipientCount === 1 ? "" : "s"}.
                  </Text>

                  <Button
                    variant="primary"
                    onClick={handleSend}
                    loading={isSending}
                    disabled={recipientCount === 0}
                  >
                    Send broadcast now
                  </Button>
                </>
              )}
            </BlockStack>
          </Card>
        ) : (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Broadcast history</Text>
              {historyRows.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text"]}
                  headings={["ID", "Template", "Status", "Sent / Total", "Created"]}
                  rows={historyRows}
                />
              ) : (
                <EmptyState heading="No broadcasts sent yet" image="">
                  <p>Send your first offer broadcast from the Send Broadcast tab.</p>
                </EmptyState>
              )}
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}