import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { useState, useCallback } from "react";
import {
  Page,
  Card,
  DataTable,
  Text,
  BlockStack,
  TextField,
  Select,
  Button,
  Banner,
  Badge,
  EmptyState,
  InlineStack,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });

  if (!shop) return json({ templates: [] });

  const templates = await prisma.template.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
  });

  return json({
    templates: templates.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    const id = String(formData.get("id"));
    await prisma.template.delete({ where: { id } });
    return json({ success: true });
  }

  const name = String(formData.get("name") ?? "").trim();
  const whatsappTemplateId = String(formData.get("whatsappTemplateId") ?? "").trim();
  const category = String(formData.get("category") ?? "UTILITY");

  if (!name || !whatsappTemplateId) {
    return json({ error: "Name and template ID are required" }, { status: 400 });
  }

  await prisma.template.create({
    data: {
      shopId: shop.id,
      name,
      whatsappTemplateId,
      category,
      // Marked "approved" here on the assumption the merchant only registers
      // a template after Meta/their BSP has actually approved it. If you want
      // to track pending review state, wire this up to your BSP's template
      // status API instead of defaulting to approved.
      status: "approved",
    },
  });

  return json({ success: true });
}

export default function Templates() {
  const { templates } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [category, setCategory] = useState("UTILITY");

  const isSaving = navigation.state === "submitting";

  const handleAdd = useCallback(() => {
    const formData = new FormData();
    formData.append("name", name);
    formData.append("whatsappTemplateId", templateId);
    formData.append("category", category);
    submit(formData, { method: "post" });
    setName("");
    setTemplateId("");
  }, [name, templateId, category, submit]);

  const handleDelete = useCallback(
    (id: string) => {
      const formData = new FormData();
      formData.append("intent", "delete");
      formData.append("id", id);
      submit(formData, { method: "post" });
    },
    [submit],
  );

  const rows = templates.map((t) => [
    t.name,
    t.whatsappTemplateId,
    <Badge key={`${t.id}-cat`} tone={t.category === "MARKETING" ? "attention" : "info"}>
      {t.category}
    </Badge>,
    <Badge key={`${t.id}-status`} tone={t.status === "approved" ? "success" : "warning"}>
      {t.status}
    </Badge>,
    <Button key={`${t.id}-del`} variant="plain" tone="critical" onClick={() => handleDelete(t.id)}>
      Remove
    </Button>,
  ]);

  return (
    <Page title="WhatsApp Templates">
      <BlockStack gap="400">
        <Banner tone="info">
          Templates must be created and approved in Meta Business Manager (or
          your BSP's dashboard, e.g. Gupshup/Interakt) first. Register the
          exact approved template name and ID here so it can be used for
          order updates and broadcasts.
        </Banner>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Register a template
            </Text>
            <InlineStack gap="400" blockAlign="end">
              <TextField
                label="Display name"
                value={name}
                onChange={setName}
                autoComplete="off"
                placeholder="Diwali Sale Offer"
              />
              <TextField
                label="Approved template name/ID"
                value={templateId}
                onChange={setTemplateId}
                autoComplete="off"
                placeholder="diwali_sale_2026"
              />
              <Select
                label="Category"
                options={[
                  { label: "Marketing (offers)", value: "MARKETING" },
                  { label: "Utility (order/tracking)", value: "UTILITY" },
                ]}
                value={category}
                onChange={setCategory}
              />
              <Button
                variant="primary"
                onClick={handleAdd}
                loading={isSaving}
                disabled={!name || !templateId}
              >
                Add template
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Your templates
            </Text>
            {rows.length > 0 ? (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text"]}
                headings={["Name", "Template ID", "Category", "Status", ""]}
                rows={rows}
              />
            ) : (
              <EmptyState heading="No templates registered yet" image="">
                <p>Add your first approved template above.</p>
              </EmptyState>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
