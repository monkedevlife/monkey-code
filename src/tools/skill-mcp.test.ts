import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import yaml from "js-yaml";
import {
  skillMcp,
  getLoadedSkillNames,
  getLoadedSkillState,
  cleanupAllSkills,
  skillMcpSchema,
  type SkillMcpParams,
  type SkillMcpContext,
  type LoadedSkillState,
} from "./skill-mcp.js";
import {
  SkillMcpManager,
  createSkillMcpManager,
} from "../managers/SkillMcpManager.js";
import type { McpServerConfig, SkillDefinition } from "../types/index.js";

function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n?---\r?\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { data: {}, body: content };
  }

  const yamlContent = match[1] ?? "";
  const body = match[2] ?? "";

  try {
    const parsed = yaml.load(yamlContent, { schema: yaml.JSON_SCHEMA });
    const data = (parsed ?? {}) as Record<string, unknown>;
    return { data, body };
  } catch {
    return { data: {}, body };
  }
}

function createMockSkillMcpManager(): SkillMcpManager {
  const servers = new Map<string, { connected: boolean; config: unknown }>();
  let serverCounter = 0;

  return {
    loadSkill: async (skillPath: string): Promise<SkillDefinition> => {
      const content = readFileSync(skillPath, "utf-8");
      const { data, body } = parseFrontmatter(content);
      const skillDir = dirname(skillPath);
      const skillName = String(data.name || "") || skillPath.split("/").pop()?.replace(/\.md$/, "") || "unknown";

      let mcpServers: McpServerConfig[] | undefined;
      if (data.mcp_servers && Array.isArray(data.mcp_servers)) {
        mcpServers = data.mcp_servers.map((mcp: Record<string, unknown>) => {
          const config: McpServerConfig = {
            type: "stdio",
            command: String(mcp.command || ""),
          };
          if (Array.isArray(mcp.args)) {
            config.args = mcp.args.map(String);
          }
          if (mcp.env && typeof mcp.env === "object") {
            config.env = mcp.env as Record<string, string>;
          }
          return config;
        });
      }

      return {
        name: skillName,
        description: data.description ? String(data.description) : undefined,
        mcpServers,
        content: body.trim(),
        path: skillPath,
        skillDir,
      };
    },
    startMcp: async (config: McpServerConfig) => {
      serverCounter++;
      const serverId = `mcp-${serverCounter}`;
      servers.set(serverId, { connected: true, config });
      return serverId;
    },
    stopMcp: async (serverId: string) => {
      servers.delete(serverId);
    },
    getClient: (serverId: string) => {
      const server = servers.get(serverId);
      if (!server) return undefined;
      return {
        id: serverId,
        config: server.config,
        connected: server.connected,
        startedAt: Date.now(),
        lastUsedAt: Date.now(),
      };
    },
    sendJsonRpc: async (_serverId: string, method: string, params?: unknown) => {
      return { sent: true, method, params };
    },
    getServerCount: () => servers.size,
    getAllServers: () => Array.from(servers.entries()).map(([id, s]) => ({ id, ...s })),
    cleanup: async () => {
      servers.clear();
    },
    initializeBuiltinMcps: async () => {},
    getServersBySession: () => [],
    stopSessionMcps: async () => {},
    isRunning: (serverId: string) => servers.has(serverId),
    isConnected: (serverId: string) => servers.get(serverId)?.connected ?? false,
  } as unknown as SkillMcpManager;
}

describe("skill-mcp", () => {
  let manager: SkillMcpManager;
  let ctx: SkillMcpContext;
  let tempDir: string;

  beforeEach(() => {
    manager = createMockSkillMcpManager();
    tempDir = mkdtempSync(join(tmpdir(), "skill-mcp-tool-test-"));
    ctx = {
      manager,
      skillPaths: [tempDir],
    };
  });

  afterEach(async () => {
    await cleanupAllSkills(manager);
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("#given valid parameters", () => {
    describe("#when loading a skill by path", () => {
      it("#then should load skill successfully", async () => {
        const skillPath = join(tempDir, "test-skill.md");
        writeFileSync(
          skillPath,
          `---
name: my-test-skill
description: A test skill
mcp_servers:
  - command: echo
    args: ["hello"]
---

This is test skill content.`
        );

        const params: SkillMcpParams = {
          skill: skillPath,
          action: "load",
        };

        const result = await skillMcp(params, ctx);

        expect(result.success).toBe(true);
        expect(result.skillName).toBe("my-test-skill");
        expect(result.action).toBe("load");
        expect(result.message).toContain("loaded successfully");
        expect(result.serverIds).toBeDefined();
        expect(result.serverIds?.length).toBe(1);
      });
    });

    describe("#when loading a skill by name", () => {
      it("#then should resolve skill path and load", async () => {
        const skillsDir = join(tempDir, "skills");
        mkdirSync(skillsDir, { recursive: true });
        const skillPath = join(skillsDir, "my-skill.md");
        writeFileSync(
          skillPath,
          `---
name: my-skill
---

Skill content.`
        );

        const params: SkillMcpParams = {
          skill: "my-skill",
          action: "load",
        };

        ctx.skillPaths = [skillsDir];
        const result = await skillMcp(params, ctx);

        expect(result.success).toBe(true);
        expect(result.skillName).toBe("my-skill");
      });
    });

    describe("#when invoking a tool on loaded skill", () => {
      it("#then should invoke tool successfully", async () => {
        const skillPath = join(tempDir, "invoke-test.md");
        writeFileSync(
          skillPath,
          `---
name: invoke-test
mcp_servers:
  - command: echo
    args: ["hello"]
---

Content.`
        );

        await skillMcp({ skill: skillPath, action: "load" }, ctx);

        const params: SkillMcpParams = {
          skill: "invoke-test",
          action: "invoke",
          tool: "test-tool",
          params: { key: "value" },
        };

        const result = await skillMcp(params, ctx);

        expect(result.success).toBe(true);
        expect(result.action).toBe("invoke");
        expect(result.message).toContain("invoked successfully");
        expect(result.data).toBeDefined();
      });
    });

    describe("#when unloading a skill", () => {
      it("#then should unload skill and stop servers", async () => {
        const skillPath = join(tempDir, "unload-test.md");
        writeFileSync(skillPath, "---\nname: unload-test\n---\n\nContent.");

        await skillMcp({ skill: skillPath, action: "load" }, ctx);
        expect(getLoadedSkillNames()).toContain("unload-test");

        const params: SkillMcpParams = {
          skill: "unload-test",
          action: "unload",
        };

        const result = await skillMcp(params, ctx);

        expect(result.success).toBe(true);
        expect(result.action).toBe("unload");
        expect(result.message).toContain("unloaded successfully");
        expect(getLoadedSkillNames()).not.toContain("unload-test");
      });
    });
  });

  describe("#given invalid parameters", () => {
    describe("#when skill parameter is missing", () => {
      it("#then should return error", async () => {
        const params = { action: "load" } as unknown as SkillMcpParams;

        const result = await skillMcp(params, ctx);

        expect(result.success).toBe(false);
        expect(result.error).toContain("Missing 'skill' parameter");
      });
    });

    describe("#when action is invalid", () => {
      it("#then should return error", async () => {
        const params: SkillMcpParams = {
          skill: "test",
          action: "invalid-action" as unknown as "load",
        };

        const result = await skillMcp(params, ctx);

        expect(result.success).toBe(false);
        expect(result.error).toContain("Action must be one of");
      });
    });

    describe("#when skill file does not exist", () => {
      it("#then should return not found error", async () => {
        const params: SkillMcpParams = {
          skill: "/nonexistent/path/skill.md",
          action: "load",
        };

        const result = await skillMcp(params, ctx);

        expect(result.success).toBe(false);
        expect(result.message).toContain("not found");
      });
    });

    describe("#when invoking without tool name", () => {
      it("#then should return missing tool error", async () => {
        const skillPath = join(tempDir, "no-tool.md");
        writeFileSync(skillPath, "---\nname: no-tool\n---\n\nContent.");

        await skillMcp({ skill: skillPath, action: "load" }, ctx);

        const params: SkillMcpParams = {
          skill: "no-tool",
          action: "invoke",
        };

        const result = await skillMcp(params, ctx);

        expect(result.success).toBe(false);
        expect(result.error).toContain("Missing 'tool' parameter");
      });
    });

    describe("#when invoking unloaded skill", () => {
      it("#then should return not loaded error", async () => {
        const params: SkillMcpParams = {
          skill: "never-loaded",
          action: "invoke",
          tool: "some-tool",
        };

        const result = await skillMcp(params, ctx);

        expect(result.success).toBe(false);
        expect(result.message).toContain("is not loaded");
      });
    });
  });

  describe("#given skill with MCP servers", () => {
    describe("#when loading skill with multiple MCP servers", () => {
      it("#then should start all servers", async () => {
        const skillPath = join(tempDir, "multi-mcp.md");
        writeFileSync(
          skillPath,
          `---
name: multi-mcp
mcp_servers:
  - command: echo
    args: ["server1"]
  - command: echo
    args: ["server2"]
  - command: cat
---

Multi MCP skill.`
        );

        const params: SkillMcpParams = {
          skill: skillPath,
          action: "load",
        };

        const result = await skillMcp(params, ctx);

        expect(result.success).toBe(true);
        expect(result.serverIds?.length).toBe(3);
        expect(result.availableTools?.length).toBe(3);
      });
    });

    describe("#when loading skill without MCP servers", () => {
      it("#then should load without starting servers", async () => {
        const skillPath = join(tempDir, "no-mcp.md");
        writeFileSync(skillPath, "---\nname: no-mcp\n---\n\nPlain skill.");

        const params: SkillMcpParams = {
          skill: skillPath,
          action: "load",
        };

        const result = await skillMcp(params, ctx);

        expect(result.success).toBe(true);
        expect(result.serverIds).toBeUndefined();
      });
    });
  });

  describe("#given skill state management", () => {
    describe("#when getting loaded skill names", () => {
      it("#then should return all loaded skill names", async () => {
        const skillPath1 = join(tempDir, "skill1.md");
        const skillPath2 = join(tempDir, "skill2.md");
        writeFileSync(skillPath1, "---\nname: skill1\n---\n\nContent.");
        writeFileSync(skillPath2, "---\nname: skill2\n---\n\nContent.");

        await skillMcp({ skill: skillPath1, action: "load" }, ctx);
        await skillMcp({ skill: skillPath2, action: "load" }, ctx);

        const names = getLoadedSkillNames();

        expect(names).toContain("skill1");
        expect(names).toContain("skill2");
        expect(names.length).toBe(2);
      });
    });

    describe("#when getting skill state", () => {
      it("#then should return skill state for loaded skill", async () => {
        const skillPath = join(tempDir, "state-test.md");
        writeFileSync(skillPath, "---\nname: state-test\n---\n\nContent.");

        await skillMcp({ skill: skillPath, action: "load" }, ctx);

        const state = getLoadedSkillState("state-test");

        expect(state).toBeDefined();
        expect(state?.definition.name).toBe("state-test");
        expect(state?.loadedAt).toBeGreaterThan(0);
      });

      it("#then should return undefined for unloaded skill", () => {
        const state = getLoadedSkillState("never-loaded");
        expect(state).toBeUndefined();
      });
    });

    describe("#when cleaning up all skills", () => {
      it("#then should stop all servers and clear state", async () => {
        const skillPath1 = join(tempDir, "cleanup1.md");
        const skillPath2 = join(tempDir, "cleanup2.md");
        writeFileSync(skillPath1, "---\nname: cleanup1\n---\n\nContent.");
        writeFileSync(skillPath2, "---\nname: cleanup2\n---\n\nContent.");

        await skillMcp({ skill: skillPath1, action: "load" }, ctx);
        await skillMcp({ skill: skillPath2, action: "load" }, ctx);

        expect(getLoadedSkillNames().length).toBe(2);

        await cleanupAllSkills(manager);

        expect(getLoadedSkillNames().length).toBe(0);
      });
    });
  });

  describe("#given path resolution", () => {
    describe("#when resolving absolute path", () => {
      it("#then should use path directly", async () => {
        const skillPath = join(tempDir, "absolute.md");
        writeFileSync(skillPath, "---\nname: absolute\n---\n\nContent.");

        const params: SkillMcpParams = {
          skill: skillPath,
          action: "load",
        };

        const result = await skillMcp(params, ctx);

        expect(result.success).toBe(true);
        expect(result.skillName).toBe("absolute");
      });
    });

    describe("#when resolving relative path without extension", () => {
      it("#then should try .md extension", async () => {
        const skillPath = join(tempDir, "relative");
        writeFileSync(`${skillPath}.md`, "---\nname: relative\n---\n\nContent.");

        const params: SkillMcpParams = {
          skill: skillPath,
          action: "load",
        };

        const result = await skillMcp(params, ctx);

        expect(result.success).toBe(true);
        expect(result.skillName).toBe("relative");
      });
    });

    describe("#when resolving skill in SKILL.md subdirectory", () => {
      it("#then should find SKILL.md", async () => {
        const skillDir = join(tempDir, "my-skill");
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(
          join(skillDir, "SKILL.md"),
          "---\nname: my-skill\n---\n\nContent."
        );

        ctx.skillPaths = [tempDir];
        const params: SkillMcpParams = {
          skill: "my-skill",
          action: "load",
        };

        const result = await skillMcp(params, ctx);

        expect(result.success).toBe(true);
        expect(result.skillName).toBe("my-skill");
      });
    });
  });

  describe("#given schema validation", () => {
    describe("#when checking schema structure", () => {
      it("#then should have correct schema", () => {
        expect(skillMcpSchema.type).toBe("object");
        expect(skillMcpSchema.properties.skill.type).toBe("string");
        expect(skillMcpSchema.properties.action.enum).toContain("load");
        expect(skillMcpSchema.properties.action.enum).toContain("invoke");
        expect(skillMcpSchema.properties.action.enum).toContain("unload");
        expect(skillMcpSchema.required).toContain("skill");
        expect(skillMcpSchema.required).toContain("action");
      });
    });
  });

  describe("#given error handling", () => {
    describe("#when MCP server throws error", () => {
      it("#then should handle gracefully", async () => {
        const errorManager = {
          ...manager,
          loadSkill: async (skillPath: string) => {
            const content = readFileSync(skillPath, "utf-8");
            const { data, body } = parseFrontmatter(content);
            const skillDir = dirname(skillPath);
            const skillName = String(data.name || "") || skillPath.split("/").pop()?.replace(/\.md$/, "") || "unknown";
            
            return {
              name: skillName,
              description: data.description ? String(data.description) : undefined,
              mcpServers: [{ type: "stdio" as const, command: "echo" }],
              content: body.trim(),
              path: skillPath,
              skillDir,
            };
          },
          sendJsonRpc: async () => {
            throw new Error("MCP server error");
          },
        } as SkillMcpManager;

        const skillPath = join(tempDir, "error-test.md");
        writeFileSync(
          skillPath,
          `---
name: error-test
mcp_servers:
  - command: echo
---

Content.`
        );

        await skillMcp({ skill: skillPath, action: "load" }, { ...ctx, manager: errorManager });

        const params: SkillMcpParams = {
          skill: "error-test",
          action: "invoke",
          tool: "fail-tool",
        };

        const result = await skillMcp(params, { ...ctx, manager: errorManager });

        expect(result.success).toBe(false);
        expect(result.error).toContain("MCP server error");
      });
    });

    describe("#when skill has no MCP servers for invoke", () => {
      it("#then should return appropriate error", async () => {
        const noMcpManager = {
          ...manager,
          loadSkill: async (skillPath: string) => ({
            name: skillPath.split("/").pop()?.replace(/\.md$/, "") || "test",
            content: "No MCP.",
            mcpServers: undefined,
            path: skillPath,
            skillDir: "",
          }),
        } as SkillMcpManager;

        const skillPath = join(tempDir, "no-mcp-invoke.md");
        writeFileSync(skillPath, "---\nname: no-mcp-invoke\n---\n\nNo MCP.");

        await skillMcp({ skill: skillPath, action: "load" }, { ...ctx, manager: noMcpManager });

        const params: SkillMcpParams = {
          skill: "no-mcp-invoke",
          action: "invoke",
          tool: "test",
        };

        const result = await skillMcp(params, { ...ctx, manager: noMcpManager });

        expect(result.success).toBe(false);
        expect(result.error).toContain("No MCP servers available");
      });
    });
  });

  describe("#given edge cases", () => {
    describe("#when unloading non-existent skill", () => {
      it("#then should return not loaded message", async () => {
        const params: SkillMcpParams = {
          skill: "never-loaded",
          action: "unload",
        };

        const result = await skillMcp(params, ctx);

        expect(result.success).toBe(false);
        expect(result.message).toContain("is not loaded");
      });
    });

    describe("#when loading skill with special characters in content", () => {
      it("#then should handle gracefully", async () => {
        const skillPath = join(tempDir, "special.md");
        writeFileSync(
          skillPath,
          `---
name: special
---

Content with "quotes" and 'apostrophes' and <tags>!`
        );

        const result = await skillMcp({ skill: skillPath, action: "load" }, ctx);

        expect(result.success).toBe(true);
      });
    });

    describe("#when loading skill with empty frontmatter", () => {
      it("#then should use filename as name", async () => {
        const skillPath = join(tempDir, "empty-frontmatter.md");
        writeFileSync(skillPath, "Just content, no frontmatter.");

        const result = await skillMcp({ skill: skillPath, action: "load" }, ctx);

        expect(result.success).toBe(true);
      });
    });
  });
});
