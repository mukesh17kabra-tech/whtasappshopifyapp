import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";

export default function App() {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
        <style>{`
          /* ---- Global visual polish ---- */
          html, body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            text-rendering: optimizeLegibility;
          }

          /* Slightly tighter, more confident headings */
          .Polaris-Text--headingLg, .Polaris-Text--headingMd, .Polaris-Text--headingSm {
            letter-spacing: -0.01em;
          }

          /* Cards: soften the default border, add a subtle lift and a
             gentle hover transition so the UI feels more alive instead of
             flat and static. */
          .Polaris-Card {
            border-radius: 12px !important;
            box-shadow: 0 1px 2px rgba(23, 24, 24, 0.05), 0 1px 4px rgba(23, 24, 24, 0.04) !important;
            transition: box-shadow 150ms ease, transform 150ms ease;
          }
          .Polaris-Card:hover {
            box-shadow: 0 2px 8px rgba(23, 24, 24, 0.08), 0 1px 4px rgba(23, 24, 24, 0.06) !important;
          }

          /* Primary buttons: a warmer, more WhatsApp-adjacent green accent,
             with a touch more depth than Polaris's flat default. */
          .Polaris-Button--variantPrimary {
            background: linear-gradient(180deg, #25D366 0%, #1FAE57 100%) !important;
            border: none !important;
            box-shadow: 0 1px 2px rgba(31, 174, 87, 0.3) !important;
          }
          .Polaris-Button--variantPrimary:hover {
            background: linear-gradient(180deg, #22c55e 0%, #1a9a4c 100%) !important;
          }

          /* Nav: a little more breathing room between items */
          .Polaris-Navigation__Item {
            border-radius: 8px !important;
          }

          /* Tabs: clearer active state */
          .Polaris-Tabs__Tab--selected {
            font-weight: 600 !important;
          }

          /* Badges: slightly bolder text so status pills read faster */
          .Polaris-Badge {
            font-weight: 600 !important;
          }

          /* Tables: a touch more row padding so dense data doesn't feel
             cramped */
          .Polaris-DataTable__Cell {
            padding-top: 12px !important;
            padding-bottom: 12px !important;
          }
        `}</style>
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
