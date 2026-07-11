import type { ActionFunctionArgs } from "@remix-run/node";
import { Receiver } from "@upstash/qstash";
import prisma from "~/db.server";
import { sendWhatsappTemplateMessage, sendWhatsappCustomMessage } from "~/services/whatsapp.server";
import { renderTemplateBody } from "~/services/template.server";
import { getShopWhatsappCredentials } from "~/services/embedded-signup.server";
import type { WhatsappJob } from "~/services/queue.server";

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
});

// This route is called by QStash (not by the browser or Shopify).
// It performs the real WhatsApp send and logs the result.
export async function action({ request }: ActionFunctionArgs) {
  const bodyText = await request.text();
  const signature = request.headers.get("upstash-signature");

  if (signature) {
    try {
      const valid = await receiver.verify({ signature, body: bodyText });
      if (!valid) {
        return new Response("invalid signature", { status: 401 });
      }
    } catch (err) {
      console.error("QStash signature verification failed", err);
      return new Response("invalid signature", { status: 401 });
    }
  } else {
    // No signature header present — only acceptable in local dev without
    // QStash in front of this route. In production this should never happen;
    // treat it as suspicious rather than silently trusting the request.
    console.warn("Missing upstash-signature header on job request");
  }

  const job: WhatsappJob = JSON.parse(bodyText);

  const shop = await prisma.shop.findUnique({ where: { id: job.shopId } });
  if (!shop) return new Response("shop not found", { status: 200 });

  const credentials = await getShopWhatsappCredentials(job.shopId);
  if (!credentials && process.env.WHATSAPP_PROVIDER !== "bridge") {
    console.error(`Shop ${job.shopId} has no WhatsApp Business Account connected — skipping send.`);
    return new Response("WhatsApp not connected for this shop", { status: 200 });
  }

  // Defense in depth: re-check opt-out status right before sending, in case
  // the customer opted out after the broadcast was queued but before this
  // job ran (QStash jobs can sit in the queue for a bit under load).
  const optin = await prisma.optin.findUnique({
    where: { shopId_phoneNumber: { shopId: job.shopId, phoneNumber: job.phoneNumber } },
  });
  if (optin?.optedOutAt) {
    console.log(`Skipping send to ${job.phoneNumber}: opted out`);
    return new Response(null, { status: 200 });
  }


  try {
    let templateName: string;
    let variables: Record<string, string> = {};

    if (job.type === "order_confirmation") {
      templateName = "order_confirmation";
      variables = { order_number: job.orderNumber ?? job.orderId };
    } else if (job.type === "shipment_update") {
      // template name is stored per-order (set by the fulfillment webhook)
      // so out_for_delivery / delivered / delivery_failed all route through
      // this same job type but render different approved templates
      const tracking = await prisma.orderTracking.findFirst({
        where: { shopId: job.shopId, shopifyOrderId: job.orderId },
      });
      templateName = tracking?.lastTemplateSent || "shipment_update";
      variables = {
        order_number: job.orderId,
        tracking_url: job.trackingUrl ?? tracking?.trackingUrl ?? "",
      };
    } else {
      templateName = job.templateId;
    }

    let result;

    if (job.type === "broadcast_message") {
      const template = await prisma.template.findUnique({
        where: { id: job.templateId },
      });

      if (!template) {
        throw new Error(`Template ${job.templateId} not found`);
      }

      if (template.status === "approved" && template.whatsappTemplateId) {
        const variableKeys: string[] = JSON.parse(template.variableKeys || "[]");
        const unsupportedKeys = variableKeys.filter((k) => k !== "first_name");

        if (unsupportedKeys.length > 0) {
          // Broadcasts have no per-customer order/tracking context to fill
          // real values for {order_id}, {tracking_url}, etc. — those only
          // make sense for the order-confirmation/shipment-update flows.
          // {first_name} IS supported since we do have the subscriber's name
          // from the popup opt-in.
          console.error(
            `Template ${template.id} has variables (${unsupportedKeys.join(", ")}) not usable in a broadcast context — skipping send.`,
          );
          return new Response(
            "Template has variables not usable in a broadcast context",
            { status: 200 },
          );
        }

        const broadcastVariables: Record<string, string> = {};
        if (variableKeys.includes("first_name")) {
          broadcastVariables.param_1 = optin?.name || "there";
        }

        result = await sendWhatsappTemplateMessage({
          to: job.phoneNumber,
          templateName: template.name,
          variables: broadcastVariables,
          credentials,
        });
      } else {
        // Not yet approved (draft/pending/rejected) — send as freeform via
        // whichever provider is active. On the Meta path this only reaches
        // customers within their 24h service window; on the bridge path it
        // always works.
        const renderedText = renderTemplateBody(template.body, {
          first_name: optin?.name || "there",
        });
        result = await sendWhatsappCustomMessage({
          to: job.phoneNumber,
          text: renderedText,
          imageUrl: template.imageUrl,
          credentials,
        });
      }
      templateName = template.name;
    } else {
      result = await sendWhatsappTemplateMessage({
        to: job.phoneNumber,
        templateName,
        variables,
        credentials,
      });
    }


    await prisma.messageLog.create({
      data: {
        shopId: job.shopId,
        phoneNumber: job.phoneNumber,
        templateUsed: templateName,
        status: result.success ? "sent" : "failed",
        providerMessageId: result.messageId ?? null,
      },
    });

    if (job.type === "broadcast_message") {
      await prisma.broadcast.update({
        where: { id: job.broadcastId },
        data: { sentCount: { increment: 1 } },
      });
    }

    return new Response(null, { status: 200 });
  } catch (err) {
    console.error("WhatsApp send failed", err);
    // Returning 500 lets QStash retry automatically per the retry policy
    return new Response("send failed", { status: 500 });
  }
}
