import { join, isAbsolute } from "path";
import { existsSync, statSync } from "fs";
import type { SkillMcpManager } from "../managers/SkillMcpManager.js";
import type { SkillDefinition } from "../types/index.js";

export type SkillMcpAction = "load" | "invoke" | "unload";

export interface SkillMcpParams {
  skill: string;
  action: SkillMcpAction;
  tool?: string;
  params?: Record<string, unknown>;
}

export interface LoadedSkillState {
  definition: SkillDefinition;
  serverIds: string[];
  loadedAt: number;
}

export interface SkillMcpResult {
  success: boolean;
  skillName: string;
  action: SkillMcpAction;
  summary: string;
  data?: unknown;
  serverIds?: string[];
  availableTools?: string[];
  error?: string;
  executionTimeMs: number;
  nextActions: Array<{
    action: string;
    description: string;
    tool: string;
    params: Record<string, string>;
  }>;
}

export interface SkillMcpContext {
  manager: SkillMcpManager;
  skillPaths?: string[];
}

const loadedSkills = new Map<string, LoadedSkillState>();

function resolveSkillPath(
  skillNameOrPath: string,
  skillPaths: string[] = []
): string | null {
  if (isAbsolute(skillNameOrPath)) {
    if (existsSync(skillNameOrPath)) {
      return skillNameOrPath;
    }
    const withMd = `${skillNameOrPath}.md`;
    if (existsSync(withMd)) {
      return withMd;
    }
    return null;
  }

  const searchPaths = [
    ...skillPaths,
    join(process.cwd(), ".opencode", "skills"),
    join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".config",
      "opencode",
      "skills"
    ),
  ];

  for (const basePath of searchPaths) {
    const possibilities = [
      join(basePath, skillNameOrPath),
      join(basePath, `${skillNameOrPath}.md`),
      join(basePath, skillNameOrPath, "SKILL.md"),
    ];

    for (const path of possibilities) {
      if (existsSync(path) && statSync(path).isFile()) {
        return path;
      }
    }
  }

  return null;
}

function applyGrepFilter(
  output: string,
  pattern: string | undefined
): string {
  if (!pattern) return output;
  try {
    const regex = new RegExp(pattern, "i");
    const lines = output.split("\n");
    const filtered = lines.filter((line) => regex.test(line));
    return filtered.length > 0
      ? filtered.join("\n")
      : `[grep] No lines matched pattern: ${pattern}`;
  } catch {
    return output;
  }
}

function makeErrorResult(
  skillName: string,
  action: SkillMcpAction,
  summary: string,
  error: string,
  extra?: Partial<SkillMcpResult>
): SkillMcpResult {
  const availableSkills = Array.from(loadedSkills.keys());
  return {
    success: false,
    skillName,
    action,
    summary,
    error,
    executionTimeMs: 0,
    nextActions: availableSkills.length > 0
      ? [
          {
            action: "load-existing",
            description: `Load an available skill: ${availableSkills.join(", ")}`,
            tool: "skill-mcp",
            params: { skill: availableSkills[0] || "", action: "load" },
          },
        ]
      : [
          {
            action: "load",
            description: "Load a skill by name or path",
            tool: "skill-mcp",
            params: { skill: "<skill-name>", action: "load" },
          },
        ],
    ...extra,
  };
}

async function loadSkill(
  skillPath: string,
  ctx: SkillMcpContext
): Promise<SkillMcpResult> {
  const start = Date.now();
  const skill = await ctx.manager.loadSkill(skillPath);
  const serverIds: string[] = [];

  if (skill.mcpServers && skill.mcpServers.length > 0) {
    for (const mcpConfig of skill.mcpServers) {
      const serverId = await ctx.manager.startMcp(mcpConfig);
      serverIds.push(serverId);
    }
  }

  loadedSkills.set(skill.name, {
    definition: skill,
    serverIds,
    loadedAt: Date.now(),
  });

  const availableTools = skill.mcpServers?.map((_, i) => `${skill.name}-mcp-${i}`) || [];

  return {
    success: true,
    skillName: skill.name,
    action: "load",
    summary: `Skill '${skill.name}' loaded`,
    serverIds: serverIds.length > 0 ? serverIds : undefined,
    availableTools: availableTools.length > 0 ? availableTools : undefined,
    executionTimeMs: Date.now() - start,
    nextActions: [
      {
        action: "invoke",
        description: `Invoke a tool from ${skill.name}`,
        tool: "skill-mcp",
        params: { skill: skill.name, action: "invoke", tool: "<tool-name>" },
      },
      {
        action: "unload",
        description: `Unload ${skill.name}`,
        tool: "skill-mcp",
        params: { skill: skill.name, action: "unload" },
      },
    ],
  };
}

async function invokeSkillTool(
  skillName: string,
  toolName: string | undefined,
  toolParams: Record<string, unknown> | undefined,
  ctx: SkillMcpContext
): Promise<SkillMcpResult> {
  const start = Date.now();
  const loadedSkill = loadedSkills.get(skillName);

  if (!loadedSkill) {
    return makeErrorResult(
      skillName,
      "invoke",
      `Skill '${skillName}' not loaded`,
      `Skill not found. Available skills: ${Array.from(loadedSkills.keys()).join(", ") || "none"}`
    );
  }

  if (!toolName) {
    return makeErrorResult(
      skillName,
      "invoke",
      "Tool name is required",
      "Missing 'tool' parameter"
    );
  }

  if (loadedSkill.serverIds.length === 0) {
    return makeErrorResult(
      skillName,
      "invoke",
      `Skill '${skillName}' has no MCP servers`,
      "No MCP servers available for invocation"
    );
  }

  const serverId = loadedSkill.serverIds[0];
  if (!serverId) {
    return makeErrorResult(
      skillName,
      "invoke",
      `Skill '${skillName}' has no MCP servers`,
      "No MCP servers available for invocation"
    );
  }

  const server = ctx.manager.getClient(serverId);

  if (!server || !server.connected) {
    return makeErrorResult(
      skillName,
      "invoke",
      `MCP server for '${skillName}' is not connected`,
      "Server disconnected"
    );
  }

  try {
    const result = await ctx.manager.sendJsonRpc(
      serverId,
      "tools/call",
      {
        name: toolName,
        arguments: toolParams || {},
      }
    );

    const output = JSON.stringify(result, null, 2);
    const grepPattern =
      toolParams && typeof toolParams === "object" && "grep" in toolParams
        ? String(toolParams.grep)
        : undefined;
    const filteredOutput = applyGrepFilter(output, grepPattern);

    return {
      success: true,
      skillName,
      action: "invoke",
      summary: `Tool '${toolName}' invoked`,
      data: JSON.parse(filteredOutput),
      executionTimeMs: Date.now() - start,
      nextActions: [
        {
          action: "invoke-again",
          description: `Invoke another tool from ${skillName}`,
          tool: "skill-mcp",
          params: { skill: skillName, action: "invoke", tool: "<tool-name>" },
        },
        {
          action: "unload",
          description: `Unload ${skillName}`,
          tool: "skill-mcp",
          params: { skill: skillName, action: "unload" },
        },
      ],
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    return makeErrorResult(
      skillName,
      "invoke",
      `Failed to invoke tool '${toolName}'`,
      errorMessage
    );
  }
}

async function unloadSkill(
  skillName: string,
  ctx: SkillMcpContext
): Promise<SkillMcpResult> {
  const start = Date.now();
  const loadedSkill = loadedSkills.get(skillName);

  if (!loadedSkill) {
    return makeErrorResult(
      skillName,
      "unload",
      `Skill '${skillName}' not loaded`,
      `Skill not found. Available skills: ${Array.from(loadedSkills.keys()).join(", ") || "none"}`
    );
  }

  for (const serverId of loadedSkill.serverIds) {
    await ctx.manager.stopMcp(serverId);
  }

  loadedSkills.delete(skillName);

  return {
    success: true,
    skillName,
    action: "unload",
    summary: `Skill '${skillName}' unloaded`,
    executionTimeMs: Date.now() - start,
    nextActions: [
      {
        action: "load",
        description: "Load a skill",
        tool: "skill-mcp",
        params: { skill: "<skill-name>", action: "load" },
      },
    ],
  };
}

export async function skillMcp(
  params: SkillMcpParams,
  ctx: SkillMcpContext
): Promise<SkillMcpResult> {
  const { skill, action, tool, params: toolParams } = params;

  if (!skill || typeof skill !== "string") {
    return makeErrorResult(
      "unknown",
      action || "load",
      "Skill parameter is required",
      "Missing 'skill' parameter"
    );
  }

  const validActions: SkillMcpAction[] = ["load", "invoke", "unload"];
  if (!validActions.includes(action)) {
    return makeErrorResult(
      skill,
      action || "load",
      `Invalid action: ${action}`,
      `Action must be one of: ${validActions.join(", ")}`
    );
  }

  try {
    switch (action) {
      case "load": {
        const skillPath = resolveSkillPath(skill, ctx.skillPaths);
        if (!skillPath) {
          return makeErrorResult(
            skill,
            "load",
            `Skill not found: ${skill}`,
            `Could not resolve skill path. Tried: ${skill}, ${skill}.md, ${skill}/SKILL.md`
          );
        }
        return await loadSkill(skillPath, ctx);
      }

      case "invoke":
        return await invokeSkillTool(skill, tool, toolParams, ctx);

      case "unload":
        return await unloadSkill(skill, ctx);
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    return makeErrorResult(
      skill,
      action,
      `Error processing skill-mcp action`,
      errorMessage
    );
  }
}

export function getLoadedSkillNames(): string[] {
  return Array.from(loadedSkills.keys());
}

export function getLoadedSkillState(skillName: string): LoadedSkillState | undefined {
  return loadedSkills.get(skillName);
}

export async function cleanupAllSkills(
  manager: SkillMcpManager
): Promise<void> {
  for (const [skillName, state] of loadedSkills) {
    for (const serverId of state.serverIds) {
      try {
        await manager.stopMcp(serverId);
      } catch {
      }
    }
    loadedSkills.delete(skillName);
  }
}

export const skillMcpSchema = {
  type: "object" as const,
  properties: {
    skill: {
      type: "string" as const,
      description: "Skill name or path to SKILL.md file",
    },
    action: {
      type: "string" as const,
      enum: ["load", "invoke", "unload"] as const,
      description: "Action to perform: load, invoke, or unload",
    },
    tool: {
      type: "string" as const,
      description: "Tool name for invoke action (optional)",
    },
    params: {
      type: "object" as const,
      description: "Parameters for invoke action (optional)",
    },
  },
  required: ["skill", "action"] as const,
};

export type SkillMcpSchema = typeof skillMcpSchema;
