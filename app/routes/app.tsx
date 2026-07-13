import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "~/shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return json({ apiKey: process.env.SHOPIFY_API_KEY || "" });
}

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Dashboard
        </Link>
        <Link to="/app/whatsapp-connect">Connect WhatsApp</Link>
        <Link to="/app/broadcasts">Broadcasts</Link>
        <Link to="/app/subscribers">Subscribers</Link>
        <Link to="/app/templates">Templates</Link>
        <Link to="/app/popup-settings">Popup Settings</Link>
        <Link to="/app/chatbot-settings">Chatbot Settings</Link>
        <Link to="/app/billing">Billing</Link>
        <Link to="/app/support">Support</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Required by Shopify to correctly handle auth-related errors/headers
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs: any) => {
  return boundary.headers(headersArgs);
};
