// Fills in {variable} placeholders in a template body with real values.
// Used by the broadcast/order job worker right before sending.

export type TemplateVariables = {
  first_name?: string;
  last_name?: string;
  order_id?: string;
  order_number?: string;
  order_date?: string;
  order_url?: string;
  order_total?: string;
  tracking_number?: string;
  tracking_company?: string;
  tracking_url?: string;
};

export function renderTemplateBody(
  body: string,
  variables: TemplateVariables,
): string {
  const substituted = Object.entries(variables).reduce((text, [key, value]) => {
    if (value === undefined) return text;
    return text.split(`{${key}}`).join(value);
  }, body);

  // Safety net: strip any {tag} that wasn't actually substituted (e.g. a
  // merchant inserted {last_name} in a broadcast template, but we only have
  // a single "name" field, not split first/last — without this, the raw
  // "{last_name}" text would leak literally into the customer's message).
  return substituted.replace(/\{[a-z_]+\}/g, "").replace(/\s{2,}/g, " ").trim();
}
