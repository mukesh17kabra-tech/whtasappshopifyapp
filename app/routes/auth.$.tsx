import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";

// Matches /auth/* — handles the Shopify OAuth redirect flow.
export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  return null;
}
