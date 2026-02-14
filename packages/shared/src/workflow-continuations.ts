import type { GatewayDispatchResponse } from "./types.js";

export type WorkflowContinuationJobPayload =
  | {
      type: "remote.poll";
      organizationId: string;
      workflowId: string;
      runId: string;
      requestId: string;
      attemptCount: number;
    }
  | {
      type: "remote.apply";
      organizationId: string;
      workflowId: string;
      runId: string;
      requestId: string;
      attemptCount: number;
      result: GatewayDispatchResponse;
    };

