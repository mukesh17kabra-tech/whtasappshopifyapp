# Shopify WhatsApp Offers & Tracking App

## What's included in this scaffold

- `app/db.server.ts` — Prisma client using the Neon serverless driver adapter (avoids connection exhaustion across Vercel's serverless invocations)
- `prisma/schema.prisma` — Session table (required by Shopify auth) + app tables: Shop, Optin, OrderTracking, Template, Broadcast, MessageLog
- `app/shopify.server.ts` — Shopify app config, Prisma-backed session storage, webhook registration
- `app/routes/webhooks.orders.create.tsx` — fast-ack webhook handler; writes to DB and enqueues a background job instead of sending WhatsApp inline (avoids Vercel/Shopify timeout limits)
- `app/services/queue.server.ts` + `app/routes/api.jobs.send-whatsapp.tsx` — Upstash QStash job queue + worker route that performs the actual WhatsApp API call
- `app/services/whatsapp.server.ts` — thin wrapper around the WhatsApp send call (currently wired for Meta's Cloud API directly — swap for Gupshup/Interakt/WATI if you prefer a BSP)
- `app/routes/api.optin.tsx` — public App Proxy route the storefront popup calls to save a phone number opt-in
- `extensions/whatsapp-popup/blocks/popup.liquid` — Theme App Extension block: the actual popup shown on the storefront
- `vercel.json` — function timeout config

## Setup steps

1. **Create the Shopify app**
   ```
   npm install -g @shopify/cli
   shopify app init
   ```
   Then merge this scaffold's `app/`, `prisma/`, `extensions/` folders into the generated project (the CLI generates additional boilerplate — routes for `app._index.tsx`, `auth.$.tsx`, etc. — that isn't duplicated here).

2. **Configure App Proxy** in `shopify.app.toml`:
   ```toml
   [app_proxy]
   url = "https://your-app.vercel.app/api/optin"
   subpath = "whatsapp-offers"
   prefix = "apps"
   ```
   This makes `/apps/whatsapp-offers/optin` on the storefront route to `/api/optin` on your server.

3. **Set up Neon**
   - Create a project at neon.tech
   - Copy the pooled connection string → `DATABASE_URL`
   - Copy the direct connection string → `DIRECT_URL`
   - Run `npx prisma migrate dev` locally to create tables, then `npx prisma migrate deploy` in production

4. **Set up Upstash QStash** (for background jobs)
   - Create a QStash instance at upstash.com
   - Copy token + signing keys into env vars
   - Add signature verification to `api.jobs.send-whatsapp.tsx` (the import in the scaffold is a placeholder — use `@upstash/qstash`'s Remix/Node verify helper)

5. **Set up WhatsApp sending**
   - Apply for WhatsApp Business API access via Meta Business Manager, or sign up with a BSP (Gupshup/Interakt/WATI are easier to onboard with in India)
   - Get your templates approved (order_confirmation, shipment_update, and any marketing/offer templates) — this takes 1-3 days per template
   - Fill in `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN`

6. **Deploy to Vercel**
   ```
   vercel --prod
   ```
   Set all env vars from `.env.example` in the Vercel project settings.

## Admin dashboard (Polaris)

- `app/routes/app.tsx` — layout + nav (Dashboard / Broadcasts / Subscribers / Templates)
- `app/routes/app._index.tsx` — overview stats: active subscriber count, messages sent/failed, recent activity table
- `app/routes/app.broadcasts.tsx` — pick an approved marketing template, send to all active subscribers, view send history/progress
- `app/routes/app.subscribers.tsx` — searchable, paginated list of opted-in phone numbers
- `app/routes/app.templates.tsx` — register your Meta/BSP-approved template names so they appear as options when sending order updates or broadcasts

All Polaris — free, no extra cost, matches native Shopify admin styling automatically (dark mode, RTL, etc. handled for you).

## Fulfillment tracking webhook

`app/routes/webhooks.fulfillments.update.tsx` — handles both `FULFILLMENTS_CREATE` and `FULFILLMENTS_UPDATE`. Maps Shopify's `shipment_status` field to a WhatsApp template:

| Shopify shipment_status | Template sent        |
|--------------------------|----------------------|
| (fulfillment just created, no status yet) | `shipment_update` |
| `in_transit`             | `shipment_update`    |
| `out_for_delivery`       | `out_for_delivery`   |
| `delivered`              | `order_delivered`    |
| `attempted_delivery`     | `delivery_attempted` |
| `failure`                | `delivery_failed`    |

You'll need each of these as an approved **Utility** template in Meta Business Manager (register them via the Templates page above). The handler de-dupes so it won't resend the same status twice for one order.

## Staying on free tiers

- **Vercel Hobby** — free, fine for this app's traffic pattern (webhooks + occasional admin page loads). Function timeout caps (10s default, configurable up to 60s on Hobby with `vercel.json`, which is already set here) are why we queue jobs instead of sending WhatsApp messages inline.
- **Neon Free tier** — 0.5 GB storage, enough for tens of thousands of opt-in rows/message logs before you'd need to upgrade.
- **Upstash QStash Free tier** — 500 messages/day. Fine for order/fulfillment notifications at low-to-moderate order volume. For broadcasts, if you have more subscribers than daily quota allows, either upgrade QStash or split a broadcast across multiple days (not yet built — see below).
- **WhatsApp Cloud API (Meta direct)** — no monthly fee, you only pay per conversation once you exceed the free tier of ~1,000 conversations/month (as of last check — verify current pricing on Meta's site since this changes). This is cheaper than most BSPs (Gupshup/Interakt add markup) if you're comfortable managing template submission yourself.

## Opt-out handling (WhatsApp inbound webhook)

`app/routes/webhooks.whatsapp.inbound.tsx` handles two things Meta requires:

1. **GET request** — the one-time verification challenge Meta sends when you register the webhook URL. It echoes back `hub.challenge` if `hub.verify_token` matches your `WHATSAPP_WEBHOOK_VERIFY_TOKEN` env var.
2. **POST request** — fires on every inbound WhatsApp message to your business number. It checks the message text against opt-out keywords (`stop`, `unsubscribe`, `cancel`, etc.) and opt-in keywords (`start`, `subscribe`), updates the `Optin.optedOutAt` field accordingly, and replies with a confirmation.

**Setup in Meta:**
- Go to your app in Meta Business Manager → WhatsApp → Configuration → Webhooks
- Callback URL: `https://your-app.vercel.app/webhooks/whatsapp/inbound`
- Verify token: same value as `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- Subscribe to the `messages` field

**Defense in depth:** the broadcast job worker (`api.jobs.send-whatsapp.tsx`) re-checks opt-out status right before sending, in case someone opts out after a broadcast is queued but before their individual job runs.

**Manual override:** the Subscribers admin page now has an "Opt out" / "Re-subscribe" button per row, for merchants who need to manually manage a number (e.g. a customer emails support instead of texting STOP).

**Not yet added:** proper webhook signature verification using Meta's `X-Hub-Signature-256` header (currently the POST handler trusts any request to that URL — fine for initial testing, but add signature verification using your app secret before going live, since without it anyone could hit this endpoint and forge opt-out/opt-in events).

## What's NOT yet built (next steps)

- Meta webhook signature verification (`X-Hub-Signature-256`) on the inbound WhatsApp webhook — see note above, do this before production
- Multi-day broadcast batching for subscriber lists larger than your daily QStash quota
- Template status sync with Meta's API (currently you self-report a template as "approved" when registering it)
