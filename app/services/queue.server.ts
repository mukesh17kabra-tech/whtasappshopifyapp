import { Client } from "@upstash/qstash";

// QStash is a serverless message queue that works well with Vercel:
// it HTTP-POSTs the job payload to a URL you specify (here, our own
// /api/jobs/send-whatsapp route) on a retry-backed schedule, so we never
// need a long-running worker process.
const qstash = new Client({
  token: process.env.QSTASH_TOKEN!,
});

const JOB_ENDPOINT = `${process.env.SHOPIFY_APP_URL}/api/jobs/send-whatsapp`;
const FLOW_JOB_ENDPOINT = `${process.env.SHOPIFY_APP_URL}/api/jobs/process-flow-step`;

export type WhatsappJob =
  | {
      type: "order_confirmation" | "shipment_update";
      shopId: string;
      phoneNumber: string;
      orderId: string;
      orderNumber?: string;
      trackingUrl?: string;
    }
  | {
      type: "broadcast_message";
      shopId: string;
      broadcastId: string;
      phoneNumber: string;
      templateId: string;
    };

export async function queueWhatsappJob(job: WhatsappJob) {
  if (!process.env.QSTASH_TOKEN) {
    throw new Error("QSTASH_TOKEN is not set");
  }
  if (!process.env.SHOPIFY_APP_URL || !process.env.SHOPIFY_APP_URL.startsWith("http")) {
    throw new Error(`SHOPIFY_APP_URL is not set or invalid: "${process.env.SHOPIFY_APP_URL}"`);
  }

  try {
    await qstash.publishJSON({
      url: JOB_ENDPOINT,
      body: job,
      retries: 3,
    });
  } catch (err) {
    // Re-throw with the actual QStash error message attached, instead of a
    // generic failure — this is what shows up in Vercel's function logs.
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`QStash publish failed: ${detail}`);
  }
}

// Schedules (or immediately triggers, if runAt is omitted) processing of
// the next step in a FlowRun. QStash's `notBefore` holds the job until the
// given unix timestamp (seconds) — this is what makes "wait 3 days, then
// send" work without a long-running worker process.
export async function queueFlowStepJob(flowRunId: string, runAt?: Date) {
  if (!process.env.QSTASH_TOKEN) {
    throw new Error("QSTASH_TOKEN is not set");
  }
  if (!process.env.SHOPIFY_APP_URL || !process.env.SHOPIFY_APP_URL.startsWith("http")) {
    throw new Error(`SHOPIFY_APP_URL is not set or invalid: "${process.env.SHOPIFY_APP_URL}"`);
  }

  try {
    await qstash.publishJSON({
      url: FLOW_JOB_ENDPOINT,
      body: { flowRunId },
      retries: 3,
      ...(runAt ? { notBefore: Math.floor(runAt.getTime() / 1000) } : {}),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`QStash publish failed (flow step): ${detail}`);
  }
}
