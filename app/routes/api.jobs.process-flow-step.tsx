import type { ActionFunctionArgs } from "@remix-run/node";
import { Receiver } from "@upstash/qstash";
import { processFlowRunStep } from "~/services/flow-engine.server";

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
});

export async function action({ request }: ActionFunctionArgs) {
  const bodyText = await request.text();
  const signature = request.headers.get("upstash-signature");

  if (signature) {
    try {
      const valid = await receiver.verify({ signature, body: bodyText });
      if (!valid) return new Response("invalid signature", { status: 401 });
    } catch (err) {
      console.error("QStash signature verification failed (flow step)", err);
      return new Response("invalid signature", { status: 401 });
    }
  } else {
    console.warn("Missing upstash-signature header on flow-step job request");
  }

  const { flowRunId } = JSON.parse(bodyText);

  try {
    await processFlowRunStep(flowRunId);
    return new Response(null, { status: 200 });
  } catch (err) {
    console.error(`processFlowRunStep failed for ${flowRunId}:`, err);
    return new Response("flow step processing failed", { status: 500 });
  }
}
