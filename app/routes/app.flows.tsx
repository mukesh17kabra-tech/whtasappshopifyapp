import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigate } from "@remix-run/react";
import { useCallback } from "react";
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
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ flows: [] });

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
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const flow = await prisma.flow.create({
      data: { shopId: shop.id, name: "New Flow", trigger: "ORDER_PLACED", enabled: false },
    });
    return json({ redirectTo: `/app/flows/${flow.id}` });
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

  const handleCreate = useCallback(async () => {
    const formData = new FormData();
    formData.append("intent", "create");
    const res = await fetch("/app/flows", { method: "POST", body: formData });
    const data = await res.json();
    if (data.redirectTo) navigate(data.redirectTo);
  }, [navigate]);

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

  const rows = flows.map((f) => [
    f.name,
    TRIGGER_LABELS[f.trigger] ?? f.trigger,
    `${f.stepCount} step${f.stepCount === 1 ? "" : "s"}`,
    `${f.runCount} customer${f.runCount === 1 ? "" : "s"} entered`,
    <Badge key={`${f.id}-status`} tone={f.enabled ? "success" : undefined}>
      {f.enabled ? "Live" : "Off"}
    </Badge>,
    <InlineStack key={`${f.id}-actions`} gap="200">
      <Button onClick={() => navigate(`/app/flows/${f.id}`)}>Edit</Button>
      <Button onClick={() => handleToggle(f.id)}>{f.enabled ? "Turn off" : "Turn on"}</Button>
      <Button tone="critical" variant="plain" onClick={() => handleDelete(f.id)}>Delete</Button>
    </InlineStack>,
  ]);

  return (
    <Page
      title="Flows"
      subtitle="Automated sequences that trigger from an event — like Klaviyo's flows"
      primaryAction={{ content: "Create flow", onAction: handleCreate }}
    >
      <BlockStack gap="400">
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
