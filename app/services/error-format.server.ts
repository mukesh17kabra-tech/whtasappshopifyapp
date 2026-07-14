// Shopify's admin.graphql() throws a raw fetch Response (not a JS Error) on
// non-2xx replies (401/403/etc). `String(response)` just gives "[object
// Response]" and console.error on it hides the body, which is exactly where
// Shopify puts the actual reason ("Invalid API key or access token",
// "This action requires..."). This helper reads that body so the real cause
// shows up in logs and in any banner shown to the merchant, instead of a
// useless "[object Response]" string.
export async function formatCaughtError(err: unknown): Promise<string> {
  if (err instanceof Response) {
    let bodyText = "";
    try {
      bodyText = await err.clone().text();
    } catch {
      // body already consumed / not readable — fall back to status only
    }
    return `HTTP ${err.status} ${err.statusText || ""}${bodyText ? ` — ${bodyText}` : ""}`.trim();
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}