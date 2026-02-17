import { z } from "zod";
import type { AgentToolDefinition, AgentToolExecuteResult } from "./types.js";

const memorySearchArgsSchema = z.object({
  query: z.string().min(1).max(20_000),
  maxResults: z.number().int().min(1).max(50).optional(),
});

const memoryGetArgsSchema = z.object({
  path: z.string().min(1).max(400),
  fromLine: z.number().int().min(1).max(1_000_000).optional(),
  lineCount: z.number().int().min(1).max(500).optional(),
});

export const memorySearchTool: AgentToolDefinition = {
  id: "memory_search",
  description: "Search workspace memory documents (MEMORY.md and memory/*.md).",
  inputSchema: memorySearchArgsSchema,
  async execute(ctx, input): Promise<AgentToolExecuteResult> {
    const parsed = memorySearchArgsSchema.safeParse(input.args);
    if (!parsed.success) {
      return { status: "failed", error: "INVALID_TOOL_INPUT" };
    }
    if (!ctx.memory) {
      return { status: "failed", error: "MEMORY_NOT_CONFIGURED" };
    }
    try {
      const results = await ctx.memory.search({
        query: parsed.data.query,
        ...(typeof parsed.data.maxResults === "number" ? { maxResults: parsed.data.maxResults } : {}),
      });
      return {
        status: "succeeded",
        output: {
          provider: ctx.memory.status().provider,
          results,
        },
      };
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error.message : "MEMORY_SEARCH_FAILED" };
    }
  },
};

export const memoryGetTool: AgentToolDefinition = {
  id: "memory_get",
  description: "Read a memory file snippet by path and optional line range.",
  inputSchema: memoryGetArgsSchema,
  async execute(ctx, input): Promise<AgentToolExecuteResult> {
    const parsed = memoryGetArgsSchema.safeParse(input.args);
    if (!parsed.success) {
      return { status: "failed", error: "INVALID_TOOL_INPUT" };
    }
    if (!ctx.memory) {
      return { status: "failed", error: "MEMORY_NOT_CONFIGURED" };
    }
    try {
      const result = await ctx.memory.get({
        filePath: parsed.data.path,
        ...(typeof parsed.data.fromLine === "number" ? { fromLine: parsed.data.fromLine } : {}),
        ...(typeof parsed.data.lineCount === "number" ? { lineCount: parsed.data.lineCount } : {}),
      });
      return {
        status: "succeeded",
        output: {
          provider: ctx.memory.status().provider,
          result,
        },
      };
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error.message : "MEMORY_GET_FAILED" };
    }
  },
};
