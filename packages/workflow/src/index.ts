import { z } from "zod";

export const workflowTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("trigger.manual") }),
  z.object({ type: z.literal("trigger.webhook"), config: z.object({ token: z.string().min(1) }) }),
  z.object({ type: z.literal("trigger.cron"), config: z.object({ cron: z.string().min(1) }) }),
]);

export const workflowNodeSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().min(1), type: z.literal("http.request") }),
  z.object({ id: z.string().min(1), type: z.literal("agent.execute") }),
  z.object({ id: z.string().min(1), type: z.literal("condition") }),
  z.object({ id: z.string().min(1), type: z.literal("parallel.join") }),
]);

export const workflowDslSchema = z.object({
  version: z.literal("v2"),
  trigger: workflowTriggerSchema,
  nodes: z.array(workflowNodeSchema).min(1),
});

export type WorkflowDsl = z.infer<typeof workflowDslSchema>;
