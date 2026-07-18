import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigate, useFetcher } from "@remix-run/react";
import { useCallback, useEffect } from "react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  EmptyState,
  DataTable,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { isDevelopmentStore } from "~/services/store-type.server";

// Flow count limits per plan — Basic and Growth cap how many flows you can
// have at once (enabled or not), Pro is unlimited.
const FLOW_LIMITS: Record<string, number> = {
  Basic: 7,
  Growth: 14,
  Pro: Infinity,
};

async function getFlowLimit(shop: { id: string; manualPlanOverride: string | null }, billing: any, admin: any): Promise<number> {
  // manualPlanOverride (dev bypass) takes priority if set, since real
  // billing.check may be unavailable during testing.
  if (shop.manualPlanOverride && FLOW_LIMITS[shop.manualPlanOverride] !== undefined) {
    return FLOW_LIMITS[shop.manualPlanOverride];
  }
  try {
    const isDevStore = await isDevelopmentStore(admin);
    const { hasActivePayment, appSubscriptions } = await billing.check({ isTest: isDevStore });
    const planName = appSubscriptions[0]?.name ?? "";
    if (hasActivePayment) {
      if (planName.includes("Pro")) return FLOW_LIMITS.Pro;
      if (planName.includes("Growth")) return FLOW_LIMITS.Growth;
      if (planName.includes("Basic")) return FLOW_LIMITS.Basic;
    }
  } catch (err) {
    console.error("getFlowLimit: billing.check failed, defaulting to Basic limit:", err);
  }
  // No plan detected at all — default to the most restrictive tier rather
  // than silently allowing unlimited flows.
  return FLOW_LIMITS.Basic;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ flows: [], flowLimit: FLOW_LIMITS.Basic });

  const flows = await prisma.flow.findMany({
    where: { shopId: shop.id },
    include: { steps: true, _count: { select: { runs: true } } },
    orderBy: { createdAt: "desc" },
  });

  return json({
    flows: flows.map((f) => ({
      id: f.id,
      name: f.name,
      trigger: f.trigger,
      enabled: f.enabled,
      stepCount: f.steps.length,
      runCount: f._count.runs,
    })),
    flowLimit: null, // computed in the component from plan info fetched separately would duplicate billing calls; see Banner below for the practical limit message shown after a failed create instead.
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, billing, admin } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const currentCount = await prisma.flow.count({ where: { shopId: shop.id } });
    const limit = await getFlowLimit(shop, billing, admin);
    if (currentCount >= limit) {
      return json(
        {
          error: `You've reached your plan's limit of ${limit === Infinity ? "unlimited" : limit} flows. Upgrade your plan on the Billing page to create more.`,
        },
        { status: 402 },
      );
    }

    const flow = await prisma.flow.create({
      data: { shopId: shop.id, name: "New Flow", trigger: "ORDER_PLACED", enabled: false },
    });
    return json({ success: true, redirectTo: `/app/flows/${flow.id}` });
  }

  if (intent === "toggle") {
    const id = String(formData.get("id"));
    const flow = await prisma.flow.findUnique({ where: { id } });
    if (flow && flow.shopId === shop.id) {
      await prisma.flow.update({ where: { id }, data: { enabled: !flow.enabled } });
    }
    return json({ success: true });
  }

  if (intent === "delete") {
    const id = String(formData.get("id"));
    const flow = await prisma.flow.findUnique({ where: { id } });
    if (flow && flow.shopId === shop.id) {
      await prisma.flowRun.deleteMany({ where: { flowId: id } });
      await prisma.flowStep.deleteMany({ where: { flowId: id } });
      await prisma.flow.delete({ where: { id } });
    }
    return json({ success: true });
  }

  return json({ error: "Unknown action" }, { status: 400 });
}

const TRIGGER_LABELS: Record<string, string> = {
  ORDER_PLACED: "Order Placed",
};

export default function Flows() {
  const { flows } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigate = useNavigate();
  // useFetcher is the correct Remix pattern for "submit + read the response
  // without a full page navigation" — a raw fetch() call here was the bug:
  // it doesn't reliably carry the embedded app's session token, so the
  // response was inconsistent and the redirect never fired, even though
  // the Flow was actually being created in the database.
  const createFetcher = useFetcher<typeof action>();

  useEffect(() => {
    if (createFetcher.data && "redirectTo" in createFetcher.data && createFetcher.data.redirectTo) {
      navigate(createFetcher.data.redirectTo);
    }
  }, [createFetcher.data, navigate]);

  const handleCreate = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "create");
    createFetcher.submit(formData, { method: "post" });
  }, [createFetcher]);

  const handleToggle = useCallback(
    (id: string) => {
      const formData = new FormData();
      formData.append("intent", "toggle");
      formData.append("id", id);
      submit(formData, { method: "post" });
    },
    [submit],
  );

  const handleDelete = useCallback(
    (id: string) => {
      const formData = new FormData();
      formData.append("intent", "delete");
      formData.append("id", id);
      submit(formData, { method: "post" });
    },
    [submit],
  );

  const isCreating = createFetcher.state !== "idle";

  const rows = flows.map((f) => [
    f.name,
    TRIGGER_LABELS[f.trigger] ?? f.trigger,
    `${f.stepCount} step${f.stepCount === 1 ? "" : "s"}`,
    `${f.runCount} customer${f.runCount === 1 ? "" : "s"} entered`,
    <Badge key={`${f.id}-status`} tone={f.enabled ? "success" : undefined}>
      {f.enabled ? "Live" : "Off"}
    </Badge>,
    <InlineStack key={`${f.id}-actions`} gap="200">
      {/* url prop renders this as a real link, which is the more reliable
          way to navigate from inside a DataTable cell than onClick+navigate */}
      <Button url={`/app/flows/${f.id}`}>Edit</Button>
      <Button onClick={() => handleToggle(f.id)}>{f.enabled ? "Turn off" : "Turn on"}</Button>
      <Button tone="critical" variant="plain" onClick={() => handleDelete(f.id)}>Delete</Button>
    </InlineStack>,
  ]);

  return (
    <Page
      title="Flows"
      subtitle="Automated sequences that trigger from an event — like Klaviyo's flows"
      primaryAction={{ content: "Create flow", onAction: handleCreate, loading: isCreating }}
    >
      <BlockStack gap="400">
        {createFetcher.data && "error" in createFetcher.data && (
          <Banner tone="critical">{createFetcher.data.error}</Banner>
        )}

        <Card>
          <BlockStack gap="400">
            {rows.length > 0 ? (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                headings={["Name", "Trigger", "Steps", "Activity", "Status", ""]}
                rows={rows}
              />
            ) : (
              <EmptyState heading="No flows yet" image="">
                <p>
                  Create a flow to automatically message customers over time
                  — e.g. "3 days after Placed Order, send a WhatsApp
                  message; 7 days later, send an email."
                </p>
              </EmptyState>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
