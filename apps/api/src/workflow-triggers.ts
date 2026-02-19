import crypto from "node:crypto";
import { workflowDslAnySchema } from "@vespid/workflow";

export type WorkflowTriggerSubscriptionSpec =
  | {
      triggerType: "cron";
      cronExpr: string;
      enabled?: boolean;
    }
  | {
      triggerType: "heartbeat";
      heartbeatIntervalSec: number;
      heartbeatJitterSec: number;
      heartbeatMaxSkewSec: number;
      enabled?: boolean;
    }
  | {
      triggerType: "webhook";
      webhookTokenHash: string;
      enabled?: boolean;
    };

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function deriveTriggerSubscriptionsFromDsl(dsl: unknown): WorkflowTriggerSubscriptionSpec[] {
  const parsed = workflowDslAnySchema.parse(dsl);
  const trigger = parsed.trigger;
  if (trigger.type === "trigger.cron") {
    return [
      {
        triggerType: "cron",
        cronExpr: trigger.config.cron,
      },
    ];
  }
  if (trigger.type === "trigger.heartbeat") {
    return [
      {
        triggerType: "heartbeat",
        heartbeatIntervalSec: trigger.config.intervalSec,
        heartbeatJitterSec: trigger.config.jitterSec,
        heartbeatMaxSkewSec: trigger.config.maxSkewSec,
      },
    ];
  }
  if (trigger.type === "trigger.webhook") {
    return [
      {
        triggerType: "webhook",
        webhookTokenHash: sha256Hex(trigger.config.token),
      },
    ];
  }
  return [];
}
