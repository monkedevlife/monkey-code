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
  message: string;
  data?: unknown;
  serverIds?: string[];
  availableTools?: string[];
  error?: string;
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

async function loadSkill(
  skillPath: string,
  ctx: SkillMcpContext
): Promise<SkillMcpResult> {
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

  return {
    success: true,
    skillName: skill.name,
    action: "load",
    message: `Skill '${skill.name}' loaded successfully`,
    serverIds: serverIds.length > 0 ? serverIds : undefined,
    availableTools:
      skill.mcpServers?.map((_, i) => `${skill.name}-mcp-${i}`) || [],
  };
}

async function invokeSkillTool(
  skillName: string,
  toolName: string | undefined,
  toolParams: Record<string, unknown> | undefined,
  ctx: SkillMcpContext
): Promise<SkillMcpResult> {
  const loadedSkill = loadedSkills.get(skillName);

  if (!loadedSkill) {
    return {
      success: false,
      skillName,
      action: "invoke",
      message: `Skill '${skillName}' is not loaded`,
      error: `Skill not found. Available skills: ${Array.from(loadedSkills.keys()).join(", ") || "none"}`,
    };
  }

  if (!toolName) {
    return {
      success: false,
      skillName,
      action: "invoke",
      message: `Tool name is required for invoke action`,
      error: "Missing 'tool' parameter",
    };
  }

  if (loadedSkill.serverIds.length === 0) {
    return {
      success: false,
      skillName,
      action: "invoke",
      message: `Skill '${skillName}' has no MCP servers`,
      error: "No MCP servers available for invocation",
    };
  }

  const serverId = loadedSkill.serverIds[0];
  if (!serverId) {
    return {
      success: false,
      skillName,
      action: "invoke",
      message: `Skill '${skillName}' has no MCP servers`,
      error: "No MCP servers available for invocation",
    };
  }

  const server = ctx.manager.getClient(serverId);

  if (!server || !server.connected) {
    return {
      success: false,
      skillName,
      action: "invoke",
      message: `MCP server for skill '${skillName}' is not connected`,
      error: "Server disconnected",
    };
  }

  if (!toolName) {
    return {
      success: false,
      skillName,
      action: "invoke",
      message: `Tool name is required for invoke action`,
      error: "Missing 'tool' parameter",
    };
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
      message: `Tool '${toolName}' invoked successfully`,
      data: JSON.parse(filteredOutput),
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    return {
      success: false,
      skillName,
      action: "invoke",
      message: `Failed to invoke tool '${toolName}'`,
      error: errorMessage,
    };
  }
}

async function unloadSkill(
  skillName: string,
  ctx: SkillMcpContext
): Promise<SkillMcpResult> {
  const loadedSkill = loadedSkills.get(skillName);

  if (!loadedSkill) {
    return {
      success: false,
      skillName,
      action: "unload",
      message: `Skill '${skillName}' is not loaded`,
    };
  }

  for (const serverId of loadedSkill.serverIds) {
    await ctx.manager.stopMcp(serverId);
  }

  loadedSkills.delete(skillName);

  return {
    success: true,
    skillName,
    action: "unload",
    message: `Skill '${skillName}' unloaded successfully`,
  };
}

export async function skillMcp(
  params: SkillMcpParams,
  ctx: SkillMcpContext
): Promise<SkillMcpResult> {
  const { skill, action, tool, params: toolParams } = params;

  if (!skill || typeof skill !== "string") {
    return {
      success: false,
      skillName: "unknown",
      action: action || "load",
      message: "Skill parameter is required",
      error: "Missing 'skill' parameter",
    };
  }

  const validActions: SkillMcpAction[] = ["load", "invoke", "unload"];
  if (!validActions.includes(action)) {
    return {
      success: false,
      skillName: skill,
      action: action || "load",
      message: `Invalid action: ${action}`,
      error: `Action must be one of: ${validActions.join(", ")}`,
    };
  }

  try {
    switch (action) {
      case "load": {
        const skillPath = resolveSkillPath(skill, ctx.skillPaths);
        if (!skillPath) {
          return {
            success: false,
            skillName: skill,
            action: "load",
            message: `Skill not found: ${skill}`,
            error: `Could not resolve skill path. Tried: ${skill}, ${skill}.md, ${skill}/SKILL.md`,
          };
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
    return {
      success: false,
      skillName: skill,
      action,
      message: `Error processing skill-mcp action`,
      error: errorMessage,
    };
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
