import type { WorkflowNodeExecutor } from "@vespid/shared";

export function getCommunityWorkflowNodeExecutors(): WorkflowNodeExecutor[] {
  return [
    {
      nodeType: "http.request",
      async execute(context) {
        return {
          status: "succeeded",
          output: {
            accepted: true,
            requestId: `${context.nodeId}-request`,
          },
        };
      },
    },
    {
      nodeType: "agent.execute",
      async execute(context) {
        return {
          status: "succeeded",
          output: {
            accepted: true,
            taskId: `${context.nodeId}-task`,
          },
        };
      },
    },
    {
      nodeType: "condition",
      async execute() {
        return {
          status: "succeeded",
          output: {
            branch: "true",
          },
        };
      },
    },
    {
      nodeType: "parallel.join",
      async execute() {
        return {
          status: "succeeded",
          output: {
            joined: true,
          },
        };
      },
    },
  ];
}

