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

## Popup Settings + name capture + delete + country validation

- **Popup content is now merchant-editable from inside the app** — new "Popup Settings" page: enable/disable toggle, heading, subheading, image upload, delay. The storefront popup fetches this live (via `/apps/whatsapp-offers/popup-config`) instead of using fixed content — change it in the app, no re-editing the theme needed. If disabled, the popup shows nothing at all.
- **Important routing note:** Shopify's App Proxy only maps to ONE base URL, then appends the rest of the path. So both `/apps/whatsapp-offers/optin` and `/apps/whatsapp-offers/popup-config` are handled by a single splat route, `app/routes/api.proxy.$.tsx`, which dispatches based on the trailing path segment. `shopify.app.toml`'s `app_proxy.url` now points to `/api/proxy` — if you had it pointing at `/api/optin` from an earlier version, update it and run `shopify app deploy` again.
- **Popup now captures Name, not just phone number.** Stored on `Optin.name`. This also means broadcast/marketing templates can now use the `{first_name}` variable — it's the one exception to "broadcasts can't use variables," since we do have real per-customer name data for every subscriber, unlike order/tracking data which only exists for order-flow templates.
- **Subscribers page**: added a country-code selector (India, US/Canada, UK, UAE, Australia, Singapore, Pakistan, Bangladesh, Nepal, Saudi Arabia, Germany, France, or "Other") for manual entry — catches a country/number-length mismatch immediately with a specific error. CSV import now also accepts an optional second column for name. Added a permanent **Delete** action (double-click to confirm) alongside the existing reversible Opt out/Re-subscribe toggle.
- **Fixed a crash**: broadcast sending previously had no error handling around the QStash enqueue call — if a config var was wrong, the whole page crashed with a generic "Application Error" and no detail. Now wrapped in try/catch, marks the broadcast as failed, and shows a specific error banner (env var hint included) instead of crashing.

## Multi-merchant WhatsApp (Embedded Signup) — for listing this app publicly

This is the architecture change needed to actually sell this app to other Shopify stores, rather than every merchant sharing one WhatsApp number. Each merchant connects their own WhatsApp Business Account from inside your app.

### What changed in the code

- `Shop` model now stores per-merchant `whatsappPhoneNumberId`, `whatsappBusinessAccountId`, `whatsappAccessToken`, `whatsappDisplayPhoneNumber` — there is no more shared/global WhatsApp account for the Meta path.
- `app/routes/app.whatsapp-connect.tsx` — new page with a "Connect WhatsApp Business Account" button. Loads Meta's JS SDK, opens the Embedded Signup popup, and on completion exchanges the returned authorization code for that merchant's own access token (see `app/services/embedded-signup.server.ts`).
- Every send function (`whatsapp.server.ts`, `meta-templates.server.ts`) now takes `credentials`/`businessAccountId`+`accessToken` as parameters instead of reading global env vars — the job worker (`api.jobs.send-whatsapp.tsx`) looks up each shop's own credentials before sending.
- The inbound webhook (`webhooks.whatsapp.inbound.tsx`) now routes incoming messages to the correct shop by matching `phone_number_id` in Meta's payload against each shop's connected number, since one webhook URL now receives traffic for every merchant.

### What you need to set up in Meta (this part can't be automated — it's account/business setup)

1. **Apply to become a Meta Tech Provider.** This is what lets your app facilitate other businesses connecting their WhatsApp accounts through you, rather than only working with your own. Search "WhatsApp Tech Provider" in Meta's developer docs for the current application process — it typically involves business verification and takes some days.
2. **Create an Embedded Signup configuration.** In your Meta App dashboard → WhatsApp → Embedded Signup → Configurations → create one. This defines what the signup popup looks like and asks for. Copy its ID into `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID`.
3. **Get your App Secret.** Meta Developer Portal → your app → Settings → Basic → App Secret (click "Show"). This goes in `WHATSAPP_APP_SECRET` — treat it like a password, never expose it client-side.
4. **Register one webhook URL** (Meta App dashboard → WhatsApp → Configuration → Webhooks) pointing at `https://your-app.vercel.app/webhooks/whatsapp/inbound` — this single URL receives inbound messages for every merchant who connects, routed internally by phone number ID as described above.

### Token expiry — one thing to build next

Embedded Signup gives you a long-lived token valid for about 60 days, not permanent. There's currently no automatic refresh flow — before it expires, a merchant's sends will start failing. Worth adding: a scheduled job (e.g. weekly, via QStash's schedule feature or a Vercel Cron) that checks each connected shop's token age and prompts a re-connect before expiry, or attempts a silent refresh where Meta's API allows it.

### Testing this yourself

Since you likely don't have a second real Shopify store handy, you can still test the connect flow on your own dev store — connect your own WhatsApp Business Account through the new flow instead of hardcoding it via env vars, and everything else (broadcasts, templates, opt-outs) should work exactly as before, just reading credentials from your Shop row instead of process.env.

## Reverted: no Meta involvement at all (as requested)

The Embedded Signup / Meta Business API path has been fully removed. Sending now works exclusively through the WhatsApp Bridge (`whatsapp-bridge-service`), which connects via each merchant's real WhatsApp Business number the same way WhatsApp Web does — scan a QR code, no Meta account, no Facebook login, no template approval.

**What changed:**
- `Shop.whatsappAccessToken`, `whatsappBusinessAccountId`, `whatsappPhoneNumberId` — removed. Replaced with `whatsappBridgeConnected` (boolean) and `whatsappConnectedAt`.
- `app/services/meta-templates.server.ts` and `app/services/embedded-signup.server.ts` — deleted entirely.
- `app/routes/app.whatsapp-connect.tsx` — rebuilt: shows a QR code right inside your app's admin (fetched from the bridge service), no external popup, no Facebook login screen.
- `app/routes/webhooks.whatsapp.inbound.tsx` (the Meta-specific inbound webhook) — deleted. Opt-out/opt-in handling now goes exclusively through `webhooks.whatsapp.bridge-inbound.tsx`.
- Templates no longer have an approval step — compose one, it's immediately usable for sending.
- The bridge service (`whatsapp-bridge-service`) is now **multi-tenant**: one WhatsApp session per shop, keyed by shop ID, so each of your app's merchants can connect their own number independently. Sessions persist in `auth_sessions/<shopId>/` — make sure that whole folder sits on a Railway Volume so merchants don't have to rescan their QR code after every restart.

**Setup, in order:**
1. Deploy `whatsapp-bridge-service` to Railway (see its own README) — this one service handles every merchant's connection.
2. Set `WHATSAPP_BRIDGE_URL` and `WHATSAPP_BRIDGE_SECRET` in this app's Vercel env vars (same secret on both sides).
3. Each merchant who installs your Shopify app goes to the "Connect WhatsApp" page and scans their own QR code — no setup needed from you per-merchant beyond the one bridge deployment.

**The tradeoff, worth repeating plainly:** this is not Meta's officially sanctioned way to send WhatsApp messages at scale. It works well for small-to-moderate volume and is what many budget WhatsApp marketing tools actually do under the hood, but numbers can get restricted if usage looks like spam (too fast, too many, no real opt-in). There's no approval process because there's no oversight body approving it — that responsibility now sits with you and your merchants using it sensibly.

## Billing / Paid Plans

Real subscription billing via Shopify's official Billing API — Shopify collects the payment method and handles charging, you never touch card details.

- **Free plan**: popup capture, order confirmations, shipping updates, up to 100 subscribers (the 100 cap isn't enforced in code yet — add a check in the popup's opt-in route if you want to hard-limit it)
- **Growth ($9.99/mo)** and **Pro ($29.99/mo)**: unlock marketing broadcasts, unlimited subscribers, 7-day free trial on both
- `app/routes/app.billing.tsx` — pricing page, shows current plan
- `app/routes/app.billing.subscribe.tsx` — triggers Shopify's subscription confirmation flow
- Broadcasts (`app.broadcasts.tsx`) are gated behind an active paid plan, checked both in the UI and server-side in the action (so it can't be bypassed by directly posting to the route)

### Before going live — flip `isTest`

Every `billing.check()` and `billing.request()` call currently has `isTest: true`. This means **no real money is ever charged** — required while developing, but you must change this to `false` (or remove the flag) in all three files (`app.billing.tsx`, `app.billing.subscribe.tsx`, `app.broadcasts.tsx`) before submitting to the Shopify App Store or letting real merchants pay. Test this thoroughly with `isTest: true` first — Shopify still shows the full approval flow, it just never bills anyone.

### Adjusting prices/plans

Edit the `billing` block in `app/shopify.server.ts` — amounts, currency, trial length, and interval are all there. Add a third plan by adding another key to `BILLING_PLANS` and a matching entry in the `billing` config object, then add it to `PLAN_DETAILS` in `app.billing.tsx`.

## Marketing vs Order Notification templates, real store data, order-based subscribers

Major rework based on real usage feedback:

**Templates split into two tabs:**
- **Marketing** — for broadcasts. Only `{first_name}` works as a variable (from the popup's Name field), since a broadcast has no single order tied to it. Product/Collection link and discount code are now **real dropdowns fetched live from your store** (`api.store-resources.tsx`, via Shopify's Admin GraphQL API) instead of free-text fields.
- **Order Notifications** — one composer per fixed category (Order Confirmation, Shipped, Out for Delivery, Delivered, Delivery Attempted, Delivery Failed). Full variable set works here (`{order_number}`, `{tracking_url}`, `{last_name}`, etc.) since real order data exists. Saving replaces the existing template for that category rather than creating duplicates. If you haven't set one for a category, a sensible built-in default is used so orders still get *something* sent.

**Fixed a real bug:** a merchant could insert `{last_name}` into a Marketing template, and since broadcasts only ever had a single combined `name` field, that literal `{last_name}` text leaked straight into the customer's message. `renderTemplateBody` now strips any unsubstituted `{tag}` as a safety net — nothing raw ever reaches a customer, and the Marketing tab no longer even offers variables it can't fill.

**Subscribers now auto-populate from orders too.** `webhooks.orders.create.tsx` upserts an `Optin` row (name + phone) for every order placed, tagged `source: "order"`. These default to `marketingConsent: false` — placing an order isn't marketing opt-in under WhatsApp's rules or India's DPDP Act — but they still receive order confirmation/shipping updates regardless, since those are utility messages tied to their own order. Only popup/manual/CSV-added numbers default to marketing-eligible. Broadcasts now filter by `marketingConsent: true`, not just "not opted out."

**Subscribers page**: added a select-all checkbox, bulk "Opt out selected" / "Delete selected" actions, and a per-row Marketing consent toggle so a merchant can manually upgrade an order-only contact to marketing-eligible if they get separate consent.

## Deferred to a follow-up: WhatsApp chatbot builder + support chat

Not built in this pass — flagged as genuinely large, separate features rather than rushed:
- A configurable automated chat flow (ask customer interest/budget, suggest products/collections, "Let's chat with us" bubble on the storefront)
- A direct support chat channel from the merchant to you (the app developer)

Both are legitimate, valuable next features — worth their own dedicated build rather than bolting on incompletely here.

## Searchable product/collection/discount pickers, Support Chat, storefront Chatbot

**Searchable dropdowns**: the Templates page's product/collection/discount fields are now type-to-search (Polaris Autocomplete) instead of plain dropdowns — useful once a store has more than a handful of items.

**Support Chat** (`app.support.tsx` for merchants, `developer.support.tsx` for you):
- Merchants get a "Support" page in their nav — a real chat thread stored in the `SupportMessage` table, polling every 5s for your replies.
- You view/reply to every shop's thread at `https://your-app.vercel.app/developer/support?key=YOUR_SECRET` — set `DEVELOPER_SUPPORT_SECRET` to any random string. This is a plain, unstyled page since only you use it — a shop list on the left (unread counts shown), thread + reply box on the right.
- This is genuinely simple by design — no ticket system, priorities, or categorization. Good enough for direct merchant contact; would need more structure if you get many concurrent merchants.

**Storefront Chatbot** (`extensions/whatsapp-popup/blocks/chatbot.liquid`):
- A floating WhatsApp-green chat bubble, bottom-right, with a one-time tooltip ("Let's chat to find your product!") a few seconds after page load.
- Rule-based flow (not real AI — a decision tree, which is honest about what it does and keeps it instant): pick a category (your real collections) → pick a budget bracket → get up to 3 matching product cards with image/price/link → then either "Start over" or "Chat with us on WhatsApp" (opens a wa.me link pre-filled with their interest, using your connected WhatsApp number).
- Data comes from `/apps/whatsapp-offers/chatbot-data`, a new endpoint on the same App Proxy dispatcher, pulling real collections/products/prices via Shopify's Admin API.
- Enable it the same way as the popup: Theme Editor → App Embeds → toggle "Product Finder Chatbot" on.
- The WhatsApp handoff link only appears if you've connected a WhatsApp number (Connect WhatsApp page) — the bridge service now reports back the connected number so this can build a working wa.me link.

**Known limitation to flag honestly**: the chatbot is a scripted flow, not an LLM — it can't answer open-ended questions, only walk the fixed category → budget → suggestion path. If you want true conversational AI product recommendations later, that's a meaningfully bigger build (calling an LLM API per message) — ask if you want that upgrade.

## Chatbot Settings page

New "Chatbot Settings" page for the storefront Product Finder Chatbot:
- Enable/disable toggle (separate from the theme editor's App Embed toggle — both need to be on for the widget to actually show)
- Custom title (shown in the chat header)
- Custom tooltip message (the one-time popup near the bubble)
- Logo upload (replaces the default 💬 emoji icon)
- Position: bottom-right or bottom-left

These are fetched live by `chatbot.liquid` from the same `/apps/whatsapp-offers/chatbot-data` endpoint used for product data — one request gets both the catalog and the appearance settings.

**Architecture clarification, worth restating:** this chatbot is a website widget only. It does not send or receive real WhatsApp messages during the conversation — only the final "Chat with us on WhatsApp" button opens a real WhatsApp link. A genuinely different feature — an automated bot that replies to real incoming WhatsApp messages on your connected number — would need its own dedicated build (conversation state per phone number, reusing the bridge's inbound webhook). Flagged as a clear next step if wanted, not built in this pass.

## Chatbot "Talk to a real person" — real WhatsApp handoff, honestly scoped

When a visitor picks "Talk to a real person": Yes/No confirm → type name → type WhatsApp number (validated) → both captured into `Optin` (`source: "chatbot"`, `marketingConsent: true` since it's explicit opt-in) → an actual WhatsApp message is sent immediately via the bridge, from the merchant's connected number, to the visitor's number.

**What this is:** a real WhatsApp conversation genuinely starts between the merchant's business number and the visitor's own phone — not a redirect link, an actual message sent server-side.

**What this deliberately is NOT (yet):** a live two-way chat rendered inside the website widget itself. Once that first message sends, the conversation continues in the visitor's own WhatsApp app and the merchant's WhatsApp Business app — not inside the site. Building true in-website live relay (visitor keeps typing on the site, merchant sees/replies from their phone, responses flow back into the widget in real time) is a meaningfully bigger, separate feature — it requires solving how to route a merchant's WhatsApp reply back to the correct visitor's browser session when the merchant's phone is a single inbox potentially juggling many simultaneous visitors. Worth building properly as its own task if wanted, rather than a fragile first pass here.

New endpoint: `POST /apps/whatsapp-offers/chatbot-lead` — validates name + phone, does the Optin upsert, sends the handoff message, added to the same `api.proxy.$.tsx` dispatcher.
