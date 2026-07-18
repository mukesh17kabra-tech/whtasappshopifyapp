import prisma from "~/db.server";
import { queueFlowStepJob } from "./queue.server";
import { sendTemplateToSubscriber } from "./template-sender.server";

// Advances a FlowRun forward through its steps:
// - A DELAY step schedules the next check via QStash and stops here.
// - A SEND_MESSAGE step sends immediately, then keeps going to the next
//   step in the same pass (so consecutive sends with no delay between them
//   happen right away, matching how Klaviyo-style flows behave).
// - Running out of steps marks the FlowRun completed.
export async function processFlowRunStep(flowRunId: string): Promise<void> {
  const run = await prisma.flowRun.findUnique({
    where: { id: flowRunId },
    include: { flow: { include: { steps: { orderBy: { position: "asc" } } } } },
  });

  if (!run || run.status !== "active") return;

  let stepIndex = run.currentStep;
  const steps = run.flow.steps;

  while (stepIndex < steps.length) {
    const step = steps[stepIndex];

    if (step.type === "DELAY") {
      let nextRunAt: Date;
      if (step.sendDate) {
        nextRunAt = step.sendDate;
        // If the date's already in the past (e.g. flow was turned on late),
        // just move on right away rather than scheduling a job in the past.
        if (nextRunAt.getTime() <= Date.now()) {
          stepIndex += 1;
          continue;
        }
      } else {
        const days = step.delayDays ?? 0;
        const hours = step.delayHours ?? 0;
        const minutes = step.delayMinutes ?? 0;
        const totalMs = (days * 24 * 60 * 60 + hours * 60 * 60 + minutes * 60) * 1000;
        // If somehow all three are 0 (shouldn't normally happen from the
        // UI), fall back to 1 day rather than scheduling an instant/past job.
        nextRunAt = new Date(Date.now() + (totalMs > 0 ? totalMs : 24 * 60 * 60 * 1000));
      }
      await prisma.flowRun.update({
        where: { id: flowRunId },
        data: { currentStep: stepIndex + 1, nextRunAt },
      });
      await queueFlowStepJob(flowRunId, nextRunAt);
      return; // stop here — QStash will call us again after the delay
    }

    if (step.type === "SEND_MESSAGE") {
      if (step.templateId) {
        const template = await prisma.template.findUnique({ where: { id: step.templateId } });
        if (template) {
          await sendTemplateToSubscriber(
            run.shopId,
            template,
            { phoneNumber: run.phoneNumber, email: run.email, name: run.customerName },
          );
        } else {
          console.error(`FlowRun ${flowRunId}: template ${step.templateId} not found, skipping step`);
        }
      }
      stepIndex += 1;
      continue; // move straight to the next step, no delay
    }

    console.error(`FlowRun ${flowRunId}: unknown step type "${step.type}" at position ${stepIndex}, skipping`);
    stepIndex += 1;
  }

  await prisma.flowRun.update({
    where: { id: flowRunId },
    data: { currentStep: stepIndex, status: "completed" },
  });
}

// Starts a new FlowRun for a trigger event (e.g. an order being placed) and
// immediately processes forward until the first delay or completion.
export async function startFlowRun(params: {
  flowId: string;
  shopId: string;
  phoneNumber?: string | null;
  email?: string | null;
  customerName?: string | null;
  orderId?: string | null;
}): Promise<string> {
  const run = await prisma.flowRun.create({
    data: {
      flowId: params.flowId,
      shopId: params.shopId,
      phoneNumber: params.phoneNumber ?? null,
      email: params.email ?? null,
      customerName: params.customerName ?? null,
      orderId: params.orderId ?? null,
      currentStep: 0,
      status: "active",
    },
  });
  await processFlowRunStep(run.id);
  return run.id;
}
