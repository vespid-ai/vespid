import type { GatewayDispatchRequest, GatewayDispatchResponse, GatewayInvokeToolV2, GatewayToolEventV2, GatewayToolResultV2 } from "@vespid/shared";

export type EdgeToBrainRequest =
  | {
      type: "workflow_dispatch";
      requestId: string;
      // Mirrors GatewayDispatchRequest metadata so brain can push continuation jobs.
      dispatch: GatewayDispatchRequest;
      async: boolean;
    }
  | {
      type: "session_send";
      requestId: string;
      organizationId: string;
      userId: string;
      sessionId: string;
      // The persisted seq for the user_message event (used for idempotency/debugging).
      userEventSeq: number;
    }
  | {
      type: "executor_result";
      executorId: string;
      result: GatewayToolResultV2;
    }
  | {
      type: "executor_event";
      executorId: string;
      event: GatewayToolEventV2;
    };

export type BrainToEdgeCommand =
  | {
      type: "executor_invoke";
      executorId: string;
      invoke: GatewayInvokeToolV2;
    }
  | {
      type: "client_broadcast";
      sessionId: string;
      // Keep loosely typed so edge can forward legacy session_event messages during cutover.
      event: unknown;
    }
  | {
      type: "workflow_reply";
      requestId: string;
      response: GatewayDispatchResponse;
    };
