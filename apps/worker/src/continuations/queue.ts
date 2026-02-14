import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import type { WorkflowContinuationJobPayload } from "./types.js";

export function createContinuationQueue(input: { queueName: string; connection: ConnectionOptions }) {
  const queue = new Queue<WorkflowContinuationJobPayload>(input.queueName, { connection: input.connection });
  return {
    queue,
    async close() {
      await queue.close();
    },
  };
}

