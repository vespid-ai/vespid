export const enterpriseProvider = {
  edition: "enterprise",
  name: "fixture-enterprise-provider",
  version: "0.0.0-test",
  getCapabilities() {
    return [];
  },
  getEnterpriseConnectors() {
    return [];
  },
  getWorkflowNodeExecutors() {
    return [
      {
        nodeType: "agent.execute",
        async execute(context) {
          return {
            status: "succeeded",
            output: {
              accepted: true,
              taskId: `${context.nodeId}-enterprise-task`,
            },
          };
        },
      },
    ];
  },
};

export default enterpriseProvider;

