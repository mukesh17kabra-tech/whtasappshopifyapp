// Server-side steps to finish Meta's WhatsApp Embedded Signup flow, after
// the frontend popup (app.whatsapp-connect.tsx) gets an authorization code.
// Docs: https://developers.facebook.com/docs/whatsapp/embedded-signup

import prisma from "~/db.server";

const GRAPH_VERSION = "v19.0";

// Exchanges the short-lived authorization code (from FB.login's callback)
// for an access token scoped to the merchant's WhatsApp Business Account.
// Uses YOUR Meta app's ID + secret (the Tech Provider app), not the
// merchant's — the merchant never sees or handles credentials directly.
export async function exchangeCodeForToken(code: string): Promise<string | null> {
  const appId = process.env.WHATSAPP_APP_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  if (!appId || !appSecret) {
    console.error("WHATSAPP_APP_ID or WHATSAPP_APP_SECRET not set");
    return null;
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${code}`,
    );
    const data = await res.json();
    if (!res.ok || !data.access_token) {
      console.error("Code exchange failed", data);
      return null;
    }
    return data.access_token;
  } catch (err) {
    console.error("exchangeCodeForToken failed", err);
    return null;
  }
}

// Exchanges a short-lived token for a long-lived one (~60 days). Returns
// null on failure — callers should fall back to the short-lived token rather
// than failing the whole connection, since a short-lived token still works
// immediately, just needs reconnecting sooner.
export async function getLongLivedToken(shortLivedToken: string): Promise<string | null> {
  const appId = process.env.WHATSAPP_APP_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  if (!appId || !appSecret) return null;

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortLivedToken}`,
    );
    const data = await res.json();
    if (!res.ok || !data.access_token) {
      console.error("Long-lived token exchange failed", data);
      return null;
    }
    return data.access_token;
  } catch (err) {
    console.error("getLongLivedToken failed", err);
    return null;
  }
}

// Subscribes your app to receive webhooks (message status, inbound
// messages) for this merchant's WhatsApp Business Account. Required once
// per WABA connection — without this, you won't get delivery/read receipts
// or inbound replies for messages sent through this merchant's number.
export async function subscribeAppToWaba(wabaId: string, accessToken: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/subscribed_apps`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    const data = await res.json();
    if (!res.ok) {
      console.error("Failed to subscribe app to WABA", data);
      return false;
    }
    return true;
  } catch (err) {
    console.error("subscribeAppToWaba failed", err);
    return false;
  }
}

// Fetches the human-readable phone number (e.g. "+1 555 123 4567") for
// display in the app's UI, so merchants see which number they connected.
export async function getPhoneNumberDisplay(
  phoneNumberId: string,
  accessToken: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}?fields=display_phone_number`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const data = await res.json();
    if (!res.ok) return null;
    return data.display_phone_number ?? null;
  } catch (err) {
    console.error("getPhoneNumberDisplay failed", err);
    return null;
  }
}

// Fetches this shop's connected credentials in the shape whatsapp.server.ts
// expects, or null if not connected yet. Centralized here so every send
// call site does the same lookup consistently.
export async function getShopWhatsappCredentials(shopId: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop?.whatsappPhoneNumberId || !shop?.whatsappAccessToken) {
    return null;
  }
  return {
    phoneNumberId: shop.whatsappPhoneNumberId,
    accessToken: shop.whatsappAccessToken,
  };
}
