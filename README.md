# Shopify WhatsApp Offers & Tracking App

This is now a **complete, standalone Remix app** ready to deploy directly — you do NOT need to run `shopify app init` separately and merge files. Everything Remix and Shopify require (root layout, entry files, auth routes, vite/tsconfig config) is included.

## What's included

- `app/root.tsx`, `app/entry.server.tsx` — Remix's required root layout and server entry point
- `app/routes/auth.$.tsx`, `app/routes/auth.login/route.tsx` — Shopify OAuth install/login flow
- `vite.config.ts`, `tsconfig.json` — build configuration
- `shopify.app.toml` — app config (client ID, scopes, webhooks, app proxy) used by the Shopify CLI
- `app/db.server.ts` — Prisma client using the Neon serverless driver adapter (avoids connection exhaustion across Vercel's serverless invocations)
- `prisma/schema.prisma` — Session table (required by Shopify auth) + app tables: Shop, Optin, OrderTracking, Template, Broadcast, MessageLog
- `app/shopify.server.ts` — Shopify app config, Prisma-backed session storage, webhook registration
- `app/routes/webhooks.orders.create.tsx` — fast-ack webhook handler; writes to DB and enqueues a background job instead of sending WhatsApp inline (avoids Vercel/Shopify timeout limits)
- `app/routes/webhooks.fulfillments.update.tsx` — same pattern for shipment tracking updates
- `app/routes/webhooks.app.uninstalled.tsx` — cleans up session data when a merchant uninstalls
- `app/routes/webhooks.whatsapp.inbound.tsx` — handles WhatsApp opt-out/opt-in replies (STOP/START)
- `app/services/queue.server.ts` + `app/routes/api.jobs.send-whatsapp.tsx` — Upstash QStash job queue + worker route that performs the actual WhatsApp API call
- `app/services/whatsapp.server.ts` — thin wrapper around the WhatsApp send call (currently wired for Meta's Cloud API directly — swap for Gupshup/Interakt/WATI if you prefer a BSP)
- `app/routes/api.optin.tsx` — public App Proxy route the storefront popup calls to save a phone number opt-in
- `extensions/whatsapp-popup/blocks/popup.liquid` — Theme App Extension block: the actual popup shown on the storefront
- `app/routes/app.tsx` + `app._index/broadcasts/subscribers/templates.tsx` — full Polaris admin dashboard
- `vercel.json` — minimal deploy config

## Setup steps

1. **Install the Shopify CLI (needed for `shopify.app.toml` linking and theme extension deploy, not for the app itself)**
   ```
   npm install -g @shopify/cli
   ```
2. **Create your app in Shopify Partners**
   - Go to partners.shopify.com → Apps → Create app
   - Copy the Client ID into `shopify.app.toml` (`client_id = "..."`) and into your `SHOPIFY_API_KEY` env var
   - Copy the Client Secret into `SHOPIFY_API_SECRET`

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

## Vercel + Remix function duration

`vercel.json` intentionally does **not** set a `functions` block with path globs like `app/routes/webhooks.*.tsx`. That syntax is for Vercel's native `/api` directory functions — Remix builds your routes into its own internal output format, so those globs never match anything and the build fails with `unmatched-function-pattern`.

For Remix apps, function duration is controlled differently:
- **Vercel Hobby (free) plan**: functions are capped at **10 seconds**, and this cannot be overridden — it's a Hobby plan limit, not something `vercel.json` can raise. This is fine for the webhook handlers here since they just write to Postgres and enqueue a job (should complete in well under 1s normally).
- **Vercel Pro plan**: you can raise the cap up to 60s (or 300s with extra config) via the **Vercel Dashboard → Project Settings → Functions → Default Max Duration**, not via `vercel.json`, when using the Remix framework preset.

Since this whole stack is designed to stay on free tiers, and the fast-ack + QStash queue pattern means no single function call should ever need more than a couple seconds, the Hobby plan's 10s cap should never actually bind here. If you later see timeout errors specifically on `api.jobs.send-whatsapp`, that's a sign the WhatsApp API call itself is slow — check Meta's status page before assuming you need to upgrade Vercel.

## Database sync: db push vs migrate deploy

The build uses `prisma db push` instead of `prisma migrate deploy`. The difference:
- `migrate deploy` applies pre-generated migration files from a `prisma/migrations` folder (created by running `prisma migrate dev` on your own machine first). We never generated one, so this failed with "No migration found."
- `db push` syncs your `schema.prisma` directly to the database, no migration files needed — simpler for a single-developer project without a local dev environment.

The `--accept-data-loss` flag is safe right now since the database is empty. Once you have real subscriber/order data in production, be careful: if you change a column type or drop a field in `schema.prisma`, `db push --accept-data-loss` will apply that destructively without asking. At that point, consider switching to proper migrations (`prisma migrate dev` locally, commit the migration files, then use `prisma migrate deploy` in `vercel-build` instead) so schema changes are reviewable and reversible.

## In-app template composer (no Meta/Google approval needed to build)

The Templates page (`app/routes/app.templates.tsx`) is now a full composer, not just a form referencing an external Meta template ID:

- Write the message body directly in the app
- Insert dynamic tags like `{first_name}`, `{order_id}`, `{tracking_url}` at your cursor — see the full list in `ORDER_VARIABLES` in that file
- Upload an optional header image (stored via Vercel Blob — free tier, add the "Blob" integration in your Vercel project's Storage tab to get `BLOB_READ_WRITE_TOKEN`)
- Live WhatsApp-style preview with sample data substituted in

**Important compliance note:** building the template is fully in-app now, but *sending* a marketing broadcast built this way uses `sendWhatsappCustomMessage` in `whatsapp.server.ts`, which sends freeform text/image messages — not Meta's pre-approved template mechanism. Meta's Cloud API restricts freeform sends to within a 24-hour customer service window (i.e., messages the customer can reply to shortly after they last messaged you) unless your WhatsApp Business Account has been granted expanded messaging limits. Sending bulk unapproved marketing content outside that window via the official API risks the message being rejected or your number being restricted.

Two paths forward if you want true no-approval bulk sending:
1. Get your WhatsApp Business Account's messaging limits expanded by building a track record of quality conversations (Meta reviews this automatically over time)
2. Use an unofficial WhatsApp automation library (e.g. Baileys) that logs into a regular WhatsApp Web session instead of the Business API — no approval needed, but against WhatsApp's Terms of Service and carries a real ban risk, especially at volume. This would require a different, always-on hosting model (not a good fit for Vercel's serverless functions, which can't hold a persistent browser/WebSocket session) — ask if you want to explore this route, it's a meaningfully different architecture.

## Sending without Meta approval (WhatsApp Bridge)

As requested, the default send path no longer requires any Meta/Google approval. A separate small service (`whatsapp-bridge-service`, provided alongside this app but deployed independently) connects to WhatsApp the same way WhatsApp Web does — link a real phone number by scanning a QR code once, then send messages directly through that connection.

**Setup:**
1. Deploy `whatsapp-bridge-service` to Railway (free tier) — full instructions in that folder's own README
2. Scan the QR code once to link your WhatsApp number
3. Set these env vars in this app (the Shopify app, on Vercel):
   ```
   WHATSAPP_PROVIDER=bridge
   WHATSAPP_BRIDGE_URL=https://your-bridge-service.up.railway.app
   WHATSAPP_BRIDGE_SECRET=<same secret you set on the bridge service>
   ```
4. `app/routes/webhooks.whatsapp.bridge-inbound.tsx` receives forwarded replies (STOP/START) from the bridge — set `INBOUND_WEBHOOK_URL` on the bridge service to point here (see bridge README).

**What this trades away:** no template approval step, fully freeform messages including images, sent instantly. **What it costs:** this isn't an officially sanctioned way to use WhatsApp — numbers that send too much too fast, or get reported as spam, can get banned. Start with a dedicated number, go slow on volume initially, and keep an eye on delivery failures. Full risk discussion is in `whatsapp-bridge-service/README.md`.

If you ever want to switch back to the compliant Meta path (e.g. after your account earns higher messaging limits), set `WHATSAPP_PROVIDER=meta` and fill in the `WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_ACCESS_TOKEN` vars — the code path for that is still intact in `whatsapp.server.ts`.
