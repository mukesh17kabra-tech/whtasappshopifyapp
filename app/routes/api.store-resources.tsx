import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";

// Fetches the merchant's actual products, collections, and active discount
// codes so the Templates composer can offer real dropdowns instead of
// free-text URL/code fields.
//
// Each resource is fetched independently and wrapped in its own try/catch —
// this matters because if the app is missing a scope for one resource (e.g.
// read_discounts before that permission was granted/re-approved), we don't
// want that to crash the whole page and take products/collections down
// with it. Missing permissions degrade gracefully to an empty list instead.
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const products = await fetchProducts(admin, shopDomain);
  const collections = await fetchCollections(admin, shopDomain);
  const discounts = await fetchDiscounts(admin);

  return Response.json({ products, collections, discounts });
}

async function fetchProducts(admin: any, shopDomain: string) {
  try {
    const response = await admin.graphql(`
      query Products {
        products(first: 50, sortKey: TITLE) {
          nodes { title handle onlineStoreUrl }
        }
      }
    `);
    const data = await response.json();
    return (data?.data?.products?.nodes ?? []).map((p: any) => ({
      title: p.title,
      url: p.onlineStoreUrl || `https://${shopDomain}/products/${p.handle}`,
    }));
  } catch (err) {
    console.error("Failed to fetch products", err);
    return [];
  }
}

async function fetchCollections(admin: any, shopDomain: string) {
  try {
    const response = await admin.graphql(`
      query Collections {
        collections(first: 50, sortKey: TITLE) {
          nodes { title handle }
        }
      }
    `);
    const data = await response.json();
    return (data?.data?.collections?.nodes ?? []).map((c: any) => ({
      title: c.title,
      url: `https://${shopDomain}/collections/${c.handle}`,
    }));
  } catch (err) {
    console.error("Failed to fetch collections", err);
    return [];
  }
}

async function fetchDiscounts(admin: any) {
  try {
    const response = await admin.graphql(`
      query Discounts {
        codeDiscountNodes(first: 50) {
          nodes {
            codeDiscount {
              ... on DiscountCodeBasic {
                title
                codes(first: 1) { nodes { code } }
                status
              }
              ... on DiscountCodeBxgy {
                title
                codes(first: 1) { nodes { code } }
                status
              }
              ... on DiscountCodeFreeShipping {
                title
                codes(first: 1) { nodes { code } }
                status
              }
            }
          }
        }
      }
    `);
    const data = await response.json();
    return (data?.data?.codeDiscountNodes?.nodes ?? [])
      .map((n: any) => {
        const cd = n.codeDiscount;
        const code = cd?.codes?.nodes?.[0]?.code;
        return code && cd?.status === "ACTIVE" ? { title: cd.title, code } : null;
      })
      .filter(Boolean);
  } catch (err) {
    // Most common cause: the read_discounts scope hasn't been granted yet
    // (either newly added to shopify.app.toml and not yet re-approved by
    // the merchant, or simply missing). Degrade to an empty list rather
    // than crashing the whole Templates page.
    console.error("Failed to fetch discounts (likely missing read_discounts scope)", err);
    return [];
  }
}
