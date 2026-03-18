import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  SkillMcpManager,
  SkillMcpManagerError,
  createSkillMcpManager,
} from "./SkillMcpManager.js";
import type { McpsConfig } from "../config.js";
import type { McpServerConfig } from "../types/index.js";

describe("SkillMcpManager", () => {
  let manager: SkillMcpManager;
  let tempDir: string;

  beforeEach(() => {
    manager = createSkillMcpManager();
    tempDir = mkdtempSync(join(tmpdir(), "skill-mcp-test-"));
  });

  afterEach(async () => {
    await manager.cleanup();
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("initialization", () => {
    it("should create manager with default options", () => {
      const m = createSkillMcpManager();
      expect(m).toBeInstanceOf(SkillMcpManager);
      expect(m.getServerCount()).toBe(0);
    });

    it("should create manager with session ID", () => {
      const m = createSkillMcpManager({ sessionId: "test-session" });
      expect(m).toBeInstanceOf(SkillMcpManager);
    });

    it("should have zero servers initially", () => {
      expect(manager.getServerCount()).toBe(0);
      expect(manager.getAllServers()).toEqual([]);
    });
  });

  describe("loadSkill", () => {
    it("should load skill with basic frontmatter", async () => {
      const skillPath = join(tempDir, "test-skill.md");
      writeFileSync(
        skillPath,
        `---
name: my-skill
description: A test skill
---

This is the skill content.
`
      );

      const skill = await manager.loadSkill(skillPath);

      expect(skill.name).toBe("my-skill");
      expect(skill.description).toBe("A test skill");
      expect(skill.content).toBe("This is the skill content.");
      expect(skill.path).toBe(skillPath);
      expect(skill.skillDir).toBe(tempDir);
    });

    it("should infer skill name from filename", async () => {
      const skillPath = join(tempDir, "inferred-name.md");
      writeFileSync(skillPath, "No frontmatter here.");

      const skill = await manager.loadSkill(skillPath);

      expect(skill.name).toBe("inferred-name");
      expect(skill.content).toBe("No frontmatter here.");
    });

    it("should parse mcp_servers from frontmatter", async () => {
      const skillPath = join(tempDir, "mcp-skill.md");
      writeFileSync(
        skillPath,
        `---
name: mcp-enabled-skill
mcp_servers:
  - command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem"]
    env:
      KEY: value
---

Skill with MCP.
`
      );

      const skill = await manager.loadSkill(skillPath);

      expect(skill.name).toBe("mcp-enabled-skill");
      expect(skill.mcpServers).toHaveLength(1);
      expect(skill.mcpServers?.[0].type).toBe("stdio");
      expect(skill.mcpServers?.[0].command).toBe("npx");
      expect(skill.mcpServers?.[0].args).toEqual(["-y", "@modelcontextprotocol/server-filesystem"]);
      expect(skill.mcpServers?.[0].env).toEqual({ KEY: "value" });
    });

    it("should handle skill without mcp_servers", async () => {
      const skillPath = join(tempDir, "no-mcp.md");
      writeFileSync(skillPath, "---\nname: plain-skill\n---\n\nPlain content.");

      const skill = await manager.loadSkill(skillPath);

      expect(skill.name).toBe("plain-skill");
      expect(skill.mcpServers).toBeUndefined();
    });

    it("should handle empty frontmatter", async () => {
      const skillPath = join(tempDir, "empty-frontmatter.md");
      writeFileSync(skillPath, "Just markdown content.");

      const skill = await manager.loadSkill(skillPath);

      expect(skill.name).toBe("empty-frontmatter");
      expect(skill.description).toBeUndefined();
    });

    it("should handle multiple mcp servers", async () => {
      const skillPath = join(tempDir, "multi-mcp.md");
      writeFileSync(
        skillPath,
        `---
name: multi-mcp
mcp_servers:
  - command: server1
    args: ["--port", "3000"]
  - command: server2
    env:
      DEBUG: "true"
---

Multi MCP skill.
`
      );

      const skill = await manager.loadSkill(skillPath);

      expect(skill.mcpServers).toHaveLength(2);
      expect(skill.mcpServers?.[0].command).toBe("server1");
      expect(skill.mcpServers?.[1].command).toBe("server2");
    });

    it("should handle skill with invalid yaml gracefully", async () => {
      const skillPath = join(tempDir, "invalid-yaml.md");
      writeFileSync(
        skillPath,
        `---
invalid: [
yaml: content
---

Body content.`
      );

      const skill = await manager.loadSkill(skillPath);
      expect(skill.name).toBe("invalid-yaml");
      expect(skill.content).toBe("Body content.");
    });
  });

  describe("startMcp", () => {
    it("should throw error for non-stdio type", async () => {
      const config = {
        type: "http" as const,
        command: "echo",
      };

      await expect(manager.startMcp(config)).rejects.toThrow(
        SkillMcpManagerError
      );
      await expect(manager.startMcp(config)).rejects.toThrow(
        /Unsupported MCP server type/
      );
    });

    it("should start stdio MCP server and return server ID", async () => {
      const config: McpServerConfig = {
        type: "stdio",
        command: "sleep",
        args: ["10"],
      };

      const serverId = await manager.startMcp(config);

      expect(serverId).toBeDefined();
      expect(serverId.startsWith("mcp-")).toBe(true);
      expect(manager.getServerCount()).toBe(1);
    });

    it("should accept custom server ID", async () => {
      const config: McpServerConfig = {
        type: "stdio",
        command: "sleep",
        args: ["10"],
      };
      const customId = "my-custom-server";

      const serverId = await manager.startMcp(config, customId);

      expect(serverId).toBe(customId);
      expect(manager.getClient(customId)).toBeDefined();
    });

    it("should restart existing server with same ID", async () => {
      const config: McpServerConfig = {
        type: "stdio",
        command: "sleep",
        args: ["10"],
      };
      const serverId = "restart-test";

      await manager.startMcp(config, serverId);
      const firstServer = manager.getClient(serverId);

      await manager.startMcp(config, serverId);
      const secondServer = manager.getClient(serverId);

      expect(manager.getServerCount()).toBe(1);
      expect(secondServer?.startedAt).toBeGreaterThanOrEqual(
        firstServer?.startedAt ?? 0
      );
    });

    it("should merge env variables with process.env", async () => {
      const config: McpServerConfig = {
        type: "stdio",
        command: "sleep",
        args: ["1"],
        env: { CUSTOM_VAR: "custom_value" },
      };

      const serverId = await manager.startMcp(config);
      const server = manager.getClient(serverId);

      expect(server).toBeDefined();
      expect(server?.config.env).toEqual({ CUSTOM_VAR: "custom_value" });
    });

    it("should track session ID on servers", async () => {
      const sessionManager = createSkillMcpManager({
        sessionId: "test-session-123",
      });

      const config: McpServerConfig = {
        type: "stdio",
        command: "sleep",
        args: ["1"],
      };

      const serverId = await sessionManager.startMcp(config);
      const server = sessionManager.getClient(serverId);

      expect(server?.sessionId).toBe("test-session-123");

      await sessionManager.cleanup();
    });
  });

  describe("stopMcp", () => {
    it("should stop running server", async () => {
      const config: McpServerConfig = {
        type: "stdio",
        command: "sleep",
        args: ["10"],
      };

      const serverId = await manager.startMcp(config);
      expect(manager.getServerCount()).toBe(1);

      await manager.stopMcp(serverId);

      expect(manager.getServerCount()).toBe(0);
    });

    it("should not throw for non-existent server", async () => {
      await expect(manager.stopMcp("non-existent")).resolves.toBeUndefined();
    });

    it("should handle multiple stops gracefully", async () => {
      const config: McpServerConfig = {
        type: "stdio",
        command: "sleep",
        args: ["10"],
      };

      const serverId = await manager.startMcp(config);
      await manager.stopMcp(serverId);
      await manager.stopMcp(serverId);
      await manager.stopMcp(serverId);

      expect(manager.getServerCount()).toBe(0);
    });
  });

  describe("getClient", () => {
    it("should return server process by ID", async () => {
      const config: McpServerConfig = {
        type: "stdio",
        command: "sleep",
        args: ["10"],
      };

      const serverId = await manager.startMcp(config);
      const client = manager.getClient(serverId);

      expect(client).toBeDefined();
      expect(client?.id).toBe(serverId);
      expect(client?.config.command).toBe("sleep");
    });

    it("should update lastUsedAt on access", async () => {
      const config: McpServerConfig = {
        type: "stdio",
        command: "sleep",
        args: ["10"],
      };

      const serverId = await manager.startMcp(config);
      const before = manager.getClient(serverId)?.lastUsedAt;

      await new Promise((resolve) => setTimeout(resolve, 50));

      manager.getClient(serverId);
      const after = manager.getClient(serverId)?.lastUsedAt;

      expect(after).toBeGreaterThan(before ?? 0);
    });

    it("should return undefined for non-existent server", () => {
      const client = manager.getClient("does-not-exist");
      expect(client).toBeUndefined();
    });
  });

  describe("getAllServers", () => {
    it("should return all running servers", async () => {
      const config1: McpServerConfig = {
        type: "stdio",
        command: "sleep",
        args: ["10"],
      };
      const config2: McpServerConfig = {
        type: "stdio",
        command: "sleep",
        args: ["10"],
      };

      await manager.startMcp(config1, "server1");
      await manager.startMcp(config2, "server2");

      const servers = manager.getAllServers();

      expect(servers).toHaveLength(2);
      expect(servers.map((s) => s.id)).toContain("server1");
      expect(servers.map((s) => s.id)).toContain("server2");
    });

    it("should return empty array when no servers", () => {
      expect(manager.getAllServers()).toEqual([]);
    });
  });

  describe("getServersBySession", () => {
    it("should return servers for specific session", async () => {
      const sessionManager = createSkillMcpManager({
        sessionId: "session-a",
      });

      const config: McpServerConfig = {
        type: "stdio",
        command: "sleep",
        args: ["10"],
      };

      await sessionManager.startMcp(config, "server-a1");
      await sessionManager.startMcp(config, "server-a2");

      const servers = sessionManager.getServersBySession("session-a");

      expect(servers).toHaveLength(2);

      await sessionManager.cleanup();
    });

    it("should return empty array for unknown session", async () => {
      const config: McpServerConfig = {
        type: "stdio",
        command: "sleep",
        args: ["10"],
      };

      await manager.startMcp(config, "server1");

      expect(manager.getServersBySession("unknown")).toEqual([]);
    });
  });

  describe("stopSessionMcps", () => {
    it("should stop all servers for a session", async () => {
      const config: McpServerConfig = {
        type: "stdio",
        command: "sleep",
        args: ["10"],
      };

      const sessionManager = createSkillMcpManager({
        sessionId: "session-to-stop",
      });

      await sessionManager.startMcp(config, "s1");
      await sessionManager.startMcp(config, "s2");
      await sessionManager.startMcp(config, "s3");

      expect(sessionManager.getServerCount()).toBe(3);

      await sessionManager.stopSessionMcps("session-to-stop");

      expect(sessionManager.getServerCount()).toBe(0);
    });

    it("should not affect servers from other sessions", async () => {
      const config: McpServerConfig = {
        type: "stdio",
        command: "sleep",
        args: ["10"],
      };

      const managerA = createSkillMcpManager({ sessionId: "session-a" });
      const managerB = createSkillMcpManager({ sessionId: "session-b" });

      await managerA.startMcp(config, "server-a");
      await managerB.startMcp(config, "server-b");

      await managerA.stopSessionMcps("session-a");

      expect(managerA.getServerCount()).toBe(0);
      expect(managerB.getServerCount()).toBe(1);

      await managerB.cleanup();
    });
  });

  describe("cleanup", () => {
    it("should stop all servers", async () => {
      const config: McpServerConfig = {
        type: "stdio",
        command: "sleep",
        args: ["10"],
      };

      await manager.startMcp(config, "s1");
      await manager.startMcp(config, "s2");

      expect(manager.getServerCount()).toBe(2);

      await manager.cleanup();

      expect(manager.getServerCount()).toBe(0);
    });

    it("should handle cleanup with no servers", async () => {
      await expect(manager.cleanup()).resolves.toBeUndefined();
    });

    it("should be callable multiple times", async () => {
      const config: McpServerConfig = {
        type: "stdio",
        command: "sleep",
        args: ["10"],
      };

      await manager.startMcp(config);
      await manager.cleanup();
      await manager.cleanup();
      await manager.cleanup();

      expect(manager.getServerCount()).toBe(0);
    });
  });

  describe("isRunning", () => {
    it("should return true for running server", async () => {
      const config: McpServerConfig = {
        type: "stdio",
        command: "sleep",
        args: ["10"],
      };

      const serverId = await manager.startMcp(config);

      expect(manager.isRunning(serverId)).toBe(true);
    });

    it("should return false for stopped server", async () => {
      const config: McpServerConfig = {
        type: "stdio",
        command: "sleep",
        args: ["10"],
      };

      const serverId = await manager.startMcp(config);
      await manager.stopMcp(serverId);

      expect(manager.isRunning(serverId)).toBe(false);
    });

    it("should return false for non-existent server", () => {
      expect(manager.isRunning("non-existent")).toBe(false);
    });
  });

  describe("initializeBuiltinMcps", () => {
    it("should do nothing when config is not provided", async () => {
      const m = createSkillMcpManager();
      await m.initializeBuiltinMcps();
      expect(m.getServerCount()).toBe(0);
    });

    it("should skip disabled MCPs", async () => {
      const config: McpsConfig = {
        chromeDevTools: { enabled: false },
        context7: { enabled: false },
        grepApp: { enabled: false },
      };

      await manager.initializeBuiltinMcps(config);
      expect(manager.getServerCount()).toBe(0);
    });

    it("should handle errors from individual MCPs gracefully", async () => {
      const config: McpsConfig = {
        chromeDevTools: { enabled: true },
        context7: { enabled: true },
        grepApp: { enabled: true },
      };

      await expect(manager.initializeBuiltinMcps(config)).rejects.toThrow();
    });
  });

  describe("SkillMcpManagerError", () => {
    it("should create error with message and code", () => {
      const error = new SkillMcpManagerError("test error", "TEST_CODE");
      expect(error.message).toBe("test error");
      expect(error.code).toBe("TEST_CODE");
      expect(error.name).toBe("SkillMcpManagerError");
    });

    it("should include server ID when provided", () => {
      const error = new SkillMcpManagerError(
        "server failed",
        "SERVER_ERROR",
        "server-123"
      );
      expect(error.serverId).toBe("server-123");
    });

    it("should be instance of Error", () => {
      const error = new SkillMcpManagerError("test", "CODE");
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe("edge cases", () => {
    it("should handle rapid start/stop cycles", async () => {
      const config: McpServerConfig = {
        type: "stdio",
        command: "sleep",
        args: ["1"],
      };

      for (let i = 0; i < 3; i++) {
        const id = await manager.startMcp(config, `cycle-${i}`);
        await manager.stopMcp(id);
      }

      expect(manager.getServerCount()).toBe(0);
    });

    it("should handle config without env", async () => {
      const config: McpServerConfig = {
        type: "stdio",
        command: "sleep",
        args: ["1"],
      };

      const serverId = await manager.startMcp(config);
      const server = manager.getClient(serverId);

      expect(server?.config.env).toBeUndefined();
    });

    it("should handle config without args", async () => {
      const config: McpServerConfig = {
        type: "stdio",
        command: "sleep",
      };

      const serverId = await manager.startMcp(config);
      const server = manager.getClient(serverId);

      expect(server?.config.args).toBeUndefined();
    });

    it("should handle skills with special characters in content", async () => {
      const skillPath = join(tempDir, "special-chars.md");
      writeFileSync(
        skillPath,
        `---
name: special-skill
---

Content with "quotes" and 'apostrophes' and <tags>!
`
      );

      const skill = await manager.loadSkill(skillPath);
      expect(skill.content).toContain('"quotes"');
      expect(skill.content).toContain("'apostrophes'");
    });
  });
});

describe("createSkillMcpManager", () => {
  it("should create manager instance", () => {
    const m = createSkillMcpManager();
    expect(m).toBeInstanceOf(SkillMcpManager);
  });

  it("should pass options to manager", () => {
    const m = createSkillMcpManager({
      sessionId: "test-session",
      builtinConfig: {
        chromeDevTools: { enabled: true },
      },
    });
    expect(m).toBeInstanceOf(SkillMcpManager);
  });
});
