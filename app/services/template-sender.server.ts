import prisma from "~/db.server";
import { sendWhatsappCustomMessage } from "./whatsapp.server";
import { sendEmail, wrapEmailBody } from "./email.server";
import { renderTemplateBody } from "./template.server";

type Recipient = {
  phoneNumber?: string | null;
  email?: string | null;
  name?: string | null;
};

type SendTemplateResult = {
  whatsappSent: boolean;
  emailSent: boolean;
  errors: string[];
};

// Sends a Template (which has a `channel` of "whatsapp" | "email" | "both")
// to one subscriber. Used by the Offer Template quick-send and by Flow step
// execution — both need the exact same "render + send on the right
// channel(s)" logic, so it lives here once instead of being duplicated.
export async function sendTemplateToSubscriber(
  shopId: string,
  template: { body: string; subject: string | null; channel: string; imageUrl: string | null; name: string },
  recipient: Recipient,
): Promise<SendTemplateResult> {
  const result: SendTemplateResult = { whatsappSent: false, emailSent: false, errors: [] };
  const renderedBody = renderTemplateBody(template.body, { first_name: recipient.name || "there" });

  const wantsWhatsapp = template.channel === "whatsapp" || template.channel === "both";
  const wantsEmail = template.channel === "email" || template.channel === "both";

  if (wantsWhatsapp) {
    if (!recipient.phoneNumber) {
      result.errors.push("No phone number on file for WhatsApp send");
    } else {
      const waResult = await sendWhatsappCustomMessage({
        shopId,
        to: recipient.phoneNumber,
        text: renderedBody,
        imageUrl: template.imageUrl,
      });
      result.whatsappSent = waResult.success;
      if (!waResult.success) result.errors.push("WhatsApp send failed");
    }
  }

  if (wantsEmail) {
    if (!recipient.email) {
      result.errors.push("No email address on file for email send");
    } else {
      // Fetch the merchant's own store name (for the "From" display name)
      // and their support email (for Reply-To) — this is what makes the
      // email feel like it's genuinely from the merchant, even though the
      // actual sending domain is ours.
      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { shopDomain: true, supportEmail: true },
      });
      const storeName = shop?.shopDomain?.replace(".myshopify.com", "") ?? null;

      const emailResult = await sendEmail({
        to: recipient.email,
        subject: template.subject || template.name,
        html: wrapEmailBody(renderedBody),
        fromName: storeName,
        replyTo: shop?.supportEmail ?? null,
      });
      result.emailSent = emailResult.success;
      if (!emailResult.success) result.errors.push(`Email: ${emailResult.error ?? "send failed"}`);
    }
  }

  await prisma.messageLog.create({
    data: {
      shopId,
      phoneNumber: recipient.phoneNumber || recipient.email || "unknown",
      templateUsed: template.name,
      status: (result.whatsappSent || result.emailSent) ? "sent" : "failed",
      providerMessageId: null,
    },
  });

  return result;
}
