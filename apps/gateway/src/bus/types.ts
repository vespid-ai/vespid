import type {
  ChannelSessionSource,
  GatewayBrainSessionEventV2,
  GatewayDispatchRequest,
  GatewayDispatchResponse,
  GatewayInvokeToolV2,
  GatewayToolEventV2,
  GatewayToolResultV2,
} from "@vespid/shared";

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
      originEdgeId?: string;
      source?: ChannelSessionSource;
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
      event: GatewayBrainSessionEventV2;
    }
  | {
      type: "workflow_reply";
      requestId: string;
      response: GatewayDispatchResponse;
    }
  | {
      type: "channel_outbound";
      organizationId: string;
      sessionId: string;
      sessionEventSeq: number;
      source: ChannelSessionSource;
      text: string;
    };
