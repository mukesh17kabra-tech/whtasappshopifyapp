import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigate, useActionData } from "@remix-run/react";
import { useState, useCallback } from "react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  TextField,
  Select,
  Banner,
  Box,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const flow = await prisma.flow.findUnique({
    where: { id: params.id },
    include: { steps: { orderBy: { position: "asc" } } },
  });
  if (!flow || flow.shopId !== shop.id) throw new Response("Flow not found", { status: 404 });

  const templates = await prisma.template.findMany({
    where: { shopId: shop.id },
    select: { id: true, name: true, channel: true },
    orderBy: { createdAt: "desc" },
  });

  return json({ flow, templates });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const flow = await prisma.flow.findUnique({ where: { id: params.id } });
  if (!flow || flow.shopId !== shop.id) return json({ error: "Flow not found" }, { status: 404 });

  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  const trigger = String(formData.get("trigger") ?? "ORDER_PLACED");
  const stepsJson = String(formData.get("steps") ?? "[]");

  if (!name) {
    return json({ error: "Flow name is required" }, { status: 400 });
  }

  let steps: Array<{ type: string; delayDays?: number; templateId?: string }>;
  try {
    steps = JSON.parse(stepsJson);
  } catch {
    return json({ error: "Invalid steps data" }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.flow.update({ where: { id: flow.id }, data: { name, trigger } }),
    prisma.flowStep.deleteMany({ where: { flowId: flow.id } }),
    ...steps.map((step, index) =>
      prisma.flowStep.create({
        data: {
          flowId: flow.id,
          position: index,
          type: step.type,
          delayDays: step.type === "DELAY" ? step.delayDays ?? 1 : null,
          templateId: step.type === "SEND_MESSAGE" ? step.templateId ?? null : null,
        },
      }),
    ),
  ]);

  return json({ success: true });
}

const TRIGGER_OPTIONS = [{ label: "Order Placed", value: "ORDER_PLACED" }];

type UIStep =
  | { type: "DELAY"; delayDays: number }
  | { type: "SEND_MESSAGE"; templateId: string };

export default function FlowEditor() {
  const { flow, templates } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigate = useNavigate();

  const [name, setName] = useState(flow.name);
  const [trigger, setTrigger] = useState(flow.trigger);
  const [steps, setSteps] = useState<UIStep[]>(
    flow.steps.map((s: any) =>
      s.type === "DELAY"
        ? { type: "DELAY", delayDays: s.delayDays ?? 1 }
        : { type: "SEND_MESSAGE", templateId: s.templateId ?? "" },
    ),
  );

  const templateOptions = [
    { label: "Select a template...", value: "" },
    ...templates.map((t) => ({ label: `${t.name} (${t.channel})`, value: t.id })),
  ];

  const addStep = useCallback((type: "DELAY" | "SEND_MESSAGE") => {
    setSteps((prev) => [
      ...prev,
      type === "DELAY" ? { type: "DELAY", delayDays: 1 } : { type: "SEND_MESSAGE", templateId: "" },
    ]);
  }, []);

  const updateStep = useCallback((index: number, patch: Partial<UIStep>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? ({ ...s, ...patch } as UIStep) : s)));
  }, []);

  const removeStep = useCallback((index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("name", name);
    formData.append("trigger", trigger);
    formData.append("steps", JSON.stringify(steps));
    submit(formData, { method: "post" });
  }, [name, trigger, steps, submit]);

  return (
    <Page
      title="Edit Flow"
      backAction={{ content: "Flows", onAction: () => navigate("/app/flows") }}
    >
      <BlockStack gap="400">
        {actionData && "error" in actionData && (
          <Banner tone="critical">{actionData.error}</Banner>
        )}
        {actionData && "success" in actionData && (
          <Banner tone="success">Flow saved.</Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <TextField label="Flow name" value={name} onChange={setName} autoComplete="off" />
            <Select
              label="Trigger — when should this flow start?"
              options={TRIGGER_OPTIONS}
              value={trigger}
              onChange={setTrigger}
            />
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Steps</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Runs top to bottom for each customer who triggers this flow.
              Add a wait, then a message, then another wait — however many
              you need.
            </Text>

            {steps.length === 0 && (
              <Text as="p" tone="subdued">No steps yet — add one below.</Text>
            )}

            <BlockStack gap="300">
              {steps.map((step, index) => (
                <Card key={index}>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h3" variant="headingSm">
                        Step {index + 1}: {step.type === "DELAY" ? "Wait" : "Send Message"}
                      </Text>
                      <Button variant="plain" tone="critical" onClick={() => removeStep(index)}>
                        Remove
                      </Button>
                    </InlineStack>

                    {step.type === "DELAY" ? (
                      <InlineStack gap="200" blockAlign="center">
                        <Box minWidth="100px">
                          <TextField
                            label="Days"
                            labelHidden
                            type="number"
                            value={String(step.delayDays)}
                            onChange={(v) => updateStep(index, { delayDays: Math.max(1, parseInt(v) || 1) })}
                            autoComplete="off"
                          />
                        </Box>
                        <Text as="span" variant="bodyMd">day(s) after the previous step</Text>
                      </InlineStack>
                    ) : (
                      <Select
                        label="Template to send"
                        labelHidden
                        options={templateOptions}
                        value={step.templateId}
                        onChange={(v) => updateStep(index, { templateId: v })}
                      />
                    )}
                  </BlockStack>
                </Card>
              ))}
            </BlockStack>

            <InlineStack gap="200">
              <Button onClick={() => addStep("DELAY")}>+ Add wait</Button>
              <Button onClick={() => addStep("SEND_MESSAGE")}>+ Add message</Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Box>
          <Button variant="primary" onClick={handleSave}>Save flow</Button>
        </Box>

        {templates.length === 0 && (
          <Banner tone="warning">
            You don't have any templates yet — create some on the Templates
            page (or add starter templates) before adding "Send Message"
            steps here.
          </Banner>
        )}
      </BlockStack>
    </Page>
  );
}
