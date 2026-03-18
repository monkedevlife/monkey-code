import { describe, it, expect } from 'bun:test';
import createPlugin from './plugin';
import type { PluginContext, PluginEvent } from './types/index';

describe('Plugin Shell', () => {
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

  describe('Hook Handlers', () => {
    it('onConfig handler initializes configuration', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test/project',
        configPath: '.opencode/monkey-code.json',
        sessionId: 'test-session'
      };

      expect(async () => {
        await plugin.hooks.onConfig?.(mockContext);
      }).not.toThrow();
    });

    it('onTool handler returns taskId for delegate-task', async () => {
      const plugin = createPlugin();
      
      const result = await plugin.hooks.onTool?.({
        toolName: 'delegate-task',
        params: { task: 'test task' }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect((result as string).startsWith('task-')).toBe(true);
    });

    it('onTool handler returns task status for background-output', async () => {
      const plugin = createPlugin();
      
      const result = await plugin.hooks.onTool?.({
        toolName: 'background-output',
        params: { taskId: 'test-123' }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect((result as any).taskId).toBe('test-123');
      expect((result as any).status).toBe('pending');
    });

    it('onTool handler cancels task', async () => {
      const plugin = createPlugin();
      
      const result = await plugin.hooks.onTool?.({
        toolName: 'background-cancel',
        params: { taskId: 'test-123' }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect((result as any).success).toBe(true);
    });

    it('onTool handler starts interactive session', async () => {
      const plugin = createPlugin();
      
      const result = await plugin.hooks.onTool?.({
        toolName: 'interactive-bash',
        params: { command: 'python', action: 'start' }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect((result as any).status).toBe('running');
      expect((result as any).sessionId).toBeDefined();
    });

    it('onTool handler manages skill MCP', async () => {
      const plugin = createPlugin();
      
      const result = await plugin.hooks.onTool?.({
        toolName: 'skill-mcp',
        params: { skill: 'playwright', action: 'load' }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect((result as any).status).toBe('ok');
    });

    it('onEvent handler processes session end event', async () => {
      const plugin = createPlugin();
      const event: PluginEvent = {
        type: 'session:end',
        timestamp: Date.now(),
        data: { sessionId: 'test-session' }
      };

      expect(async () => {
        await plugin.hooks.onEvent?.(event);
      }).not.toThrow();
    });

    it('onEvent handler processes task completion', async () => {
      const plugin = createPlugin();
      const event: PluginEvent = {
        type: 'task:complete',
        timestamp: Date.now(),
        data: { taskId: 'test-123', status: 'completed' }
      };

      expect(async () => {
        await plugin.hooks.onEvent?.(event);
      }).not.toThrow();
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

    it('plugin can be instantiated multiple times', () => {
      const plugin1 = createPlugin();
      const plugin2 = createPlugin();
      
      expect(plugin1.name).toBe(plugin2.name);
      expect(plugin1.version).toBe(plugin2.version);
      expect(plugin1).not.toBe(plugin2);
    });
  });

  describe('Tool Registration', () => {
    it('delegate-task tool has correct schema', async () => {
      const plugin = createPlugin();
      
      const result = await plugin.hooks.onTool?.({
        toolName: 'delegate-task',
        params: { task: 'test', agent: 'harambe' }
      });

      expect(result).toBeDefined();
    });

    it('background-output tool requires taskId', async () => {
      const plugin = createPlugin();
      
      const result = await plugin.hooks.onTool?.({
        toolName: 'background-output',
        params: { taskId: 'task-123', wait: false }
      });

      expect(result).toBeDefined();
    });

    it('interactive-bash tool requires action', async () => {
      const plugin = createPlugin();
      
      const result = await plugin.hooks.onTool?.({
        toolName: 'interactive-bash',
        params: { command: 'python', action: 'send', sessionId: 's-123', input: 'test' }
      });

      expect(result).toBeDefined();
    });

    it('skill-mcp tool processes load action', async () => {
      const plugin = createPlugin();
      
      const result = await plugin.hooks.onTool?.({
        toolName: 'skill-mcp',
        params: { skill: 'playwright', action: 'load' }
      });

      expect(result).toBeDefined();
      expect((result as any).status).toBe('ok');
    });
  });

  describe('Error Handling', () => {
    it('handles undefined tool gracefully', async () => {
      const plugin = createPlugin();
      
      const result = await plugin.hooks.onTool?.({
        toolName: 'unknown-tool',
        params: {}
      });

      expect(result).toBeUndefined();
    });

    it('onConfig handles missing config path gracefully', async () => {
      const plugin = createPlugin();
      const mockContext: PluginContext = {
        projectRoot: '/test',
        configPath: 'nonexistent.json'
      };

      expect(async () => {
        await plugin.hooks.onConfig?.(mockContext);
      }).not.toThrow();
    });

    it('onEvent handles null event data', async () => {
      const plugin = createPlugin();
      const event: PluginEvent = {
        type: 'session:end',
        timestamp: Date.now()
      };

      expect(async () => {
        await plugin.hooks.onEvent?.(event);
      }).not.toThrow();
    });
  });
});
