import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import {
  Page,
  Card,
  DataTable,
  Text,
  BlockStack,
  InlineStack,
  TextField,
  EmptyState,
  Pagination,
  Button,
  Banner,
  Box,
  Select,
  Checkbox,
} from "@shopify/polaris";
import { useState, useCallback, useRef } from "react";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

const PAGE_SIZE = 25;

const COUNTRIES = [
  { name: "India", iso: "IN", dialCode: "91", minLen: 10, maxLen: 10 },
  { name: "United States / Canada", iso: "US", dialCode: "1", minLen: 10, maxLen: 10 },
  { name: "United Kingdom", iso: "GB", dialCode: "44", minLen: 10, maxLen: 10 },
  { name: "United Arab Emirates", iso: "AE", dialCode: "971", minLen: 9, maxLen: 9 },
  { name: "Australia", iso: "AU", dialCode: "61", minLen: 9, maxLen: 9 },
  { name: "Singapore", iso: "SG", dialCode: "65", minLen: 8, maxLen: 8 },
  { name: "Pakistan", iso: "PK", dialCode: "92", minLen: 10, maxLen: 10 },
  { name: "Bangladesh", iso: "BD", dialCode: "880", minLen: 10, maxLen: 10 },
  { name: "Nepal", iso: "NP", dialCode: "977", minLen: 10, maxLen: 10 },
  { name: "Saudi Arabia", iso: "SA", dialCode: "966", minLen: 9, maxLen: 9 },
  { name: "Germany", iso: "DE", dialCode: "49", minLen: 10, maxLen: 11 },
  { name: "France", iso: "FR", dialCode: "33", minLen: 9, maxLen: 9 },
  { name: "Other (enter full number with country code)", iso: "OTHER", dialCode: "", minLen: 6, maxLen: 14 },
];

function isValidPhone(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim().replace(/[\s\-()]/g, "");
  if (!trimmed) return null;
  const candidate = trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
  return isValidPhone(candidate) ? candidate : null;
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    const id = String(formData.get("id"));
    const optin = await prisma.optin.findUnique({ where: { id } });
    if (!optin || optin.shopId !== shop.id) return json({ error: "Not found" }, { status: 404 });
    await prisma.optin.delete({ where: { id } });
    return json({ success: true });
  }

  if (intent === "toggle") {
    const id = String(formData.get("id"));
    const toggleAction = formData.get("action");
    const optin = await prisma.optin.findUnique({ where: { id } });
    if (!optin || optin.shopId !== shop.id) return json({ error: "Not found" }, { status: 404 });
    await prisma.optin.update({
      where: { id },
      data: { optedOutAt: toggleAction === "optout" ? new Date() : null },
    });
    return json({ success: true });
  }

  if (intent === "toggle-marketing") {
    const id = String(formData.get("id"));
    const optin = await prisma.optin.findUnique({ where: { id } });
    if (!optin || optin.shopId !== shop.id) return json({ error: "Not found" }, { status: 404 });
    await prisma.optin.update({
      where: { id },
      data: { marketingConsent: !optin.marketingConsent },
    });
    return json({ success: true });
  }

  if (intent === "bulk-delete") {
    const ids = formData.getAll("ids").map(String);
    await prisma.optin.deleteMany({ where: { id: { in: ids }, shopId: shop.id } });
    return json({ success: true });
  }

  if (intent === "bulk-optout") {
    const ids = formData.getAll("ids").map(String);
    await prisma.optin.updateMany({
      where: { id: { in: ids }, shopId: shop.id },
      data: { optedOutAt: new Date() },
    });
    return json({ success: true });
  }

  if (intent === "add-manual") {
    const dialCode = String(formData.get("dialCode") ?? "");
    const localNumber = String(formData.get("localNumber") ?? "").replace(/\D/g, "");
    const countryName = String(formData.get("countryName") ?? "");
    const minLen = Number(formData.get("minLen") ?? 6);
    const maxLen = Number(formData.get("maxLen") ?? 14);
    const name = String(formData.get("name") ?? "").trim() || null;
    const email = String(formData.get("email") ?? "").trim() || null;
    const isOther = dialCode === "";

    if (!localNumber) return json({ error: "Enter a phone number." }, { status: 400 });

    if (localNumber.length < minLen || localNumber.length > maxLen) {
      return json(
        {
          error: isOther
            ? "That doesn't look like a complete number with country code — check the digits and try again."
            : `That number has ${localNumber.length} digits, but ${countryName} numbers should have ${minLen === maxLen ? minLen : `${minLen}-${maxLen}`} digits (not counting the country code).`,
        },
        { status: 400 },
      );
    }

    const phoneNumber = isOther ? `+${localNumber}` : `+${dialCode}${localNumber}`;
    if (!isValidPhone(phoneNumber)) {
      return json({ error: `"${phoneNumber}" doesn't look like a valid phone number.` }, { status: 400 });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: `"${email}" doesn't look like a valid email address.` }, { status: 400 });
    }

    await prisma.optin.upsert({
      where: { shopId_phoneNumber: { shopId: shop.id, phoneNumber } },
      update: { optedOutAt: null, ...(name && { name }), ...(email && { email }) },
      create: { shopId: shop.id, phoneNumber, name, email, source: "manual" },
    });

    return json({ success: true, added: 1 });
  }

  if (intent === "add-csv") {
    const csvText = String(formData.get("csvText") ?? "");
    const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return json({ error: "No rows found in the file." }, { status: 400 });

    const firstLineHasDigits = /\d/.test(lines[0]);
    const dataLines = firstLineHasDigits ? lines : lines.slice(1);
    const results = { added: 0, skipped: 0, invalid: [] as string[] };

    for (const line of dataLines) {
      const columns = line.split(",").map((c) => c.trim());
      const firstColumn = columns[0];
      const nameColumn = columns[1] || null;
      const emailColumn = columns[2] && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(columns[2]) ? columns[2] : null;
      const phoneNumber = normalizePhone(firstColumn);

      if (!phoneNumber) {
        results.invalid.push(firstColumn);
        continue;
      }

      try {
        const existing = await prisma.optin.findUnique({
          where: { shopId_phoneNumber: { shopId: shop.id, phoneNumber } },
        });
        if (existing) {
          if (existing.optedOutAt) {
            await prisma.optin.update({
              where: { id: existing.id },
              data: { optedOutAt: null, ...(nameColumn && { name: nameColumn }), ...(emailColumn && { email: emailColumn }) },
            });
            results.added++;
          } else {
            results.skipped++;
          }
        } else {
          await prisma.optin.create({
            data: { shopId: shop.id, phoneNumber, name: nameColumn, email: emailColumn, source: "csv_import" },
          });
          results.added++;
        }
      } catch {
        results.invalid.push(firstColumn);
      }
    }

    return json({
      success: true,
      added: results.added,
      skipped: results.skipped,
      invalidCount: results.invalid.length,
      invalidSample: results.invalid.slice(0, 5),
    });
  }

  return json({ error: "Unknown action" }, { status: 400 });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const search = url.searchParams.get("q") ?? "";

  if (!shop) return json({ optins: [], total: 0, page, search });

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
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(search);
  const [countryIndex, setCountryIndex] = useState("0");
  const [localNumber, setLocalNumber] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [csvFileName, setCsvFileName] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const submit = useSubmit();

  const isSubmitting = navigation.state === "submitting";
  const selectedCountry = COUNTRIES[Number(countryIndex)];

  const handleSearch = useCallback(
    (value: string) => {
      setQuery(value);
      setSearchParams({ q: value, page: "1" });
    },
    [setSearchParams],
  );

  const handleAddManual = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "add-manual");
    formData.append("dialCode", selectedCountry.dialCode);
    formData.append("localNumber", localNumber);
    formData.append("countryName", selectedCountry.name);
    formData.append("minLen", String(selectedCountry.minLen));
    formData.append("maxLen", String(selectedCountry.maxLen));
    formData.append("name", manualName);
    formData.append("email", manualEmail);
    submit(formData, { method: "post" });
    setLocalNumber("");
    setManualName("");
    setManualEmail("");
  }, [selectedCountry, localNumber, manualName, manualEmail, submit]);

  const handleCsvSelect = useCallback(
    (file: File) => {
      setCsvFileName(file.name);
      const reader = new FileReader();
      reader.onload = () => {
        const formData = new FormData();
        formData.append("intent", "add-csv");
        formData.append("csvText", String(reader.result));
        submit(formData, { method: "post" });
      };
      reader.readAsText(file);
    },
    [submit],
  );

  const toggleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedIds(new Set(optins.map((o) => o.id)));
      } else {
        setSelectedIds(new Set());
      }
    },
    [optins],
  );

  const toggleSelectOne = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleBulkDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    const formData = new FormData();
    formData.append("intent", "bulk-delete");
    selectedIds.forEach((id) => formData.append("ids", id));
    submit(formData, { method: "post" });
    setSelectedIds(new Set());
  }, [selectedIds, submit]);

  const handleBulkOptOut = useCallback(() => {
    if (selectedIds.size === 0) return;
    const formData = new FormData();
    formData.append("intent", "bulk-optout");
    selectedIds.forEach((id) => formData.append("ids", id));
    submit(formData, { method: "post" });
    setSelectedIds(new Set());
  }, [selectedIds, submit]);

  const allSelected = optins.length > 0 && selectedIds.size === optins.length;

  const rows = optins.map((o) => [
    <Checkbox
      key={`${o.id}-check`}
      label=""
      labelHidden
      checked={selectedIds.has(o.id)}
      onChange={(checked) => toggleSelectOne(o.id, checked)}
    />,
    o.name || "—",
    o.phoneNumber,
    o.email || "—",
    o.source,
    <MarketingToggle key={`${o.id}-mkt`} id={o.id} consent={o.marketingConsent} />,
    new Date(o.consentAt).toLocaleDateString(),
    o.optedOutAt ? "Opted out" : "Active",
    <InlineStack key={`${o.id}-actions`} gap="200">
      <ToggleButton id={o.id} optedOut={Boolean(o.optedOutAt)} />
      <DeleteButton id={o.id} />
    </InlineStack>,
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <Page title="Subscribers" subtitle={`${total} total`}>
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Add subscribers</Text>

            {actionData && "error" in actionData && actionData.error && (
              <Banner tone="critical">{actionData.error}</Banner>
            )}
            {actionData && "added" in actionData && actionData.added !== undefined && (
              <Banner tone="success">
                Added {actionData.added} number{actionData.added === 1 ? "" : "s"}.
                {"skipped" in actionData && actionData.skipped ? ` ${actionData.skipped} already existed.` : ""}
                {"invalidCount" in actionData && actionData.invalidCount
                  ? ` ${actionData.invalidCount} row(s) couldn't be read as valid numbers.`
                  : ""}
              </Banner>
            )}

            <InlineStack gap="400" align="start" wrap>
              <Box minWidth="340px">
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" fontWeight="medium">Add one number</Text>
                  <InlineStack gap="200" blockAlign="end" wrap>
                    <Box minWidth="140px">
                      <TextField
                        label="Name (optional)"
                        placeholder="Rahul Sharma"
                        value={manualName}
                        onChange={setManualName}
                        autoComplete="off"
                      />
                    </Box>
                    <Box minWidth="180px">
                      <TextField
                        label="Email (optional)"
                        placeholder="rahul@example.com"
                        type="email"
                        value={manualEmail}
                        onChange={setManualEmail}
                        autoComplete="off"
                      />
                    </Box>
                    <Box minWidth="220px">
                      <Select
                        label="Country"
                        options={COUNTRIES.map((c, i) => ({
                          label: c.dialCode ? `${c.name} (+${c.dialCode})` : c.name,
                          value: String(i),
                        }))}
                        value={countryIndex}
                        onChange={setCountryIndex}
                      />
                    </Box>
                    <Box minWidth="140px">
                      <TextField
                        label={selectedCountry.dialCode ? "Phone number" : "Full number with country code"}
                        placeholder={selectedCountry.dialCode ? "9876543210" : "+919876543210"}
                        prefix={selectedCountry.dialCode ? `+${selectedCountry.dialCode}` : undefined}
                        value={localNumber}
                        onChange={setLocalNumber}
                        autoComplete="off"
                      />
                    </Box>
                    <Button onClick={handleAddManual} loading={isSubmitting} disabled={!localNumber}>
                      Add
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Box>

              <Box minWidth="300px">
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" fontWeight="medium">Bulk import from CSV</Text>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.txt"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleCsvSelect(file);
                    }}
                  />
                  <InlineStack gap="200" blockAlign="center">
                    <Button onClick={() => fileInputRef.current?.click()} loading={isSubmitting}>
                      Upload CSV
                    </Button>
                    {csvFileName && <Text as="span" variant="bodySm">{csvFileName}</Text>}
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    One phone number per row, optionally with a name in a second column and an email in a third column.
                  </Text>
                </BlockStack>
              </Box>
            </InlineStack>

            <Banner tone="warning">
              Only import numbers that have actually consented to receive
              WhatsApp messages — WhatsApp and privacy law (e.g. India's
              DPDP Act) require real opt-in for marketing messages.
              Customers captured automatically from orders default to
              utility-only (no marketing) for this reason.
            </Banner>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <TextField
                label="Search by phone number"
                labelHidden
                placeholder="Search phone number..."
                value={query}
                onChange={handleSearch}
                autoComplete="off"
              />
              {selectedIds.size > 0 && (
                <InlineStack gap="200">
                  <Text as="span" variant="bodySm">{selectedIds.size} selected</Text>
                  <Button onClick={handleBulkOptOut}>Opt out selected</Button>
                  <Button tone="critical" onClick={handleBulkDelete}>Delete selected</Button>
                </InlineStack>
              )}
            </InlineStack>

            {rows.length > 0 ? (
              <>
                <InlineStack gap="200" blockAlign="center">
                  <Checkbox
                    label="Select all on this page"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                  />
                </InlineStack>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text", "text", "text", "text", "text"]}
                  headings={["", "Name", "Phone Number", "Email", "Source", "Marketing", "Opted In", "Status", ""]}
                  rows={rows}
                />
                {totalPages > 1 && (
                  <Pagination
                    hasPrevious={page > 1}
                    onPrevious={() => setSearchParams({ q: query, page: String(page - 1) })}
                    hasNext={page < totalPages}
                    onNext={() => setSearchParams({ q: query, page: String(page + 1) })}
                  />
                )}
              </>
            ) : (
              <EmptyState heading="No subscribers yet" image="">
                <p>
                  Once customers submit the WhatsApp popup, place an order,
                  or you add numbers manually or via CSV above, they'll show
                  up here.
                </p>
              </EmptyState>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

function ToggleButton({ id, optedOut }: { id: string; optedOut: boolean }) {
  const submit = useSubmit();
  const handleClick = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "toggle");
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

function DeleteButton({ id }: { id: string }) {
  const submit = useSubmit();
  const [confirming, setConfirming] = useState(false);

  const handleClick = useCallback(() => {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 4000);
      return;
    }
    const formData = new FormData();
    formData.append("intent", "delete");
    formData.append("id", id);
    submit(formData, { method: "post" });
  }, [confirming, id, submit]);

  return (
    <Button variant="plain" tone="critical" onClick={handleClick}>
      {confirming ? "Click again to confirm" : "Delete"}
    </Button>
  );
}

function MarketingToggle({ id, consent }: { id: string; consent: boolean }) {
  const submit = useSubmit();
  const handleClick = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "toggle-marketing");
    formData.append("id", id);
    submit(formData, { method: "post" });
  }, [id, submit]);

  return (
    <Button variant="plain" tone={consent ? "success" : undefined} onClick={handleClick}>
      {consent ? "✓ Yes" : "No — enable"}
    </Button>
  );
}
