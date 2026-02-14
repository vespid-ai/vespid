import { Queue, type ConnectionOptions } from "bullmq";
import type { WorkflowRunJobPayload } from "@vespid/shared";

export function createWorkflowRunQueue(input: { queueName: string; connection: ConnectionOptions }) {
  const queue = new Queue<WorkflowRunJobPayload, unknown, "workflow-run">(input.queueName, {
    connection: input.connection,
    defaultJobOptions: {
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  });

  async function enqueue(input: { payload: WorkflowRunJobPayload; delayMs?: number }) {
    // The run jobId is the runId. A prior completed job may still exist due to retention,
    // so remove it best-effort before re-enqueue.
    try {
      await queue.remove(input.payload.runId);
    } catch {
      // ignore
    }

    await queue.add("workflow-run", input.payload, {
      jobId: input.payload.runId,
      delay: input.delayMs ?? 0,
      attempts: 1,
    });
  }

  return {
    queue,
    enqueue,
    async close() {
      await queue.close();
    },
  };
}

