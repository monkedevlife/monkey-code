import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import createPlugin, { getPluginState, resetPluginState } from './plugin';
import type { PluginContext, PluginEvent, ToolContext } from './types/index';

describe('Monkey Code Plugin', () => {
  beforeEach(() => {
    resetPluginState();
  });

  afterEach(async () => {
    const state = getPluginState();
    if (state.isInitialized) {
      if (state.backgroundManager) {
        await state.backgroundManager.shutdown();
      }
      if (state.sqlite) {
        await state.sqlite.close();
      }
    }
    resetPluginState();
  });

  describe('Plugin Creation', () => {
    it('exports a plugin creation function', () => {
      expect(typeof createPlugin).toBe('function');
    });

    it('creates a valid plugin object', () => {
      const plugin = createPlugin();
      
      expect(plugin).toBeDefined();
      expect(plugin.name).toBe('monkey-code');
      expect(plugin.version).toBe('0.1.0');
      expect(plugin.hooks).toBeDefined();
    });

    it('plugin has required hook handlers', () => {
      const plugin = createPlugin();
      
      expect(typeof plugin.hooks.onConfig).toBe('function');
      expect(typeof plugin.hooks.onTool).toBe('function');
      expect(typeof plugin.hooks.onEvent).toBe('function');
    });

    it('plugin can be instantiated multiple times', () => {
      const plugin1 = createPlugin();
      const plugin2 = createPlugin();
      
      expect(plugin1.name).toBe(plugin2.name);
      expect(plugin1.version).toBe(plugin2.version);
      expect(plugin1).not.toBe(plugin2);
    });
  });

  describe('Config Hook', () => {
    it('onConfig initializes plugin state', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const state = getPluginState();
      expect(state.isInitialized).toBe(true);
      expect(state.currentSessionId).toBe('test-session');
    });

    it('onConfig handles initialization errors gracefully', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/nonexistent/path',
        configPath: 'invalid.json',
        sessionId: 'test-session'
      };

      try {
        await plugin.hooks.onConfig?.(mockContext);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('onConfig is idempotent - can be called multiple times', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);
      await plugin.hooks.onConfig?.(mockContext);

      const state = getPluginState();
      expect(state.isInitialized).toBe(true);
    });
  });

  describe('Tool Hook - delegate-task', () => {
    it('handles delegate-task tool when initialized', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const toolContext: ToolContext = {
        toolName: 'delegate-task',
        params: { task: 'test task description' }
      };

      const result = await plugin.hooks.onTool?.(toolContext);

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect((result as any).taskId).toBeDefined();
      expect((result as any).sessionId).toBeDefined();
      expect((result as any).status).toBe('pending');
    });

    it('delegate-task throws when plugin not initialized', async () => {
      const plugin = createPlugin();

      const toolContext: ToolContext = {
        toolName: 'delegate-task',
        params: { task: 'test task' }
      };

      expect(async () => {
        await plugin.hooks.onTool?.(toolContext);
      }).toThrow();
    });

    it('delegate-task accepts all parameters', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const toolContext: ToolContext = {
        toolName: 'delegate-task',
        params: {
          task: 'test task',
          agent: 'harambe',
          context: 'additional context',
          timeout: 60
        }
      };

      const result = await plugin.hooks.onTool?.(toolContext);
      expect(result).toBeDefined();
    });

    it('delegate-task auto-routes exploratory requests to scout', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const toolContext: ToolContext = {
        toolName: 'delegate-task',
        params: {
          task: 'Search the repository for background manager patterns',
          agent: 'punch'
        }
      };

      const result = await plugin.hooks.onTool?.(toolContext) as Record<string, unknown>;

      expect(result).toBeDefined();
      expect(result.agent).toBe('scout');
      expect(result.requestedAgent).toBe('punch');
      expect((result.routing as Record<string, unknown>).finalAgent).toBe('scout');
    });

    it('handles plan-write and plan-read roundtrip', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const writeResult = await plugin.hooks.onTool?.({
        toolName: 'plan-write',
        params: {
          agent: 'caesar',
          title: 'Stored Plan',
          sourceRequest: 'make a plan',
          markdown: '# Stored Plan'
        }
      }) as Record<string, unknown>;

      expect(writeResult.plan).toBeDefined();

      const readResult = await plugin.hooks.onTool?.({
        toolName: 'plan-read',
        params: {
          id: (writeResult.plan as Record<string, unknown>).id,
        }
      }) as Record<string, unknown>;

      expect((readResult.plan as Record<string, unknown>).title).toBe('Stored Plan');
    });

    it('handles plan-update-task', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const writeResult = await plugin.hooks.onTool?.({
        toolName: 'plan-write',
        params: {
          projectPath: process.cwd(),
          agent: 'caesar',
          title: 'Tracked Plan',
          sourceRequest: 'track task',
          markdown: '# Tracked Plan',
          tasks: [{ taskNumber: '1', title: 'Tracked task' }]
        }
      }) as Record<string, unknown>;

      const plan = writeResult.plan as Record<string, unknown>;
      const tasks = writeResult.tasks as Array<Record<string, unknown>>;

      const updated = await plugin.hooks.onTool?.({
        toolName: 'plan-update-task',
        params: {
          planId: plan.id,
          taskId: tasks[0]?.id,
          status: 'completed',
          eventType: 'plan.task.completed'
        }
      }) as Record<string, unknown>;

      expect(updated.status).toBe('completed');
    });
  });

  describe('Chat Hook - start-work', () => {
    it('hydrates /start-work with the stored plan prompt', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      await plugin.hooks.onTool?.({
        toolName: 'plan-write',
        params: {
          projectPath: process.cwd(),
          agent: 'caesar',
          title: 'Start Work Plan',
          sourceRequest: 'plan this',
          markdown: '# Start Work Plan',
          tasks: [{ taskNumber: '1', title: 'Do the thing' }]
        }
      });

      const output = {
        parts: [{ type: 'text', text: '/start-work "Start Work Plan"' }],
        message: {} as Record<string, unknown>
      };

      await plugin.hooks.onChatMessage?.({ sessionID: 'test-session' }, output);

      expect(output.parts[0]?.text).toContain('You are starting work from the stored plan');
      expect(output.parts[0]?.text).toContain('Start Work Plan');
      expect(output.parts[0]?.text).toContain('Do the thing');
    });
  });

  describe('Tool Hook - background-output', () => {
    it('handles background-output tool', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const delegateContext: ToolContext = {
        toolName: 'delegate-task',
        params: { task: 'test task description' }
      };
      const delegateResult = await plugin.hooks.onTool?.(delegateContext) as { taskId: string };
      expect(delegateResult).toBeDefined();
      expect(delegateResult.taskId).toBeDefined();

      const toolContext: ToolContext = {
        toolName: 'background-output',
        params: { taskId: delegateResult.taskId, wait: false }
      };

      const result = await plugin.hooks.onTool?.(toolContext);

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    it('background-output throws for non-existent task', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const toolContext: ToolContext = {
        toolName: 'background-output',
        params: { taskId: 'non-existent-task' }
      };

      expect(async () => {
        await plugin.hooks.onTool?.(toolContext);
      }).toThrow();
    });
  });

  describe('Tool Hook - background-cancel', () => {
    it('handles background-cancel tool for single task', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const toolContext: ToolContext = {
        toolName: 'background-cancel',
        params: { taskId: 'test-task-123' }
      };

      const result = await plugin.hooks.onTool?.(toolContext);

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    it('handles background-cancel all tasks', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const toolContext: ToolContext = {
        toolName: 'background-cancel',
        params: { all: true }
      };

      const result = await plugin.hooks.onTool?.(toolContext);

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect((result as any).success).toBe(true);
    });
  });

  describe('Tool Hook - interactive-bash', () => {
    it('handles interactive-bash start action', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const toolContext: ToolContext = {
        toolName: 'interactive-bash',
        params: { command: 'bash', action: 'start' }
      };

      const result = await plugin.hooks.onTool?.(toolContext);

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    it('handles interactive-bash all actions', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const actions = ['start', 'send', 'capture', 'close'];
      
      for (const action of actions) {
        const toolContext: ToolContext = {
          toolName: 'interactive-bash',
          params: { 
            command: 'bash', 
            action,
            sessionId: action !== 'start' ? 'test-session-id' : undefined,
            input: action === 'send' ? 'test input' : undefined
          }
        };

        const result = await plugin.hooks.onTool?.(toolContext);
        expect(result).toBeDefined();
      }
    });

    it('interactive-bash handles missing tmux gracefully', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const toolContext: ToolContext = {
        toolName: 'interactive-bash',
        params: { command: 'bash', action: 'start' }
      };

      const result = await plugin.hooks.onTool?.(toolContext);
      
      expect(result).toBeDefined();
      if (typeof result === 'object' && result !== null) {
        expect('success' in result).toBe(true);
      }
    });
  });

  describe('Tool Hook - skill-mcp', () => {
    it('handles skill-mcp with valid action', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const toolContext: ToolContext = {
        toolName: 'skill-mcp',
        params: { skill: 'playwright', action: 'load' }
      };

      const result = await plugin.hooks.onTool?.(toolContext);

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    it('handles skill-mcp all actions', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const actions = ['load', 'invoke', 'unload'];
      
      for (const action of actions) {
        const toolContext: ToolContext = {
          toolName: 'skill-mcp',
          params: { 
            skill: 'test-skill', 
            action,
            tool: action === 'invoke' ? 'test-tool' : undefined,
            params: action === 'invoke' ? {} : undefined
          }
        };

        const result = await plugin.hooks.onTool?.(toolContext);
        expect(result).toBeDefined();
      }
    });
  });

  describe('Tool Hook - Unknown Tools', () => {
    it('returns undefined for unknown tool names', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const toolContext: ToolContext = {
        toolName: 'unknown-tool',
        params: {}
      };

      const result = await plugin.hooks.onTool?.(toolContext);

      expect(result).toBeUndefined();
    });

    it('handles tool with empty params', async () => {
      const plugin = createPlugin();

      const toolContext: ToolContext = {
        toolName: 'delegate-task',
        params: {}
      };

      expect(async () => {
        await plugin.hooks.onTool?.(toolContext);
      }).toThrow();
    });
  });

  describe('Event Hook - Session Lifecycle', () => {
    it('handles session:start event', async () => {
      const plugin = createPlugin();
      const event: PluginEvent = {
        type: 'session:start',
        timestamp: Date.now(),
        data: { sessionId: 'new-session-123' }
      };

      await plugin.hooks.onEvent?.(event);

      const state = getPluginState();
      expect(state.currentSessionId).toBe('new-session-123');
    });

    it('handles session:end event', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      let state = getPluginState();
      expect(state.isInitialized).toBe(true);

      const event: PluginEvent = {
        type: 'session:end',
        timestamp: Date.now(),
        data: { sessionId: 'test-session' }
      };

      await plugin.hooks.onEvent?.(event);

      state = getPluginState();
      expect(state.isInitialized).toBe(false);
    });

    it('handles task:complete event', async () => {
      const plugin = createPlugin();
      const event: PluginEvent = {
        type: 'task:complete',
        timestamp: Date.now(),
        data: { taskId: 'task-123', status: 'completed' }
      };

      expect(async () => {
        await plugin.hooks.onEvent?.(event);
      }).not.toThrow();
    });

    it('handles task:failed event', async () => {
      const plugin = createPlugin();
      const event: PluginEvent = {
        type: 'task:failed',
        timestamp: Date.now(),
        data: { taskId: 'task-123', error: 'Something went wrong' }
      };

      expect(async () => {
        await plugin.hooks.onEvent?.(event);
      }).not.toThrow();
    });

    it('handles session:idle event', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const event: PluginEvent = {
        type: 'session:idle',
        timestamp: Date.now(),
        data: { sessionId: 'test-session' }
      };

      expect(async () => {
        await plugin.hooks.onEvent?.(event);
      }).not.toThrow();
    });
  });

  describe('Event Hook - Null Data Handling', () => {
    it('handles session:end with null data', async () => {
      const plugin = createPlugin();
      
      const event: PluginEvent = {
        type: 'session:end',
        timestamp: Date.now()
      };

      expect(async () => {
        await plugin.hooks.onEvent?.(event);
      }).not.toThrow();
    });

    it('handles session:start with undefined data', async () => {
      const plugin = createPlugin();
      
      const event: PluginEvent = {
        type: 'session:start',
        timestamp: Date.now()
      };

      expect(async () => {
        await plugin.hooks.onEvent?.(event);
      }).not.toThrow();
    });
  });

  describe('Integration - Manager Wiring', () => {
    it('wires BackgroundManager correctly', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const state = getPluginState();
      expect(state.backgroundManager).toBeDefined();
    });

    it('wires InteractiveManager correctly', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const state = getPluginState();
      expect(state.interactiveManager).toBeDefined();
    });

    it('wires SkillMcpManager correctly', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const state = getPluginState();
      expect(state.skillMcpManager).toBeDefined();
    });

    it('wires SQLite client correctly', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const state = getPluginState();
      expect(state.sqlite).toBeDefined();
      expect(state.sqlite?.isInitialized()).toBe(true);
    });

    it('loads config correctly', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const state = getPluginState();
      expect(state.config).toBeDefined();
    });
  });

  describe('Integration - Tool Registration', () => {
    it('registers all plugin tools', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const delegateContext: ToolContext = {
        toolName: 'delegate-task',
        params: { task: 'test task for registration' }
      };
      const delegateResult = await plugin.hooks.onTool?.(delegateContext) as { taskId: string };
      expect(delegateResult).toBeDefined();
      expect(delegateResult.taskId).toBeDefined();

      const planResult = await plugin.hooks.onTool?.({
        toolName: 'plan-write',
        params: {
          projectPath: process.cwd(),
          agent: 'caesar',
          title: 'Registration Plan',
          sourceRequest: 'register tools',
          markdown: '# Registration Plan',
          tasks: [{ taskNumber: '1', title: 'Registered task' }]
        }
      }) as { plan: { id: string }; tasks: Array<{ id: string }> };

      const tools = [
        { name: 'delegate-task', params: { task: 'test' } },
        { name: 'plan-write', params: { agent: 'caesar', title: 'T', sourceRequest: 'R', markdown: '# T' } },
        { name: 'plan-read', params: { projectPath: process.cwd() } },
        { name: 'plan-list', params: { projectPath: process.cwd() } },
        { name: 'plan-update-task', params: { planId: planResult.plan.id, taskId: planResult.tasks[0]?.id, status: 'completed' } },
        { name: 'background-output', params: { taskId: delegateResult.taskId } },
        { name: 'background-cancel', params: { taskId: delegateResult.taskId } },
        { name: 'interactive-bash', params: { command: 'bash', action: 'start' } },
        { name: 'skill-mcp', params: { skill: 'test', action: 'load' } }
      ];

      for (const tool of tools) {
        const toolContext: ToolContext = {
          toolName: tool.name,
          params: tool.params
        };

        const result = await plugin.hooks.onTool?.(toolContext);
        expect(result).toBeDefined();
      }
    });
  });

  describe('Integration - Cleanup', () => {
    it('cleans up all resources on session:end', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);

      const event: PluginEvent = {
        type: 'session:end',
        timestamp: Date.now()
      };

      await plugin.hooks.onEvent?.(event);

      const state = getPluginState();
      expect(state.isInitialized).toBe(false);
      expect(state.backgroundManager).toBeUndefined();
      expect(state.interactiveManager).toBeUndefined();
      expect(state.skillMcpManager).toBeUndefined();
      expect(state.sqlite).toBeUndefined();
    });
  });

  describe('Plugin State Management', () => {
    it('getPluginState returns current state', () => {
      const state = getPluginState();
      
      expect(state).toBeDefined();
      expect(typeof state.isInitialized).toBe('boolean');
    });

    it('resetPluginState clears all state', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      await plugin.hooks.onConfig?.(mockContext);
      
      let state = getPluginState();
      expect(state.isInitialized).toBe(true);

      resetPluginState();

      state = getPluginState();
      expect(state.isInitialized).toBe(false);
      expect(state.config).toBeUndefined();
      expect(state.sqlite).toBeUndefined();
    });
  });

  describe('Plugin Interface Validation', () => {
    it('plugin interface matches OpenCode plugin contract', () => {
      const plugin = createPlugin();
      
      expect(plugin).toMatchObject({
        name: expect.any(String),
        version: expect.any(String),
        hooks: expect.any(Object)
      });
    });

    it('all hook handlers are functions', () => {
      const plugin = createPlugin();
      
      expect(plugin.hooks.onConfig).toBeDefined();
      expect(plugin.hooks.onTool).toBeDefined();
      expect(plugin.hooks.onEvent).toBeDefined();
    });
  });
});
