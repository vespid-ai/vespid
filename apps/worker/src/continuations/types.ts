export type WorkflowContinuationJobPayload =
  | {
      type: "remote.poll";
      organizationId: string;
      workflowId: string;
      runId: string;
      requestId: string;
      attemptCount: number;
    };

