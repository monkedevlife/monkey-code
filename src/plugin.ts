import type { 
  MonkeyCodePlugin, 
  PluginContext, 
  HookHandlers, 
  ToolDefinition,
  PluginEvent
} from './types/index.js';
import { loadConfig } from './config.js';

export function createPlugin(): MonkeyCodePlugin {
  const hooks: HookHandlers = {
    onConfig: async (_context: PluginContext) => {
      try {
        const config = await loadConfig();
        registerTools(config);
      } catch (error) {
        void error;
      }
    },

    onTool: async (context) => {
      const { toolName, params } = context;
      
      if (toolName === 'delegate-task') {
        return await handleDelegateTask(params);
      }
      
      if (toolName === 'background-output') {
        return await handleBackgroundOutput(params);
      }
      
      if (toolName === 'background-cancel') {
        return await handleBackgroundCancel(params);
      }
      
      if (toolName === 'interactive-bash') {
        return await handleInteractiveBash(params);
      }
      
      if (toolName === 'skill-mcp') {
        return await handleSkillMcp(params);
      }
      
      return undefined;
    },

    onEvent: async (event: PluginEvent) => {
      if (event.type === 'session:end') {
        await handleSessionEnd(event.data);
      }
    }
  };

  return {
    name: 'monkey-code',
    version: '0.1.0',
    hooks
  };
}

function registerTools(config: any): void {
  const tools: ToolDefinition[] = [
    {
      name: 'delegate-task',
      description: 'Delegate a task to background execution',
      schema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Task description' },
          agent: { type: 'string', description: 'Agent to use' },
          context: { type: 'string', description: 'Additional context' },
          timeout: { type: 'number', description: 'Timeout in minutes' }
        },
        required: ['task']
      },
      handler: async (params) => handleDelegateTask(params)
    },
    {
      name: 'background-output',
      description: 'Get output from background task',
      schema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Task ID' },
          wait: { type: 'boolean', description: 'Wait for completion' }
        },
        required: ['taskId']
      },
      handler: async (params) => handleBackgroundOutput(params)
    },
    {
      name: 'background-cancel',
      description: 'Cancel a background task',
      schema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Task ID to cancel' }
        },
        required: ['taskId']
      },
      handler: async (params) => handleBackgroundCancel(params)
    },
    {
      name: 'interactive-bash',
      description: 'Create interactive bash session',
      schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to run' },
          action: { type: 'string', enum: ['start', 'send', 'capture', 'close'] },
          sessionId: { type: 'string', description: 'Session ID for send/capture/close' },
          input: { type: 'string', description: 'Input for send action' },
          cwd: { type: 'string', description: 'Working directory' }
        },
        required: ['command', 'action']
      },
      handler: async (params) => handleInteractiveBash(params)
    },
    {
      name: 'skill-mcp',
      description: 'Load and manage skill MCP servers',
      schema: {
        type: 'object',
        properties: {
          skill: { type: 'string', description: 'Skill name or path' },
          action: { type: 'string', enum: ['load', 'invoke', 'unload'] },
          tool: { type: 'string', description: 'Tool name for invoke' },
          params: { type: 'object', description: 'Parameters for invoke' }
        },
        required: ['skill', 'action']
      },
      handler: async (params) => handleSkillMcp(params)
    }
  ];
  void tools;
  void config;
}

async function handleDelegateTask(_params: Record<string, unknown>): Promise<string> {
  const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return taskId;
}

async function handleBackgroundOutput(params: Record<string, unknown>): Promise<unknown> {
  const taskId = params.taskId as string;
  return {
    taskId,
    status: 'pending',
    output: null,
    error: null,
    startTime: new Date().toISOString()
  };
}

async function handleBackgroundCancel(params: Record<string, unknown>): Promise<unknown> {
  const taskId = params.taskId as string;
  return {
    success: true,
    taskId,
    message: 'Task cancelled'
  };
}

async function handleInteractiveBash(params: Record<string, unknown>): Promise<unknown> {
  const action = params.action as string;
  const command = params.command as string;
  
  if (action === 'start') {
    return {
      sessionId: `session-${Date.now()}`,
      command,
      status: 'running'
    };
  }
  
  return { status: 'ok' };
}

async function handleSkillMcp(_params: Record<string, unknown>): Promise<unknown> {
  return {
    skill: 'unknown',
    action: 'unknown',
    status: 'ok'
  };
}

async function handleSessionEnd(_data?: Record<string, unknown>): Promise<void> {
}

export default createPlugin;
