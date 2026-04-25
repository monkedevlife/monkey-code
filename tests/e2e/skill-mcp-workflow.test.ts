import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  skillMcp,
  getLoadedSkillNames,
  getLoadedSkillState,
  cleanupAllSkills,
  type SkillMcpParams,
  type SkillMcpContext,
} from "../../src/tools/skill-mcp.js";
import type { SkillMcpManager } from "../../src/managers/SkillMcpManager.js";
import type { SkillDefinition, McpServerConfig } from "../../src/types/index.js";

interface MockServer {
  id: string;
  config: McpServerConfig;
  connected: boolean;
  startedAt: number;
  lastUsedAt: number;
}

type MockSkillMcpManager = SkillMcpManager & {
  _servers: Map<string, MockServer>;
};

function createMockSkillMcpManager(): MockSkillMcpManager {
  const servers = new Map<string, MockServer>();
  let serverCounter = 0;

  const manager: MockSkillMcpManager = {
    initializeBuiltinMcps: mock(() => Promise.resolve()),

    loadSkill: mock((skillPath: string) => {
      const skillName = skillPath.split("/").pop()?.replace(".md", "") || "unknown";
      const isNoMcpSkill = skillName === "no-mcp" || skillPath.includes("no-mcp");
      const skill: SkillDefinition = {
        name: skillName,
        description: `Mock skill: ${skillName}`,
        path: skillPath,
        skillDir: skillPath.replace("/SKILL.md", "").replace(".md", ""),
        content: "Mock skill content",
        mcpServers: isNoMcpSkill ? undefined : [
          {
            type: "stdio",
            command: "mock-mcp-server",
            args: ["--skill", skillName],
          },
        ],
      };
      return Promise.resolve(skill);
    }),

    startMcp: mock((config: McpServerConfig) => {
      serverCounter++;
      const serverId = `mock_mcp_${Date.now()}_${serverCounter}`;
      const server: MockServer = {
        id: serverId,
        config,
        connected: true,
        startedAt: Date.now(),
        lastUsedAt: Date.now(),
      };
      servers.set(serverId, server);
      return Promise.resolve(serverId);
    }),

    stopMcp: mock((serverId: string) => {
      const server = servers.get(serverId);
      if (server) {
        server.connected = false;
        servers.delete(serverId);
      }
      return Promise.resolve();
    }),

    getClient: mock((serverId: string) => {
      const server = servers.get(serverId);
      if (server) {
        server.lastUsedAt = Date.now();
      }
      return server;
    }),

    sendJsonRpc: mock((serverId: string, method: string, params?: unknown) => {
      const server = servers.get(serverId);
      if (!server || !server.connected) {
        throw new Error(`Server ${serverId} not connected`);
      }
      return Promise.resolve({
        sent: true,
        serverId,
        method,
        params,
        result: { success: true, data: "mock_result" },
      });
    }),

    getAllServers: mock(() => Array.from(servers.values())),

    getServersBySession: mock((sessionId: string) => {
      return Array.from(servers.values()).filter((s) =>
        s.id.includes(sessionId)
      );
    }),

    stopSessionMcps: mock((sessionId: string) => {
      const toStop = Array.from(servers.values()).filter((s) =>
        s.id.includes(sessionId)
      );
      return Promise.all(toStop.map((s) => manager.stopMcp(s.id)));
    }),

    cleanup: mock(() => {
      servers.clear();
      return Promise.resolve();
    }),

    isRunning: mock((serverId: string) => {
      const server = servers.get(serverId);
      return server ? server.connected : false;
    }),

    isConnected: mock((serverId: string) => {
      const server = servers.get(serverId);
      return server ? server.connected : false;
    }),

    getServerCount: mock(() => servers.size),

    _servers: servers,
  } as unknown as MockSkillMcpManager;

  return manager;
}

describe("E2E: Skill MCP Workflow", () => {
  let mockManager: MockSkillMcpManager;
  let ctx: SkillMcpContext;
  let tempDir: string;

  beforeEach(() => {
    mockManager = createMockSkillMcpManager();
    tempDir = mkdtempSync(join(tmpdir(), "skill-mcp-test-"));
    ctx = {
      manager: mockManager,
      skillPaths: [tempDir],
    };
  });

  afterEach(async () => {
    await cleanupAllSkills(mockManager);
    await mockManager.cleanup();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function createTestSkill(name: string, content?: string): string {
    const skillContent = content || `---
name: ${name}
description: Test skill ${name}
mcp_servers:
  - command: mock-mcp-server
    args: ["--skill", "${name}"]
---

# ${name} Skill

This is a test skill for ${name}.
`;
    const skillPath = join(tempDir, `${name}.md`);
    writeFileSync(skillPath, skillContent);
    return skillPath;
  }

  describe("Load Skill Flow", () => {
    it("should load skill by path", async () => {
      const skillPath = createTestSkill("playwright");

      const params: SkillMcpParams = {
        skill: skillPath,
        action: "load",
      };

      const result = await skillMcp(params, ctx);

      expect(result.success).toBe(true);
      expect(result.skillName).toBe("playwright");
      expect(result.action).toBe("load");
      expect(result.summary).toContain("loaded");
    });

    it("should load skill and start MCP servers", async () => {
      const skillPath = createTestSkill("git-master");

      const params: SkillMcpParams = {
        skill: skillPath,
        action: "load",
      };

      const result = await skillMcp(params, ctx);

      expect(result.success).toBe(true);
      expect(result.serverIds).toBeDefined();
      expect(result.serverIds?.length).toBeGreaterThan(0);
      expect(mockManager.getServerCount()).toBeGreaterThan(0);
    });

    it("should provide available tools after loading", async () => {
      const skillPath = createTestSkill("frontend-ui-ux");

      const params: SkillMcpParams = {
        skill: skillPath,
        action: "load",
      };

      const result = await skillMcp(params, ctx);

      expect(result.success).toBe(true);
      expect(result.availableTools).toBeDefined();
    });

    it("should fail to load non-existent skill", async () => {
      const params: SkillMcpParams = {
        skill: "/nonexistent/path/to/skill.md",
        action: "load",
      };

      const result = await skillMcp(params, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.summary).toContain("not found");
    });
  });

  describe("Invoke Tool Flow", () => {
    it("should invoke tool on loaded skill", async () => {
      const skillPath = createTestSkill("dev-browser");

      const loadResult = await skillMcp(
        { skill: skillPath, action: "load" },
        ctx
      );
      expect(loadResult.success).toBe(true);

      const invokeParams: SkillMcpParams = {
        skill: loadResult.skillName,
        action: "invoke",
        tool: "navigate",
        params: { url: "https://example.com" },
      };

      const invokeResult = await skillMcp(invokeParams, ctx);

      expect(invokeResult.success).toBe(true);
      expect(invokeResult.action).toBe("invoke");
      expect(invokeResult.summary).toContain("invoked");
    });

    it("should invoke tool with parameters", async () => {
      const skillPath = createTestSkill("test-skill");

      const loadResult = await skillMcp(
        { skill: skillPath, action: "load" },
        ctx
      );

      const invokeParams: SkillMcpParams = {
        skill: loadResult.skillName,
        action: "invoke",
        tool: "search",
        params: {
          query: "test query",
          limit: 10,
          filters: { category: "test" },
        },
      };

      const result = await skillMcp(invokeParams, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it("should fail to invoke tool without loading skill first", async () => {
      const params: SkillMcpParams = {
        skill: "unloaded-skill",
        action: "invoke",
        tool: "some-tool",
      };

      const result = await skillMcp(params, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Skill not found");
    });

    it("should fail to invoke without tool name", async () => {
      const skillPath = createTestSkill("test");

      const loadResult = await skillMcp(
        { skill: skillPath, action: "load" },
        ctx
      );

      const params: SkillMcpParams = {
        skill: loadResult.skillName,
        action: "invoke",
      };

      const result = await skillMcp(params, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing 'tool' parameter");
    });

    it("should fail when skill has no MCP servers", async () => {
      const skillContent = `---
name: no-mcp-skill
description: Skill without MCP servers
---

# No MCP Skill

No servers here.
`;
      const skillPath = join(tempDir, "no-mcp.md");
      writeFileSync(skillPath, skillContent);

      const loadResult = await skillMcp(
        { skill: skillPath, action: "load" },
        ctx
      );

      const result = await skillMcp(
        {
          skill: loadResult.skillName,
          action: "invoke",
          tool: "test",
        },
        ctx
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("No MCP servers available");
    });
  });

  describe("Unload Skill Flow", () => {
    it("should unload skill and stop MCP servers", async () => {
      const skillPath = createTestSkill("temp-skill");

      const loadResult = await skillMcp(
        { skill: skillPath, action: "load" },
        ctx
      );

      expect(loadResult.success).toBe(true);

      const unloadParams: SkillMcpParams = {
        skill: loadResult.skillName,
        action: "unload",
      };

      const unloadResult = await skillMcp(unloadParams, ctx);

      expect(unloadResult.success).toBe(true);
      expect(unloadResult.summary).toContain("unloaded");
    });

    it("should fail to unload non-loaded skill", async () => {
      const params: SkillMcpParams = {
        skill: "not-loaded",
        action: "unload",
      };

      const result = await skillMcp(params, ctx);

      expect(result.success).toBe(false);
      expect(result.summary).toContain("not loaded");
    });
  });

  describe("Get Loaded Skills", () => {
    it("should return list of loaded skills", async () => {
      const skills = ["skill1", "skill2", "skill3"];

      for (const skill of skills) {
        const skillPath = createTestSkill(skill);
        await skillMcp({ skill: skillPath, action: "load" }, ctx);
      }

      const loadedNames = getLoadedSkillNames();

      expect(loadedNames.length).toBeGreaterThanOrEqual(3);
      skills.forEach((s) => {
        expect(loadedNames).toContain(s);
      });
    });

    it("should get state of specific loaded skill", async () => {
      const skillPath = createTestSkill("state-test");

      const loadResult = await skillMcp(
        { skill: skillPath, action: "load" },
        ctx
      );

      const state = getLoadedSkillState(loadResult.skillName);

      expect(state).toBeDefined();
      expect(state?.definition.name).toBe(loadResult.skillName);
    });

    it("should return undefined for unloaded skill state", () => {
      const state = getLoadedSkillState("never-loaded");
      expect(state).toBeUndefined();
    });
  });

  describe("Cleanup Flow", () => {
    it("should cleanup all skills and stop servers", async () => {
      const skills = ["cleanup1", "cleanup2"];

      for (const skill of skills) {
        const skillPath = createTestSkill(skill);
        await skillMcp({ skill: skillPath, action: "load" }, ctx);
      }

      expect(mockManager.getServerCount()).toBeGreaterThan(0);

      await cleanupAllSkills(mockManager);

      expect(getLoadedSkillNames()).toHaveLength(0);
    });
  });

  describe("End-to-End Complete Workflow", () => {
    it("should complete full workflow: load → invoke → unload", async () => {
      const skillPath = createTestSkill("oracle");

      const loadResult = await skillMcp(
        { skill: skillPath, action: "load" },
        ctx
      );

      expect(loadResult.success).toBe(true);
      expect(loadResult.skillName).toBe("oracle");
      expect(loadResult.serverIds?.length).toBeGreaterThan(0);

      const invokeResult = await skillMcp(
        {
          skill: loadResult.skillName,
          action: "invoke",
          tool: "query",
          params: { question: "What is the meaning of life?" },
        },
        ctx
      );

      expect(invokeResult.success).toBe(true);
      expect(invokeResult.action).toBe("invoke");
      expect(invokeResult.data).toBeDefined();

      const unloadResult = await skillMcp(
        { skill: loadResult.skillName, action: "unload" },
        ctx
      );

      expect(unloadResult.success).toBe(true);
      expect(unloadResult.summary).toContain("unloaded");
    });

    it("should handle multiple skill operations", async () => {
      const skills = [
        { name: "playwright", tool: "navigate", params: { url: "https://test.com" } },
        { name: "git-master", tool: "status", params: {} },
        { name: "dev-browser", tool: "click", params: { selector: "#btn" } },
      ];

      for (const skillDef of skills) {
        const skillPath = createTestSkill(skillDef.name);
        const loadResult = await skillMcp(
          { skill: skillPath, action: "load" },
          ctx
        );

        expect(loadResult.success).toBe(true);

        const invokeResult = await skillMcp(
          {
            skill: loadResult.skillName,
            action: "invoke",
            tool: skillDef.tool,
            params: skillDef.params,
          },
          ctx
        );

        expect(invokeResult.success).toBe(true);
      }

      const loadedSkills = getLoadedSkillNames();
      expect(loadedSkills.length).toBeGreaterThanOrEqual(skills.length);

      for (const skillDef of skills) {
        const unloadResult = await skillMcp(
          { skill: skillDef.name, action: "unload" },
          ctx
        );
        expect(unloadResult.success).toBe(true);
      }
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid action", async () => {
      const skillPath = createTestSkill("invalid-action-test");

      const params: SkillMcpParams = {
        skill: skillPath,
        action: "invalid" as any,
      };

      const result = await skillMcp(params, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Action must be one of");
    });

    it("should handle missing skill parameter", async () => {
      const params = { action: "load" } as SkillMcpParams;

      const result = await skillMcp(params, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing");
    });

    it("should handle server disconnection during invoke", async () => {
      const skillPath = createTestSkill("disconnect-test");

      const loadResult = await skillMcp(
        { skill: skillPath, action: "load" },
        ctx
      );

      const serverId = loadResult.serverIds?.[0];
      if (serverId) {
        const server = mockManager.getClient(serverId);
        if (server) {
          server.connected = false;
        }
      }

      const result = await skillMcp(
        {
          skill: loadResult.skillName,
          action: "invoke",
          tool: "test",
        },
        ctx
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Server disconnected");
    });

    it("should handle MCP server errors gracefully", async () => {
      const skillPath = createTestSkill("error-test");

      await skillMcp({ skill: skillPath, action: "load" }, ctx);

      mockManager.sendJsonRpc = mock(() => {
        throw new Error("MCP server error: Connection refused");
      });

      const result = await skillMcp(
        {
          skill: "error-test",
          action: "invoke",
          tool: "failing-tool",
        },
        ctx
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("MCP server error");
    });
  });

  describe("Server State Management", () => {
    it("should track server connection state", async () => {
      const skillPath = createTestSkill("state-track");

      const result = await skillMcp(
        { skill: skillPath, action: "load" },
        ctx
      );

      const serverIds = result.serverIds || [];
      serverIds.forEach((id) => {
        expect(mockManager.isRunning(id)).toBe(true);
        expect(mockManager.isConnected(id)).toBe(true);
      });
    });

    it("should update last used timestamp on invoke", async () => {
      const skillPath = createTestSkill("timestamp");

      const loadResult = await skillMcp(
        { skill: skillPath, action: "load" },
        ctx
      );

      const beforeInvoke = Date.now();

      await skillMcp(
        {
          skill: loadResult.skillName,
          action: "invoke",
          tool: "test",
        },
        ctx
      );

      const client = mockManager.getClient(loadResult.serverIds?.[0] || "ts_server");
      expect(client?.lastUsedAt).toBeGreaterThanOrEqual(beforeInvoke);
    });
  });
});
