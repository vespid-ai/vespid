import type { ToolsetCatalogItem } from "@vespid/shared";

export function getToolsetCatalog(): ToolsetCatalogItem[] {
  return [
    {
      key: "mcp.github",
      kind: "mcp",
      name: "GitHub MCP",
      description: "Access GitHub APIs for issues, PRs, and code review workflows.",
      requiredEnv: ["GITHUB_TOKEN"],
      mcp: {
        name: "github",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "${ENV:GITHUB_TOKEN}" },
        enabled: true,
        description: "MCP server for GitHub (requires a personal access token).",
      },
    },
    {
      key: "mcp.slack",
      kind: "mcp",
      name: "Slack MCP",
      description: "Send messages, manage channels, and triage alerts in Slack.",
      requiredEnv: ["SLACK_BOT_TOKEN"],
      mcp: {
        name: "slack",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-slack"],
        env: { SLACK_BOT_TOKEN: "${ENV:SLACK_BOT_TOKEN}" },
        enabled: true,
        description: "MCP server for Slack (requires a bot token).",
      },
    },
    {
      key: "mcp.linear",
      kind: "mcp",
      name: "Linear MCP",
      description: "Create and manage Linear issues as part of agent automation.",
      requiredEnv: ["LINEAR_API_KEY"],
      mcp: {
        name: "linear",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-linear"],
        env: { LINEAR_API_KEY: "${ENV:LINEAR_API_KEY}" },
        enabled: true,
        description: "MCP server for Linear (requires an API key).",
      },
    },
    {
      key: "mcp.postgres",
      kind: "mcp",
      name: "Postgres MCP",
      description: "Query and inspect a Postgres database during analysis or automation.",
      requiredEnv: ["POSTGRES_CONNECTION_STRING"],
      mcp: {
        name: "postgres",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-postgres"],
        env: { POSTGRES_CONNECTION_STRING: "${ENV:POSTGRES_CONNECTION_STRING}" },
        enabled: true,
        description: "MCP server for Postgres (requires a connection string).",
      },
    },
    {
      key: "mcp.http-generic",
      kind: "mcp",
      name: "HTTP MCP (Generic)",
      description: "Connect to a remote MCP server over HTTP (edit URL after generation).",
      requiredEnv: ["API_AUTH_HEADER"],
      mcp: {
        name: "http-generic",
        transport: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "${ENV:API_AUTH_HEADER}" },
        enabled: true,
        description: "Generic HTTP MCP server template.",
      },
    },
    {
      key: "skill.usage-guide",
      kind: "skill",
      name: "Toolset Usage Guide",
      description: "Generate a SKILL.md that explains required env vars and usage constraints for the selected tools.",
      skillTemplate: {
        idHint: "toolset-usage-guide",
      },
    },
    {
      key: "skill.github-triage",
      kind: "skill",
      name: "GitHub Triage",
      description: "Generate a SKILL.md for triaging issues/PRs using GitHub MCP tools.",
      skillTemplate: {
        idHint: "github-triage",
      },
    },
    {
      key: "skill.slack-ops",
      kind: "skill",
      name: "Slack Ops Assistant",
      description: "Generate a SKILL.md for operational workflows in Slack using Slack MCP tools.",
      skillTemplate: {
        idHint: "slack-ops-assistant",
      },
    },
  ];
}

