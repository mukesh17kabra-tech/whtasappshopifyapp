import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, useSubmit } from "@remix-run/react";
import {
  Page,
  Card,
  DataTable,
  Text,
  BlockStack,
  TextField,
  EmptyState,
  Pagination,
  Button,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const PAGE_SIZE = 25;

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const id = String(formData.get("id"));
  const action = formData.get("action"); // "optout" | "optin"

  const optin = await prisma.optin.findUnique({ where: { id } });
  if (!optin || optin.shopId !== shop.id) {
    return json({ error: "Not found" }, { status: 404 });
  }

  await prisma.optin.update({
    where: { id },
    data: { optedOutAt: action === "optout" ? new Date() : null },
  });

  return json({ success: true });
}


export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const search = url.searchParams.get("q") ?? "";

  if (!shop) {
    return json({ optins: [], total: 0, page, search });
  }

  const where = {
    shopId: shop.id,
    ...(search ? { phoneNumber: { contains: search } } : {}),
  };

  const [optins, total] = await Promise.all([
    prisma.optin.findMany({
      where,
      orderBy: { consentAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.optin.count({ where }),
  ]);

  return json({
    optins: optins.map((o) => ({
      ...o,
      consentAt: o.consentAt.toISOString(),
      optedOutAt: o.optedOutAt?.toISOString() ?? null,
    })),
    total,
    page,
    search,
  });
}

export default function Subscribers() {
  const { optins, total, page, search } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(search);

  const handleSearch = useCallback(
    (value: string) => {
      setQuery(value);
      setSearchParams({ q: value, page: "1" });
    },
    [setSearchParams],
  );

  const rows = optins.map((o) => [
    o.phoneNumber,
    o.source,
    new Date(o.consentAt).toLocaleDateString(),
    o.optedOutAt ? "Opted out" : "Active",
    <ToggleButton key={o.id} id={o.id} optedOut={Boolean(o.optedOutAt)} />,
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <Page title="Subscribers" subtitle={`${total} total`}>
      <Card>
        <BlockStack gap="400">
          <TextField
            label="Search by phone number"
            labelHidden
            placeholder="Search phone number..."
            value={query}
            onChange={handleSearch}
            autoComplete="off"
          />

          {rows.length > 0 ? (
            <>
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text"]}
                headings={["Phone Number", "Source", "Opted In", "Status", ""]}
                rows={rows}
              />
              {totalPages > 1 && (
                <Pagination
                  hasPrevious={page > 1}
                  onPrevious={() =>
                    setSearchParams({ q: query, page: String(page - 1) })
                  }
                  hasNext={page < totalPages}
                  onNext={() =>
                    setSearchParams({ q: query, page: String(page + 1) })
                  }
                />
              )}
            </>
          ) : (
            <EmptyState heading="No subscribers yet" image="">
              <p>
                Once customers submit the WhatsApp popup on your storefront,
                they'll show up here.
              </p>
            </EmptyState>
          )}
        </BlockStack>
      </Card>
    </Page>
  );
}

function ToggleButton({ id, optedOut }: { id: string; optedOut: boolean }) {
  const submit = useSubmit();

  const handleClick = useCallback(() => {
    const formData = new FormData();
    formData.append("id", id);
    formData.append("action", optedOut ? "optin" : "optout");
    submit(formData, { method: "post" });
  }, [id, optedOut, submit]);

  return (
    <Button variant="plain" tone={optedOut ? undefined : "critical"} onClick={handleClick}>
      {optedOut ? "Re-subscribe" : "Opt out"}
    </Button>
  );
}
