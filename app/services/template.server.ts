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
  return Object.entries(variables).reduce((text, [key, value]) => {
    if (value === undefined) return text;
    return text.split(`{${key}}`).join(value);
  }, body);
}
