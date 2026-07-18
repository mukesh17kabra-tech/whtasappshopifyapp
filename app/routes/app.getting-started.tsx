import { Page, Card, Text, BlockStack, List, Badge, Box, InlineStack } from "@shopify/polaris";

export default function GettingStarted() {
  return (
    <Page title="Getting Started">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingLg">What this app does</Text>
            <Text as="p" variant="bodyMd">
              This app connects your store to WhatsApp and Email — order
              confirmations, shipping updates, marketing broadcasts, and
              fully automated multi-step Flows, all sent from your own
              WhatsApp number and your own store's identity. It also adds a
              storefront popup and a product-finder chatbot to help you grow
              your subscriber list.
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
              <List.Item>On the same page, add <strong>your own email address</strong> — this is used as the Reply-To on marketing emails, so when a customer replies, it lands in your real inbox (Gmail, Yahoo, or anything else)</List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              Nothing else in the app works until WhatsApp is connected. Use a dedicated number if you can, not your primary personal WhatsApp.
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
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">What the Popup does</Text>
            <Text as="p" variant="bodyMd">
              A small popup appears on your storefront a few seconds after a
              visitor lands on a page, asking for their name, WhatsApp
              number, and (optionally) email in exchange for offer updates.
              Customize it on the <strong>Popup Settings</strong> page.
              Everyone who submits it becomes a subscriber, eligible for
              broadcasts and Flows.
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">What the Chatbot does</Text>
            <Text as="p" variant="bodyMd">
              A floating chat bubble on your storefront. Visitors pick a
              product category (or type what they're looking for), pick a
              budget, and get real product suggestions from your actual
              catalog. They can also ask to be contacted by a real person —
              this captures their name/number and sends them a real WhatsApp
              message right away. Customize its color, logo, position, and
              wording on the <strong>Chatbot Settings</strong> page.
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Templates — two tabs</Text>

            <Box paddingBlockStart="200">
              <Text as="h3" variant="headingSm">Marketing & Flow Templates</Text>
              <Text as="p" variant="bodyMd">
                Used for two things: broadcasts (Broadcasts page) and steps
                inside your Flows (Flows page). You can send on WhatsApp,
                Email, or both — pick the channel when you create the
                template. The full set of order variables ({"{first_name}"},
                {" {order_number}"}, tracking info, etc.) works here since
                Flows are tied to real orders; for a plain broadcast without
                a Flow, only First Name will actually fill in. Includes a
                product/collection link and discount code picker pulled live
                from your store, plus 12 ready-made starter templates you can
                add with one click.
              </Text>
            </Box>

            <Box paddingBlockStart="200">
              <Text as="h3" variant="headingSm">Order Notifications</Text>
              <Text as="p" variant="bodyMd">
                Order Confirmation, Shipped, Out for Delivery, Delivered, and
                failed-delivery messages. These use real order data
                automatically and send <strong>automatically</strong> the
                moment an order is placed or its shipping status changes —
                you don't send these manually. If you haven't written one
                for a category yet, a sensible default message is used
                instead.
              </Text>
            </Box>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h2" variant="headingMd">Flows — automated sequences</Text>
              <Badge tone="info">New</Badge>
            </InlineStack>
            <Text as="p" variant="bodyMd">
              Build multi-step automations that trigger from a real event —
              currently "Order Placed," optionally restricted to a specific
              product. Chain together <strong>Wait</strong> steps (a number
              of days, or a specific date) and <strong>Send Message</strong>{" "}
              steps (using any Marketing & Flow template) in any order and
              any number — e.g. "Wait 3 days → send a WhatsApp thank-you →
              wait 7 more days → send a review-request email."
            </Text>
            <List type="number">
              <List.Item>Go to <strong>Flows</strong> → click "Create flow"</List.Item>
              <List.Item>Set a name and confirm the trigger (Order Placed, with an optional specific-product filter)</List.Item>
              <List.Item>Add steps with "+ Add wait" and "+ Add message"</List.Item>
              <List.Item>Save, then go back to the Flows list and click <strong>"Turn on"</strong> — flows are off by default until you enable them</List.Item>
            </List>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">How to send a Broadcast</Text>
            <List type="number">
              <List.Item>Make sure you have at least one Marketing & Flow template saved</List.Item>
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
              The <strong>Subscribers</strong> page lists everyone: from the
              storefront popup, from placing an order, or added
              manually/via CSV (name, phone, and now email too). You can
              search, bulk opt-out or delete, and manually flip someone's
              marketing consent on or off.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
