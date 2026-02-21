import type {
  ChannelSessionSource,
  ExecutionMode,
  GatewayBrainSessionEventV2,
  GatewayDispatchRequest,
  GatewayDispatchResponse,
  GatewayInvokeToolV2,
  GatewayMemoryQueryV2,
  GatewayMemorySyncV2,
  GatewaySessionCancelV2,
  GatewaySessionOpenV2,
  GatewaySessionTurnV2,
  GatewayToolEventV2,
  GatewayToolResultV2,
  MemoryProvider,
  RemoteExecutionEvent,
  SessionAttachmentV2,
  SessionScope,
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
      message?: string;
      attachments?: SessionAttachmentV2[];
      idempotencyKey?: string;
      originEdgeId?: string;
      source?: ChannelSessionSource;
    }
  | {
      type: "session_turn_event";
      requestId: string;
      organizationId: string;
      sessionId: string;
      event: RemoteExecutionEvent;
      originEdgeId?: string;
    }
  | {
      type: "session_reset";
      requestId: string;
      organizationId: string;
      userId: string;
      sessionId: string;
      mode: "keep_history" | "clear_history";
      originEdgeId?: string;
    }
  | {
      type: "session_cancel";
      requestId: string;
      organizationId: string;
      userId: string;
      sessionId: string;
      originEdgeId?: string;
    }
  | {
      type: "memory_sync";
      requestId: string;
      organizationId: string;
      userId: string;
      sessionId: string;
      sessionKey: string;
      provider: MemoryProvider;
      workspaceDir: string;
    }
  | {
      type: "memory_query";
      requestId: string;
      organizationId: string;
      userId: string;
      sessionId: string;
      sessionKey: string;
      provider: MemoryProvider;
      query: string;
      limit?: number;
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
      type: "executor_session";
      executorId: string;
      payload:
        | GatewaySessionOpenV2
        | GatewaySessionTurnV2
        | GatewaySessionCancelV2
        | GatewayMemorySyncV2
        | GatewayMemoryQueryV2;
    }
  | {
      type: "client_broadcast";
      sessionId: string;
      event: GatewayBrainSessionEventV2;
    }
  | {
      type: "session_state";
      sessionId: string;
      pinnedExecutorId: string | null;
      pinnedExecutorPool: "managed" | "byon" | null;
      pinnedAgentId: string | null;
      routedAgentId: string | null;
      scope: SessionScope;
      executionMode: ExecutionMode;
    }
  | {
      type: "session_error";
      sessionId: string;
      code: string;
      message: string;
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
