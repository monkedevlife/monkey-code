import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { delegateTask, type DelegateTaskInput, type OpenCodeClient } from "../../src/tools/delegate-task.js";
import { getBackgroundOutput } from "../../src/tools/background-output.js";
import { skillMcp, cleanupAllSkills, type SkillMcpParams, type SkillMcpContext } from "../../src/tools/skill-mcp.js";
import type { BackgroundManager } from "../../src/managers/BackgroundManager.js";
import type { NotificationCallback } from "../../src/managers/BackgroundManager.js";
import type { SkillMcpManager } from "../../src/managers/SkillMcpManager.js";
import type { Task, SkillDefinition, McpServerConfig } from "../../src/types/index.js";

interface MockTask {
  id: string;
  status: Task["status"];
  command: string;
  output?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
  agentName?: string;
  context?: string;
  timeout?: number;
  parentSessionId?: string;
}

interface MockServer {
  id: string;
  config: McpServerConfig;
  connected: boolean;
  startedAt: number;
  lastUsedAt: number;
}

type MockBackgroundManager = BackgroundManager & {
  _tasks: Map<string, MockTask>;
  _completeTask: (taskId: string, output: string) => void;
};

type MockSkillMcpManager = SkillMcpManager & {
  _servers: Map<string, MockServer>;
};

function createMockOpenCodeClient(): OpenCodeClient {
  let sessionCounter = 0;
  return {
    session: {
      create: mock(() => {
        sessionCounter++;
        return Promise.resolve({
          data: { id: `punch_session_${Date.now()}_${sessionCounter}` },
        });
      }),
      prompt: mock(() => Promise.resolve({ data: {} })),
    },
  };
}

function createMockBackgroundManager(): MockBackgroundManager {
  const tasks = new Map<string, MockTask>();
  const notifications = new Map<string, NotificationCallback>();
  let taskCounter = 0;

  const notify = (task: MockTask) => {
    const callback = notifications.get(task.id);
    if (callback) {
      callback(task.id, task.status, task.output, task.error);
    }
  };

  const manager = {
    launch: mock((input: {
      command: string;
      agentName?: string;
      context?: string;
      timeout?: number;
      parentSessionId?: string;
    }) => {
      taskCounter++;
      const taskId = `punch_task_${Date.now()}_${taskCounter}`;
      const task: MockTask = {
        id: taskId,
        status: "pending",
        command: input.command,
        agentName: input.agentName,
        context: input.context,
        timeout: input.timeout,
        parentSessionId: input.parentSessionId,
        createdAt: Date.now(),
      };
      tasks.set(taskId, task);

      setTimeout(() => {
        task.status = "in_progress";
      }, 50);

      setTimeout(() => {
        task.status = "completed";
        task.output = `Punch agent completed: ${input.command}`;
        task.completedAt = Date.now();
        notify(task);
      }, 100);

      return Promise.resolve(taskId);
    }),

    cancel: mock((taskId: string) => {
      const task = tasks.get(taskId);
      if (task) {
        task.status = "cancelled";
        task.completedAt = Date.now();
        notify(task);
      }
      return Promise.resolve();
    }),

    getStatus: mock((taskId: string) => {
      const task = tasks.get(taskId);
      if (!task) return Promise.resolve(null);
      return Promise.resolve({
        id: task.id,
        status: task.status,
        command: task.command,
        output: task.output,
        createdAt: task.createdAt,
        completedAt: task.completedAt,
      });
    }),

    getOutput: mock((taskId: string) => {
      const task = tasks.get(taskId);
      return Promise.resolve(task?.output || null);
    }),

    listTasks: mock((filter?: { agentName?: string; parentSessionId?: string }) => {
      let taskList = Array.from(tasks.values());
      if (filter?.agentName) {
        taskList = taskList.filter((t) => t.agentName === filter.agentName);
      }
      if (filter?.parentSessionId) {
        taskList = taskList.filter((t) => t.parentSessionId === filter.parentSessionId);
      }
      return Promise.resolve(
        taskList.map((t) => ({
          id: t.id,
          status: t.status,
          command: t.command,
          output: t.output,
          createdAt: t.createdAt,
          completedAt: t.completedAt,
        }))
      );
    }),

    getRunningCount: mock(() => 0),
    getConcurrencyLimit: mock(() => 5),
    setConcurrencyLimit: mock(() => {}),
    onTaskComplete: mock((taskId: string, callback: NotificationCallback) => {
      notifications.set(taskId, callback);
    }),

    _tasks: tasks,
    _completeTask: (taskId: string, output: string) => {
      const task = tasks.get(taskId);
      if (task) {
        task.status = "completed";
        task.output = output;
        task.completedAt = Date.now();
        notify(task);
      }
    },
  } as unknown as BackgroundManager & {
    _tasks: Map<string, MockTask>;
    _completeTask: (taskId: string, output: string) => void;
  };

  return manager;
}

function createMockSkillMcpManager(): MockSkillMcpManager {
  const servers = new Map<string, MockServer>();
  let serverCounter = 0;

  const manager = {
    initializeBuiltinMcps: mock(() => Promise.resolve()),

    loadSkill: mock((skillPath: string) => {
      const skillName = skillPath.split("/").pop()?.replace(".md", "") || "punch";
      const skill: SkillDefinition = {
        name: skillName,
        description: `Punch agent skill: ${skillName}`,
        path: skillPath,
        skillDir: skillPath.replace("/SKILL.md", "").replace(".md", ""),
        content: "Punch agent skill for delegation",
        mcpServers: [
          {
            type: "stdio",
            command: "punch-mcp-server",
            args: ["--agent", "punch"],
          },
        ],
      };
      return Promise.resolve(skill);
    }),

    startMcp: mock((config: McpServerConfig) => {
      serverCounter++;
      const serverId = `punch_mcp_${Date.now()}_${serverCounter}`;
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
        result: {
          success: true,
          agent: "punch",
          data: "Punch agent result",
        },
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
  } as unknown as SkillMcpManager & {
    _servers: Map<string, MockServer>;
  };

  return manager;
}

describe("E2E: Punch Delegation Workflow", () => {
  let mockClient: OpenCodeClient;
  let mockBgManager: MockBackgroundManager;
  let mockSkillManager: MockSkillMcpManager;
  let skillCtx: SkillMcpContext;
  let tempDir: string;

  beforeEach(() => {
    mockClient = createMockOpenCodeClient();
    mockBgManager = createMockBackgroundManager();
    mockSkillManager = createMockSkillMcpManager();
    tempDir = mkdtempSync(join(tmpdir(), "punch-delegation-test-"));
    skillCtx = {
      manager: mockSkillManager,
      skillPaths: [tempDir],
    };
  });

  afterEach(async () => {
    await cleanupAllSkills(mockSkillManager);
    await mockSkillManager.cleanup();
    mockBgManager._tasks.clear();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function createTestSkill(name: string): string {
    const skillContent = `---
name: ${name}
description: Punch agent skill for ${name}
mcp_servers:
  - command: punch-mcp-server
    args: ["--agent", "${name}"]
---

# ${name} Skill

This is the ${name} agent skill.
`;
    const skillPath = join(tempDir, `${name}.md`);
    writeFileSync(skillPath, skillContent);
    return skillPath;
  }

  describe("Load Punch Skill Flow", () => {
    it("should load Punch skill", async () => {
      const skillPath = createTestSkill("punch");

      const params: SkillMcpParams = {
        skill: skillPath,
        action: "load",
      };

      const result = await skillMcp(params, skillCtx);

      expect(result.success).toBe(true);
      expect(result.skillName).toBe("punch");
      expect(result.action).toBe("load");
      expect(result.serverIds?.length).toBeGreaterThan(0);
    });

    it("should load Punch skill from path", async () => {
      const skillPath = createTestSkill("punch");

      const params: SkillMcpParams = {
        skill: skillPath,
        action: "load",
      };

      const result = await skillMcp(params, skillCtx);

      expect(result.success).toBe(true);
      expect(result.skillName).toBe("punch");
    });

    it("should start Punch MCP servers on load", async () => {
      const skillPath = createTestSkill("punch");

      const params: SkillMcpParams = {
        skill: skillPath,
        action: "load",
      };

      const result = await skillMcp(params, skillCtx);

      expect(result.success).toBe(true);
      expect(mockSkillManager.getServerCount()).toBeGreaterThan(0);
    });
  });

  describe("Delegate to Punch Flow", () => {
    it("should delegate task to Punch agent", async () => {
      const input: DelegateTaskInput = {
        task: "Analyze codebase for security vulnerabilities",
        agent: "punch",
        context: "Focus on authentication and authorization code",
        timeout: 45,
      };

      const result = await delegateTask(input, {
        backgroundManager: mockBgManager,
        client: mockClient,
        parentSessionId: "parent_session_123",
      });

      expect(result.taskId).toMatch(/^punch_task_/);
      expect(result.status).toBe("pending");
      expect(result.sessionId).toMatch(/^punch_session_/);
      expect(result.agent).toBe("punch");
    });

    it("should create child session for Punch delegation", async () => {
      const input: DelegateTaskInput = {
        task: "Refactor payment module",
        agent: "punch",
      };

      await delegateTask(input, {
        backgroundManager: mockBgManager,
        client: mockClient,
        parentSessionId: "main_session",
      });

      expect(mockClient.session.create).toHaveBeenCalled();
      const createCall = (mockClient.session.create as ReturnType<typeof mock>).mock.calls[0];
      expect(createCall[0].parentID).toBe("main_session");
    });

    it("should pass context to Punch agent", async () => {
      const input: DelegateTaskInput = {
        task: "Review pull request",
        agent: "punch",
        context: "PR #123: Add new feature to dashboard",
      };

      await delegateTask(input, {
        backgroundManager: mockBgManager,
        client: mockClient,
      });

      expect(mockBgManager.launch).toHaveBeenCalled();
      const launchCall = (mockBgManager.launch as ReturnType<typeof mock>).mock.calls[0];
      expect(launchCall[0].agentName).toBe("punch");
      expect(launchCall[0].context).toBe("PR #123: Add new feature to dashboard");
    });

    it("should delegate multiple tasks to Punch", async () => {
      const tasks = [
        { task: "Task 1: Review code", agent: "punch" },
        { task: "Task 2: Run security scan", agent: "punch" },
        { task: "Task 3: Optimize queries", agent: "punch" },
      ];

      const results = await Promise.all(
        tasks.map((t) =>
          delegateTask(t, {
            backgroundManager: mockBgManager,
            client: mockClient,
            parentSessionId: "batch_session",
          })
        )
      );

      expect(results).toHaveLength(3);
      results.forEach((r) => {
        expect(r.taskId).toMatch(/^punch_task_/);
        expect(r.agent).toBe("punch");
      });
    });
  });

  describe("Get Result Flow", () => {
    it("should get result from Punch delegated task", async () => {
      const input: DelegateTaskInput = {
        task: "Generate test report",
        agent: "punch",
      };

      const delegateResult = await delegateTask(input, {
        backgroundManager: mockBgManager,
        client: mockClient,
      });

      await new Promise((resolve) => setTimeout(resolve, 150));

      const outputResult = await getBackgroundOutput(mockBgManager, {
        taskId: delegateResult.taskId,
        wait: true,
        timeout: 5000,
      });

      expect(outputResult.taskId).toBe(delegateResult.taskId);
      expect(outputResult.status).toBe("completed");
      expect(outputResult.output).toContain("Punch agent completed");
    });

    it("should poll for Punch task completion", async () => {
      const input: DelegateTaskInput = {
        task: "Long analysis task",
        agent: "punch",
        timeout: 60,
      };

      const delegateResult = await delegateTask(input, {
        backgroundManager: mockBgManager,
        client: mockClient,
      });

      let statusChecked = false;
      const checkStatus = async () => {
        const status = await mockBgManager.getStatus(delegateResult.taskId);
        statusChecked = true;
        return status;
      };

      await new Promise((resolve) => setTimeout(resolve, 150));
      const status = await checkStatus();

      expect(statusChecked).toBe(true);
      expect(status?.status).toBe("completed");
    });

    it("should get output with detailed results", async () => {
      const input: DelegateTaskInput = {
        task: "Detailed analysis",
        agent: "punch",
      };

      const delegateResult = await delegateTask(input, {
        backgroundManager: mockBgManager,
        client: mockClient,
      });

      mockBgManager._completeTask(
        delegateResult.taskId,
        JSON.stringify({
          agent: "punch",
          findings: ["Issue 1", "Issue 2"],
          recommendations: ["Fix 1", "Fix 2"],
          summary: "Analysis complete",
        })
      );

      const outputResult = await getBackgroundOutput(mockBgManager, {
        taskId: delegateResult.taskId,
        wait: true,
        timeout: 1000,
      });

      expect(outputResult.status).toBe("completed");
      expect(outputResult.output).toContain("punch");
    });
  });

  describe("End-to-End Complete Workflow", () => {
    it("should complete full Punch workflow: load → delegate → get result", async () => {
      const skillPath = createTestSkill("punch");

      const skillResult = await skillMcp(
        { skill: skillPath, action: "load" },
        skillCtx
      );

      expect(skillResult.success).toBe(true);
      expect(skillResult.skillName).toBe("punch");

      const invokeResult = await skillMcp(
        {
          skill: skillResult.skillName,
          action: "invoke",
          tool: "configure",
          params: { mode: "security", level: "deep" },
        },
        skillCtx
      );

      expect(invokeResult.success).toBe(true);

      const delegateInput: DelegateTaskInput = {
        task: "Perform comprehensive security audit",
        agent: "punch",
        context: "Scan all authentication and payment modules",
        timeout: 120,
      };

      const delegateResult = await delegateTask(delegateInput, {
        backgroundManager: mockBgManager,
        client: mockClient,
        parentSessionId: "punch_parent_session",
      });

      expect(delegateResult.taskId).toBeDefined();
      expect(delegateResult.sessionId).toBeDefined();
      expect(delegateResult.status).toBe("pending");

      await new Promise((resolve) => setTimeout(resolve, 200));

      mockBgManager._completeTask(
        delegateResult.taskId,
        JSON.stringify({
          agent: "punch",
          status: "success",
          vulnerabilitiesFound: 3,
          critical: 0,
          high: 1,
          medium: 2,
          report: "Security audit completed successfully",
        })
      );

      const outputResult = await getBackgroundOutput(mockBgManager, {
        taskId: delegateResult.taskId,
        wait: true,
        timeout: 1000,
      });

      expect(outputResult.status).toBe("completed");
      expect(outputResult.output).toContain("punch");
      expect(outputResult.output).toContain("Security audit completed");

      const punchTasks = await mockBgManager.listTasks({ agentName: "punch" });
      expect(punchTasks.length).toBeGreaterThan(0);
      expect(punchTasks[0].id).toBe(delegateResult.taskId);
    });

    it("should handle Punch delegation with MCP tool invocation", async () => {
      const skillPath = createTestSkill("punch");

      await skillMcp({ skill: skillPath, action: "load" }, skillCtx);

      const toolResults: { success: boolean }[] = [];
      const tools = ["analyze", "scan", "report"];

      for (const tool of tools) {
        const result = await skillMcp(
          {
            skill: "punch",
            action: "invoke",
            tool,
            params: { target: "src/" },
          },
          skillCtx
        );
        toolResults.push(result);
      }

      toolResults.forEach((r) => {
        expect(r.success).toBe(true);
      });

      const delegateResult = await delegateTask(
        {
          task: "Execute full security pipeline",
          agent: "punch",
          context: "Run all analysis tools in sequence",
        },
        {
          backgroundManager: mockBgManager,
          client: mockClient,
        }
      );

      expect(delegateResult.taskId).toBeDefined();

      await new Promise((resolve) => setTimeout(resolve, 150));

      const output = await getBackgroundOutput(mockBgManager, {
        taskId: delegateResult.taskId,
        wait: true,
        timeout: 1000,
      });

      expect(output.status).toBe("completed");
    });
  });

  describe("Troop Delegation (Multiple Agents)", () => {
    it("should delegate to multiple agents including Punch", async () => {
      const agents = ["punch", "tasker", "harambe"];
      const results = await Promise.all(
        agents.map((agent) =>
          delegateTask(
            {
              task: `Task for ${agent}`,
              agent,
            },
            {
              backgroundManager: mockBgManager,
              client: mockClient,
              parentSessionId: "troop_session",
            }
          )
        )
      );

      expect(results).toHaveLength(3);

      results.forEach((r, i) => {
        expect(r.taskId).toBeDefined();
        expect(r.agent).toBe(agents[i]);
      });

      const punchResult = results.find((r) => r.agent === "punch");
      expect(punchResult).toBeDefined();
    });

    it("should get results from all troop members", async () => {
      const tasks = [
        { task: "Security scan", agent: "punch" },
        { task: "Code review", agent: "tasker" },
        { task: "Testing", agent: "harambe" },
      ];

      const delegateResults = await Promise.all(
        tasks.map((t) =>
          delegateTask(t, {
            backgroundManager: mockBgManager,
            client: mockClient,
          })
        )
      );

      await new Promise((resolve) => setTimeout(resolve, 200));

      delegateResults.forEach((r, i) => {
        mockBgManager._completeTask(
          r.taskId,
          `Result from ${tasks[i].agent}: Success`
        );
      });

      const outputs = await Promise.all(
        delegateResults.map((r) =>
          getBackgroundOutput(mockBgManager, {
            taskId: r.taskId,
            wait: true,
            timeout: 1000,
          })
        )
      );

      outputs.forEach((o, i) => {
        expect(o.status).toBe("completed");
        expect(o.output).toContain(tasks[i].agent);
      });
    });
  });

  describe("Error Handling", () => {
    it("should handle Punch skill load failure", async () => {
      const result = await skillMcp(
        { skill: "/nonexistent/punch.md", action: "load" },
        skillCtx
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should handle delegation failure", async () => {
      mockClient.session.create = mock(() =>
        Promise.resolve({ data: undefined })
      );

      expect(
        delegateTask(
          { task: "Will fail", agent: "punch" },
          {
            backgroundManager: mockBgManager,
            client: mockClient,
          }
        )
      ).rejects.toThrow("Failed to create child session");
    });

    it("should handle Punch task failure", async () => {
      const delegateResult = await delegateTask(
        { task: "Failing task", agent: "punch" },
        {
          backgroundManager: mockBgManager,
          client: mockClient,
        }
      );

      const task = mockBgManager._tasks.get(delegateResult.taskId);
      if (task) {
        task.status = "failed";
        task.error = "Punch agent encountered an error";
        task.completedAt = Date.now();
      }

      const output = await getBackgroundOutput(mockBgManager, {
        taskId: delegateResult.taskId,
        wait: false,
      });

      expect(output.status).toBe("failed");
    });

    it("should handle MCP tool invocation failure", async () => {
      const skillPath = createTestSkill("punch");

      await skillMcp({ skill: skillPath, action: "load" }, skillCtx);

      mockSkillManager.sendJsonRpc = mock(() => {
        throw new Error("Punch MCP server error");
      });

      const result = await skillMcp(
        {
          skill: "punch",
          action: "invoke",
          tool: "failing-tool",
        },
        skillCtx
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Punch MCP server error");
    });
  });

  describe("Integration with Other Components", () => {
    it("should work with Punch after loading other skills", async () => {
      const gitPath = createTestSkill("git-master");
      const punchPath = createTestSkill("punch");

      await skillMcp({ skill: gitPath, action: "load" }, skillCtx);

      const punchResult = await skillMcp(
        { skill: punchPath, action: "load" },
        skillCtx
      );

      expect(punchResult.success).toBe(true);

      const delegateResult = await delegateTask(
        { task: "Git security audit", agent: "punch" },
        {
          backgroundManager: mockBgManager,
          client: mockClient,
        }
      );

      expect(delegateResult.taskId).toBeDefined();
    });

    it("should maintain Punch state across operations", async () => {
      const skillPath = createTestSkill("punch");

      await skillMcp({ skill: skillPath, action: "load" }, skillCtx);

      const toolResult = await skillMcp(
        {
          skill: "punch",
          action: "invoke",
          tool: "status",
        },
        skillCtx
      );

      expect(toolResult.success).toBe(true);

      const delegateResult = await delegateTask(
        { task: "Task with loaded skill", agent: "punch" },
        {
          backgroundManager: mockBgManager,
          client: mockClient,
        }
      );

      const hasConnectedServer = mockSkillManager.getAllServers().some(
        (s) => s.connected
      );
      expect(hasConnectedServer).toBe(true);
      expect(delegateResult.taskId).toBeDefined();
    });
  });
});
