import { Page, Card, Text, BlockStack, List, Badge, Box, InlineStack } from "@shopify/polaris";

export default function GettingStarted() {
  return (
    <Page title="Getting Started">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingLg">What this app does</Text>
            <Text as="p" variant="bodyMd">
              This app lets your store send WhatsApp messages to customers —
              order confirmations, shipping updates, and marketing offers —
              directly from your own connected WhatsApp number. It also adds
              two things to your storefront: a popup that collects visitor
              names/numbers, and a chatbot that helps visitors find products.
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h2" variant="headingMd">Step 1 — Connect WhatsApp</Text>
              <Badge tone="attention">Do this first</Badge>
            </InlineStack>
            <List type="number">
              <List.Item>Go to <strong>Connect WhatsApp</strong> in the menu</List.Item>
              <List.Item>Click <strong>Generate QR code</strong></List.Item>
              <List.Item>Open WhatsApp on the phone number you want to send from → Settings → Linked Devices → Link a Device → scan the code</List.Item>
              <List.Item>Wait a few seconds — it'll flip to "Connected" automatically</List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              Nothing else in the app works until this is connected. Use a dedicated number if you can, not your primary personal WhatsApp.
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Step 2 — Embed the Popup and Chatbot on your storefront</Text>
            <Text as="p" variant="bodyMd">
              These live inside your theme, not this admin dashboard — you need to turn them on separately:
            </Text>
            <List type="number">
              <List.Item>Go to <strong>Online Store → Themes</strong> in your Shopify admin</List.Item>
              <List.Item>Click <strong>Customize</strong> on your live theme</List.Item>
              <List.Item>Click <strong>App embeds</strong> (puzzle-piece icon, usually top-left of the editor)</List.Item>
              <List.Item>You'll see two toggles: <strong>"WhatsApp Offer Popup"</strong> and <strong>"Product Finder Chatbot"</strong> — turn both on</List.Item>
              <List.Item>Click <strong>Save</strong></List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              If you don't see these two options in App Embeds, the theme extension may not be deployed yet — that's a developer-side step (shopify app deploy), not something fixed from this page.
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">What the Popup does</Text>
            <Text as="p" variant="bodyMd">
              A small popup appears on your storefront a few seconds after a visitor lands on a page, asking for their name and WhatsApp number in exchange for offer updates. Customize its heading, message, image, and on/off state on the <strong>Popup Settings</strong> page. Everyone who submits it becomes a subscriber, eligible for broadcasts.
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">What the Chatbot does</Text>
            <Text as="p" variant="bodyMd">
              A floating chat bubble on your storefront. Visitors pick a product category (or type what they're looking for), pick a budget, and get real product suggestions from your actual catalog. They can also ask to be contacted by a real person — this captures their name/number and sends them a real WhatsApp message right away. Customize its color, logo, position, and wording on the <strong>Chatbot Settings</strong> page.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              This is a guided flow, not a live conversation with a person — think of it as a smart product-finder, not real-time chat support.
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">How Templates work — two different kinds</Text>

            <Box paddingBlockStart="200">
              <Text as="h3" variant="headingSm">Marketing templates (for Broadcasts)</Text>
              <Text as="p" variant="bodyMd">
                Go to <strong>Templates → Marketing</strong> tab. Write your offer message — only the customer's <strong>First Name</strong> can be personalized here, since a broadcast doesn't belong to any one order. You can also insert a real product/collection link or discount code from your store. Save it, and it becomes available to pick on the Broadcasts page.
              </Text>
            </Box>

            <Box paddingBlockStart="200">
              <Text as="h3" variant="headingSm">Order Notification templates (automatic)</Text>
              <Text as="p" variant="bodyMd">
                Go to <strong>Templates → Order Notifications</strong> tab. Here you compose the exact wording for Order Confirmation, Shipped, Out for Delivery, Delivered, and failed-delivery messages. Unlike Marketing templates, these can use real order data — customer name, order number, tracking link, etc. — because each one is tied to an actual order. Once saved, these send <strong>automatically</strong> the moment an order is placed or its shipping status changes — you don't send these manually.
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                If you haven't written one for a category yet, a sensible default message is used instead, so orders never go completely silent.
              </Text>
            </Box>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">How to send a Broadcast</Text>
            <List type="number">
              <List.Item>Make sure you have at least one Marketing template saved (see above)</List.Item>
              <List.Item>Go to <strong>Broadcasts</strong></List.Item>
              <List.Item>Pick your template from the dropdown</List.Item>
              <List.Item>Choose who receives it — send to <strong>all</strong> subscribers, or <strong>select specific ones</strong> from the list</List.Item>
              <List.Item>Click <strong>Send broadcast now</strong></List.Item>
              <List.Item>Check the <strong>Broadcast History</strong> tab to see delivery progress and past sends</List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              Broadcasts require the Growth or Pro plan — see the Billing page. Only subscribers who've explicitly opted in to marketing (not just placed an order) will show up as eligible recipients.
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Where your subscribers come from</Text>
            <Text as="p" variant="bodyMd">
              The <strong>Subscribers</strong> page lists everyone: from the storefront popup, from placing an order, or added manually/via CSV. You can search, bulk opt-out or delete, and manually flip someone's marketing consent on or off.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
