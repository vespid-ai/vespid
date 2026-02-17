import {
  runAgentLoop as runtimeRunAgentLoop,
  type AgentLoopConfig as RuntimeAgentLoopConfig,
  type AgentLoopInput as RuntimeAgentLoopInput,
  type AgentTeamMeta,
} from "@vespid/agent-runtime/agent-loop";
import type { LlmProviderId } from "@vespid/shared";

type RuntimeProvider = RuntimeAgentLoopConfig["llm"]["provider"];

function normalizeLlmProvider(provider: LlmProviderId | RuntimeProvider): RuntimeProvider {
  if (provider === "openai" || provider === "anthropic" || provider === "gemini" || provider === "vertex") {
    return provider;
  }
  if (provider === "google" || provider === "google-antigravity" || provider === "google-gemini-cli") {
    return "gemini";
  }
  if (provider === "google-vertex") {
    return "vertex";
  }
  return "openai";
}

function toLegacyCreditProvider(provider: RuntimeProvider): LlmProviderId {
  if (provider === "openai") return "openai";
  if (provider === "anthropic") return "anthropic";
  if (provider === "vertex") return "google-vertex";
  return "google";
}

export type AgentLoopConfig = Omit<RuntimeAgentLoopConfig, "llm"> & {
  llm: Omit<RuntimeAgentLoopConfig["llm"], "provider"> & {
    provider: LlmProviderId | RuntimeProvider;
  };
};

export type AgentLoopInput = Omit<RuntimeAgentLoopInput, "config" | "managedCredits"> & {
  config: AgentLoopConfig;
  managedCredits?: {
    ensureAvailable: (input: { minCredits: number }) => Promise<boolean>;
    charge: (input: {
      credits: number;
      inputTokens: number;
      outputTokens: number;
      provider: LlmProviderId;
      model: string;
      turn: number;
    }) => Promise<void>;
  } | null;
};

export type { AgentTeamMeta };

export async function runAgentLoop(input: AgentLoopInput) {
  const runtimeInput: RuntimeAgentLoopInput = {
    ...(input as unknown as RuntimeAgentLoopInput),
    config: {
      ...input.config,
      llm: {
        ...input.config.llm,
        provider: normalizeLlmProvider(input.config.llm.provider),
      },
    },
    managedCredits: input.managedCredits
      ? {
          ensureAvailable: input.managedCredits.ensureAvailable,
          charge: async (chargeInput) => {
            await input.managedCredits!.charge({
              ...chargeInput,
              provider: toLegacyCreditProvider(chargeInput.provider),
            });
          },
        }
      : null,
  };

  return await runtimeRunAgentLoop(runtimeInput);
}
