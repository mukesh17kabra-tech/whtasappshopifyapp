import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";

// Fetches the merchant's actual products, collections, and active discount
// codes so the Templates composer can offer real dropdowns instead of
// free-text URL/code fields. Called via fetcher.load from the client.
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);

  const response = await admin.graphql(`
    query StoreResources {
      products(first: 50, sortKey: TITLE) {
        nodes {
          title
          handle
          onlineStoreUrl
        }
      }
      collections(first: 50, sortKey: TITLE) {
        nodes {
          title
          handle
        }
      }
      codeDiscountNodes(first: 50) {
        nodes {
          codeDiscount {
            ... on DiscountCodeBasic {
              title
              codes(first: 1) {
                nodes { code }
              }
              status
            }
            ... on DiscountCodeBxgy {
              title
              codes(first: 1) {
                nodes { code }
              }
              status
            }
            ... on DiscountCodeFreeShipping {
              title
              codes(first: 1) {
                nodes { code }
              }
              status
            }
          }
        }
      }
    }
  `);

  const data = await response.json();
  const shopDomain = session.shop;

  const products = (data?.data?.products?.nodes ?? []).map((p: any) => ({
    title: p.title,
    url: p.onlineStoreUrl || `https://${shopDomain}/products/${p.handle}`,
  }));

  const collections = (data?.data?.collections?.nodes ?? []).map((c: any) => ({
    title: c.title,
    url: `https://${shopDomain}/collections/${c.handle}`,
  }));

  const discounts = (data?.data?.codeDiscountNodes?.nodes ?? [])
    .map((n: any) => {
      const cd = n.codeDiscount;
      const code = cd?.codes?.nodes?.[0]?.code;
      return code && cd?.status === "ACTIVE" ? { title: cd.title, code } : null;
    })
    .filter(Boolean);

  return Response.json({ products, collections, discounts });
}
