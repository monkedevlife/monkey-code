import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  skillMcp,
  getLoadedSkillNames,
  getLoadedSkillState,
  cleanupAllSkills,
  type SkillMcpParams,
  type SkillMcpContext,
  type SkillMcpResult,
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

interface MockSkillState {
  definition: SkillDefinition;
  serverIds: string[];
  loadedAt: number;
}

function createMockSkillMcpManager(): SkillMcpManager {
  const servers = new Map<string, MockServer>();
  const loadedSkills = new Map<string, MockSkillState>();
  let serverCounter = 0;

  const manager = {
    initializeBuiltinMcps: mock(() => Promise.resolve()),

    loadSkill: mock((skillPath: string) => {
      const skillName = skillPath.split("/").pop()?.replace(".md", "") || "unknown";
      const skill: SkillDefinition = {
        name: skillName,
        description: `Mock skill: ${skillName}`,
        path: skillPath,
        skillDir: skillPath.replace("/SKILL.md", "").replace(".md", ""),
        content: "Mock skill content",
        mcpServers: [
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
    _loadedSkills: loadedSkills,
    _registerSkill: (name: string, state: MockSkillState) => {
      loadedSkills.set(name, state);
    },
  } as unknown as SkillMcpManager & {
    _servers: Map<string, MockServer>;
    _loadedSkills: Map<string, MockSkillState>;
    _registerSkill: (name: string, state: MockSkillState) => void;
  };

  return manager;
}

describe("E2E: Skill MCP Workflow", () => {
  let mockManager: SkillMcpManager & {
    _servers: Map<string, MockServer>;
    _loadedSkills: Map<string, MockSkillState>;
    _registerSkill: (name: string, state: MockSkillState) => void;
  };
  let ctx: SkillMcpContext;

  beforeEach(() => {
    mockManager = createMockSkillMcpManager();
    ctx = {
      manager: mockManager,
      skillPaths: ["/mock/skills"],
    };
  });

  afterEach(async () => {
    await cleanupAllSkills(mockManager);
    await mockManager.cleanup();
  });

  describe("Load Skill Flow", () => {
    it("should load skill by path", async () => {
      const params: SkillMcpParams = {
        skill: "/skills/playwright.md",
        action: "load",
      };

      const result = await skillMcp(params, ctx);

      expect(result.success).toBe(true);
      expect(result.skillName).toBe("playwright");
      expect(result.action).toBe("load");
      expect(result.message).toContain("loaded successfully");
    });

    it("should load skill and start MCP servers", async () => {
      const params: SkillMcpParams = {
        skill: "/skills/git-master.md",
        action: "load",
      };

      const result = await skillMcp(params, ctx);

      expect(result.success).toBe(true);
      expect(result.serverIds).toBeDefined();
      expect(result.serverIds?.length).toBeGreaterThan(0);
      expect(mockManager.getServerCount()).toBeGreaterThan(0);
    });

    it("should provide available tools after loading", async () => {
      const params: SkillMcpParams = {
        skill: "/skills/frontend-ui-ux.md",
        action: "load",
      };

      const result = await skillMcp(params, ctx);

      expect(result.success).toBe(true);
      expect(result.availableTools).toBeDefined();
    });

    it("should fail to load non-existent skill", async () => {
      const params: SkillMcpParams = {
        skill: "nonexistent-skill",
        action: "load",
      };

      const result = await skillMcp(params, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.message).toContain("not found");
    });
  });

  describe("Invoke Tool Flow", () => {
    it("should invoke tool on loaded skill", async () => {
      const loadParams: SkillMcpParams = {
        skill: "/skills/dev-browser.md",
        action: "load",
      };

      const loadResult = await skillMcp(loadParams, ctx);
      expect(loadResult.success).toBe(true);

      const skillName = loadResult.skillName;

      mockManager._registerSkill(skillName, {
        definition: {
          name: skillName,
          description: "Test skill",
          mcpServers: [
            {
              type: "stdio",
              command: "mock-server",
            },
          ],
        },
        serverIds: loadResult.serverIds || ["mock_server_1"],
        loadedAt: Date.now(),
      });

      const invokeParams: SkillMcpParams = {
        skill: skillName,
        action: "invoke",
        tool: "navigate",
        params: { url: "https://example.com" },
      };

      const invokeResult = await skillMcp(invokeParams, ctx);

      expect(invokeResult.success).toBe(true);
      expect(invokeResult.action).toBe("invoke");
      expect(invokeResult.message).toContain("invoked successfully");
    });

    it("should invoke tool with parameters", async () => {
      const loadResult = await skillMcp(
        { skill: "/skills/test-skill.md", action: "load" },
        ctx
      );

      mockManager._registerSkill(loadResult.skillName, {
        definition: {
          name: loadResult.skillName,
          mcpServers: [{ type: "stdio", command: "test" }],
        },
        serverIds: ["server_1"],
        loadedAt: Date.now(),
      });

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
      expect(result.error).toContain("not loaded");
    });

    it("should fail to invoke without tool name", async () => {
      const loadResult = await skillMcp(
        { skill: "/skills/test.md", action: "load" },
        ctx
      );

      mockManager._registerSkill(loadResult.skillName, {
        definition: { name: loadResult.skillName },
        serverIds: ["server_1"],
        loadedAt: Date.now(),
      });

      const params: SkillMcpParams = {
        skill: loadResult.skillName,
        action: "invoke",
      };

      const result = await skillMcp(params, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Tool name is required");
    });

    it("should fail when skill has no MCP servers", async () => {
      const loadResult = await skillMcp(
        { skill: "/skills/no-mcp.md", action: "load" },
        ctx
      );

      mockManager._registerSkill(loadResult.skillName, {
        definition: { name: loadResult.skillName, mcpServers: [] },
        serverIds: [],
        loadedAt: Date.now(),
      });

      const result = await skillMcp(
        {
          skill: loadResult.skillName,
          action: "invoke",
          tool: "test",
        },
        ctx
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("no MCP servers");
    });
  });

  describe("Unload Skill Flow", () => {
    it("should unload skill and stop MCP servers", async () => {
      const loadResult = await skillMcp(
        { skill: "/skills/temp-skill.md", action: "load" },
        ctx
      );

      expect(loadResult.success).toBe(true);
      const skillName = loadResult.skillName;

      mockManager._registerSkill(skillName, {
        definition: { name: skillName },
        serverIds: loadResult.serverIds || [],
        loadedAt: Date.now(),
      });

      const unloadParams: SkillMcpParams = {
        skill: skillName,
        action: "unload",
      };

      const unloadResult = await skillMcp(unloadParams, ctx);

      expect(unloadResult.success).toBe(true);
      expect(unloadResult.message).toContain("unloaded successfully");
    });

    it("should fail to unload non-loaded skill", async () => {
      const params: SkillMcpParams = {
        skill: "not-loaded",
        action: "unload",
      };

      const result = await skillMcp(params, ctx);

      expect(result.success).toBe(false);
      expect(result.message).toContain("not loaded");
    });
  });

  describe("Get Loaded Skills", () => {
    it("should return list of loaded skills", async () => {
      const skills = ["skill1", "skill2", "skill3"];

      for (const skill of skills) {
        await skillMcp({ skill: `/skills/${skill}.md`, action: "load" }, ctx);
        mockManager._registerSkill(skill, {
          definition: { name: skill },
          serverIds: [],
          loadedAt: Date.now(),
        });
      }

      const loadedNames = getLoadedSkillNames();

      expect(loadedNames.length).toBeGreaterThanOrEqual(3);
      skills.forEach((s) => {
        expect(loadedNames).toContain(s);
      });
    });

    it("should get state of specific loaded skill", async () => {
      const loadResult = await skillMcp(
        { skill: "/skills/state-test.md", action: "load" },
        ctx
      );

      mockManager._registerSkill(loadResult.skillName, {
        definition: {
          name: loadResult.skillName,
          description: "Test",
        },
        serverIds: ["server_1", "server_2"],
        loadedAt: Date.now(),
      });

      const state = getLoadedSkillState(loadResult.skillName);

      expect(state).toBeDefined();
      expect(state?.definition.name).toBe(loadResult.skillName);
      expect(state?.serverIds).toContain("server_1");
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
        const result = await skillMcp(
          { skill: `/skills/${skill}.md`, action: "load" },
          ctx
        );
        mockManager._registerSkill(skill, {
          definition: { name: skill },
          serverIds: result.serverIds || [],
          loadedAt: Date.now(),
        });
      }

      expect(mockManager.getServerCount()).toBeGreaterThan(0);

      await cleanupAllSkills(mockManager);

      expect(getLoadedSkillNames()).toHaveLength(0);
    });
  });

  describe("End-to-End Complete Workflow", () => {
    it("should complete full workflow: load → invoke → unload", async () => {
      const skillPath = "/skills/oracle.md";

      const loadResult = await skillMcp(
        { skill: skillPath, action: "load" },
        ctx
      );

      expect(loadResult.success).toBe(true);
      expect(loadResult.skillName).toBe("oracle");
      expect(loadResult.serverIds?.length).toBeGreaterThan(0);

      const skillName = loadResult.skillName;

      mockManager._registerSkill(skillName, {
        definition: {
          name: skillName,
          mcpServers: [
            { type: "stdio", command: "oracle-mcp" },
          ],
        },
        serverIds: loadResult.serverIds || ["oracle_server"],
        loadedAt: Date.now(),
      });

      const invokeResult = await skillMcp(
        {
          skill: skillName,
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
        { skill: skillName, action: "unload" },
        ctx
      );

      expect(unloadResult.success).toBe(true);
      expect(unloadResult.message).toContain("unloaded");
    });

    it("should handle multiple skill operations", async () => {
      const skills = [
        { name: "playwright", tool: "navigate", params: { url: "https://test.com" } },
        { name: "git-master", tool: "status", params: {} },
        { name: "dev-browser", tool: "click", params: { selector: "#btn" } },
      ];

      for (const skillDef of skills) {
        const loadResult = await skillMcp(
          { skill: `/skills/${skillDef.name}.md`, action: "load" },
          ctx
        );

        expect(loadResult.success).toBe(true);

        mockManager._registerSkill(skillDef.name, {
          definition: { name: skillDef.name },
          serverIds: loadResult.serverIds || [`${skillDef.name}_server`],
          loadedAt: Date.now(),
        });

        const invokeResult = await skillMcp(
          {
            skill: skillDef.name,
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
      const params: SkillMcpParams = {
        skill: "test",
        action: "invalid" as any,
      };

      const result = await skillMcp(params, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid action");
    });

    it("should handle missing skill parameter", async () => {
      const params = { action: "load" } as SkillMcpParams;

      const result = await skillMcp(params, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Skill parameter is required");
    });

    it("should handle server disconnection during invoke", async () => {
      const loadResult = await skillMcp(
        { skill: "/skills/disconnect-test.md", action: "load" },
        ctx
      );

      mockManager._registerSkill(loadResult.skillName, {
        definition: { name: loadResult.skillName },
        serverIds: ["disconnected_server"],
        loadedAt: Date.now(),
      });

      mockManager.isConnected = mock(() => false);

      const result = await skillMcp(
        {
          skill: loadResult.skillName,
          action: "invoke",
          tool: "test",
        },
        ctx
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not connected");
    });

    it("should handle MCP server errors gracefully", async () => {
      mockManager.sendJsonRpc = mock(() => {
        throw new Error("MCP server error: Connection refused");
      });

      const loadResult = await skillMcp(
        { skill: "/skills/error-test.md", action: "load" },
        ctx
      );

      mockManager._registerSkill(loadResult.skillName, {
        definition: { name: loadResult.skillName },
        serverIds: ["error_server"],
        loadedAt: Date.now(),
      });

      const result = await skillMcp(
        {
          skill: loadResult.skillName,
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
      const result = await skillMcp(
        { skill: "/skills/state-track.md", action: "load" },
        ctx
      );

      const serverIds = result.serverIds || [];
      serverIds.forEach((id) => {
        expect(mockManager.isRunning(id)).toBe(true);
        expect(mockManager.isConnected(id)).toBe(true);
      });
    });

    it("should update last used timestamp on invoke", async () => {
      const loadResult = await skillMcp(
        { skill: "/skills/timestamp.md", action: "load" },
        ctx
      );

      mockManager._registerSkill(loadResult.skillName, {
        definition: { name: loadResult.skillName },
        serverIds: loadResult.serverIds || ["ts_server"],
        loadedAt: Date.now(),
      });

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
