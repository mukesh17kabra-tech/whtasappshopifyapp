import { redirect, type LoaderFunctionArgs } from "@remix-run/node";

// Shopify loads the embedded app at the base App URL ("/"), passing shop,
// host, and embedded query params. This route captures that, verifies the
// shop is provided, and redirects into /app (where the real Polaris
// dashboard lives) carrying the same query params along.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (shop) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // No shop param — likely someone visiting the bare URL directly outside
  // Shopify. Send them to the login page instead of showing a blank screen.
  throw redirect("/auth/login");
};

export default function Index() {
  return null;
}
