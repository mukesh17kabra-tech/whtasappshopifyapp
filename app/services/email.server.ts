// Sends email via Resend's REST API (https://resend.com). We verify ONE
// domain ourselves (the app's own domain) — merchants never need to verify
// anything, even if their only email is a Gmail/Yahoo address that can't be
// used as a sending domain. To still make emails feel like they're from
// the merchant:
//   - `fromName` shows the store's name as the display name
//   - `replyTo` is the merchant's own email — when a customer hits Reply,
//     it goes straight to the merchant's real inbox, not ours
//
// Requires RESEND_API_KEY and EMAIL_FROM_ADDRESS (our verified domain's
// address, e.g. "offers@mail.yourapp.com") env vars — without them, email
// sending is skipped gracefully (WhatsApp-only merchants aren't forced to
// set this up).

type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
  fromName?: string | null; // e.g. the merchant's store name
  replyTo?: string | null; // the merchant's own email
};

type SendEmailResult = { success: boolean; error?: string; messageId?: string };

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.EMAIL_FROM_ADDRESS;

  if (!apiKey || !fromAddress) {
    return {
      success: false,
      error: "Email isn't configured for this app yet — set RESEND_API_KEY and EMAIL_FROM_ADDRESS.",
    };
  }

  // "Store Name <offers@mail.yourapp.com>" — this is what shows up as the
  // sender in the customer's inbox.
  const fromHeader = params.fromName ? `${params.fromName} <${fromAddress}>` : fromAddress;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromHeader,
        to: params.to,
        subject: params.subject,
        html: params.html,
        ...(params.replyTo ? { reply_to: params.replyTo } : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Resend send failed (${response.status}):`, errorText);
      return { success: false, error: `Email provider returned ${response.status}` };
    }

    const data = await response.json();
    return { success: true, messageId: data.id };
  } catch (err) {
    console.error("Email send failed:", err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Simple plain-text-to-HTML wrapper so merchants can write templates as
// plain text (same as WhatsApp templates) and still get reasonably
// formatted emails, without needing to learn any HTML.
export function wrapEmailBody(text: string): string {
  const paragraphs = text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => `<p style="margin: 0 0 16px; font-family: sans-serif; font-size: 15px; color: #202223; line-height: 1.5;">${escapeHtml(line)}</p>`)
    .join("");
  return `<div style="max-width: 560px; margin: 0 auto; padding: 24px;">${paragraphs}</div>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
