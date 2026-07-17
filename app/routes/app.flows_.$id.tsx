import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigate, useActionData, useFetcher } from "@remix-run/react";
import { useState, useCallback, useEffect } from "react";
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
  RadioButton,
  Autocomplete,
  Link,
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
    select: { id: true, name: true, channel: true, category: true },
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
  const triggerProductId = String(formData.get("triggerProductId") ?? "").trim() || null;
  const triggerProductTitle = String(formData.get("triggerProductTitle") ?? "").trim() || null;
  const stepsJson = String(formData.get("steps") ?? "[]");

  if (!name) {
    return json({ error: "Flow name is required" }, { status: 400 });
  }

  let steps: Array<{ type: string; delayDays?: number; sendDate?: string; templateId?: string }>;
  try {
    steps = JSON.parse(stepsJson);
  } catch {
    return json({ error: "Invalid steps data" }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.flow.update({ where: { id: flow.id }, data: { name, trigger, triggerProductId, triggerProductTitle } }),
    prisma.flowStep.deleteMany({ where: { flowId: flow.id } }),
    ...steps.map((step, index) =>
      prisma.flowStep.create({
        data: {
          flowId: flow.id,
          position: index,
          type: step.type,
          delayDays: step.type === "DELAY" && !step.sendDate ? step.delayDays ?? 1 : null,
          sendDate: step.type === "DELAY" && step.sendDate ? new Date(step.sendDate) : null,
          templateId: step.type === "SEND_MESSAGE" ? step.templateId ?? null : null,
        },
      }),
    ),
  ]);

  return json({ success: true });
}

const TRIGGER_OPTIONS = [{ label: "Order Placed", value: "ORDER_PLACED" }];

type UIStep =
  | { type: "DELAY"; mode: "days" | "date"; delayDays: number; sendDate: string }
  | { type: "SEND_MESSAGE"; templateId: string };

export default function FlowEditor() {
  const { flow, templates } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigate = useNavigate();
  const resourcesFetcher = useFetcher<{ products: any[] }>();

  const [name, setName] = useState(flow.name);
  const [trigger, setTrigger] = useState(flow.trigger);
  const [productFilter, setProductFilter] = useState<"any" | "specific">(
    (flow as any).triggerProductId ? "specific" : "any",
  );
  const [productId, setProductId] = useState((flow as any).triggerProductId ?? "");
  const [productTitle, setProductTitle] = useState((flow as any).triggerProductTitle ?? "");
  const [productSearch, setProductSearch] = useState((flow as any).triggerProductTitle ?? "");

  const [steps, setSteps] = useState<UIStep[]>(
    flow.steps.map((s: any) =>
      s.type === "DELAY"
        ? {
            type: "DELAY",
            mode: s.sendDate ? "date" : "days",
            delayDays: s.delayDays ?? 1,
            sendDate: s.sendDate ? new Date(s.sendDate).toISOString().slice(0, 10) : "",
          }
        : { type: "SEND_MESSAGE", templateId: s.templateId ?? "" },
    ),
  );

  useEffect(() => {
    resourcesFetcher.load("/api/store-resources");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const products = resourcesFetcher.data?.products ?? [];
  const filteredProducts = productSearch
    ? products.filter((p: any) => p.title.toLowerCase().includes(productSearch.toLowerCase()))
    : products;

  const templateOptions = [
    { label: "Select a template...", value: "" },
    ...templates.filter((t) => t.category === "MARKETING").map((t) => ({ label: `${t.name} (${t.channel})`, value: t.id })),
  ];

  const addStep = useCallback((type: "DELAY" | "SEND_MESSAGE") => {
    setSteps((prev) => [
      ...prev,
      type === "DELAY"
        ? { type: "DELAY", mode: "days", delayDays: 1, sendDate: "" }
        : { type: "SEND_MESSAGE", templateId: "" },
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
    formData.append("triggerProductId", productFilter === "specific" ? productId : "");
    formData.append("triggerProductTitle", productFilter === "specific" ? productTitle : "");
    formData.append(
      "steps",
      JSON.stringify(
        steps.map((s) =>
          s.type === "DELAY"
            ? { type: "DELAY", delayDays: s.mode === "days" ? s.delayDays : undefined, sendDate: s.mode === "date" ? s.sendDate : undefined }
            : s,
        ),
      ),
    );
    submit(formData, { method: "post" });
  }, [name, trigger, productFilter, productId, productTitle, steps, submit]);

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

            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" fontWeight="medium">Which orders should trigger this?</Text>
              <RadioButton
                label="Any product"
                checked={productFilter === "any"}
                onChange={() => setProductFilter("any")}
              />
              <RadioButton
                label="Only orders containing a specific product"
                checked={productFilter === "specific"}
                onChange={() => setProductFilter("specific")}
              />
              {productFilter === "specific" && (
                <Box maxWidth="400px">
                  <Autocomplete
                    options={filteredProducts.map((p: any) => ({ label: p.title, value: p.id ?? p.title }))}
                    selected={productId ? [productId] : []}
                    onSelect={(selected) => {
                      const match = filteredProducts.find((p: any) => (p.id ?? p.title) === selected[0]);
                      setProductId(selected[0] || "");
                      setProductTitle(match?.title || "");
                    }}
                    textField={
                      <Autocomplete.TextField
                        label="Product"
                        labelHidden
                        value={productSearch}
                        onChange={setProductSearch}
                        placeholder={resourcesFetcher.state === "loading" ? "Loading products..." : "Search products..."}
                        autoComplete="off"
                      />
                    }
                  />
                </Box>
              )}
            </BlockStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Steps</Text>
              <Link url="/app/templates">Manage templates ↗</Link>
            </InlineStack>
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
                      <BlockStack gap="200">
                        <InlineStack gap="200">
                          <RadioButton
                            label="Wait a number of days"
                            checked={step.mode === "days"}
                            onChange={() => updateStep(index, { mode: "days" })}
                          />
                          <RadioButton
                            label="Send on a specific date"
                            checked={step.mode === "date"}
                            onChange={() => updateStep(index, { mode: "date" })}
                          />
                        </InlineStack>
                        {step.mode === "days" ? (
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
                          <Box minWidth="200px">
                            <TextField
                              label="Date"
                              labelHidden
                              type="date"
                              value={step.sendDate}
                              onChange={(v) => updateStep(index, { sendDate: v })}
                              autoComplete="off"
                            />
                          </Box>
                        )}
                      </BlockStack>
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
          <Banner tone="warning" action={{ content: "Create templates", url: "/app/templates" }}>
            You don't have any templates yet — go to Templates → Flow
            Template tab (or add starter templates there) before adding
            "Send Message" steps here.
          </Banner>
        )}
      </BlockStack>
    </Page>
  );
}
