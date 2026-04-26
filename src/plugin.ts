import type { 
  MonkeyCodePlugin, 
  PluginContext, 
  HookHandlers, 
  ToolDefinition,
  PluginEvent,
  ToolContext
} from './types/index.js';
import { loadConfig, getConfigPaths, type Config, type McpsConfig } from './config.js';
import { createSQLiteClient, SQLiteClient } from './utils/sqlite-client.js';
import { createBackgroundManager, BackgroundManager, type BackgroundManagerConfig } from './managers/BackgroundManager.js';
import { createInteractiveManager, InteractiveManager } from './managers/InteractiveManager.js';
import { createSkillMcpManager, SkillMcpManager, type SkillMcpManagerOptions } from './managers/SkillMcpManager.js';
import { delegateTask, type DelegateTaskInput, type DelegateTaskOutput, delegateTaskSchema } from './tools/delegate-task.js';
import { getBackgroundOutput, type BackgroundOutputParams, type BackgroundOutputResult } from './tools/background-output.js';
import { createBackgroundCancelTool, type BackgroundCancelParams, type BackgroundCancelResult } from './tools/background-cancel.js';
import { interactiveBash, type InteractiveBashInput, type InteractiveBashOutput, interactiveBashSchema, cleanupSessions } from './tools/interactive-bash.js';
import { skillMcp, type SkillMcpParams, type SkillMcpResult, skillMcpSchema, cleanupAllSkills } from './tools/skill-mcp.js';
import { writePlan, readPlan, listPlans, type PlanWriteInput, type PlanReadInput, type PlanListInput } from './tools/plan-store.js';
import { updatePlanTaskState } from './tools/plan-store.js';
import { createStartWorkHook } from './hooks/start-work.js';
import { createPlanContinuationHook } from './hooks/plan-continuation.js';
import { createStopAllHook } from './hooks/stop-all.js';
import { handleChatParams } from './hooks/chat-params.js';

interface PluginState {
  config?: Config;
  sqlite?: SQLiteClient;
  backgroundManager?: BackgroundManager;
  interactiveManager?: InteractiveManager;
  skillMcpManager?: SkillMcpManager;
  backgroundCancelTool?: Awaited<ReturnType<typeof createBackgroundCancelTool>>;
  currentSessionId?: string;
  isInitialized: boolean;
}

const pluginState: PluginState = {
  isInitialized: false
};

async function initializePlugin(context: PluginContext): Promise<void> {
  if (pluginState.isInitialized) {
    return;
  }

  const config = await loadConfig();
  pluginState.config = config;

  const paths = getConfigPaths();
  const sqlite = createSQLiteClient(paths.dbPath);
  await sqlite.initialize();
  pluginState.sqlite = sqlite;

  const backgroundConfig: BackgroundManagerConfig = {
    concurrencyLimit: config.background?.maxConcurrent ?? 5,
    pollIntervalMs: config.background?.pollInterval ?? 5000
  };
  const backgroundManager = createBackgroundManager(sqlite, backgroundConfig);
  await backgroundManager.initialize();
  pluginState.backgroundManager = backgroundManager;

  const interactiveManager = createInteractiveManager();
  pluginState.interactiveManager = interactiveManager;

  const skillMcpOptions: SkillMcpManagerOptions = {
    builtinConfig: config.mcps as McpsConfig,
    sessionId: context.sessionId
  };
  const skillMcpManager = createSkillMcpManager(skillMcpOptions);
  try {
    await skillMcpManager.initializeBuiltinMcps();
  } catch (error) {
    console.warn('[monkey-code] Failed to initialize some builtin MCPs:', error instanceof Error ? error.message : String(error));
  }
  pluginState.skillMcpManager = skillMcpManager;

  const backgroundCancelTool = await createBackgroundCancelTool(backgroundManager, sqlite);
  pluginState.backgroundCancelTool = backgroundCancelTool;

  pluginState.currentSessionId = context.sessionId;
  pluginState.isInitialized = true;
}

async function shutdownPlugin(): Promise<void> {
  if (!pluginState.isInitialized) {
    return;
  }

  if (pluginState.interactiveManager) {
    await cleanupSessions({ manager: pluginState.interactiveManager });
  }

  if (pluginState.skillMcpManager) {
    await cleanupAllSkills(pluginState.skillMcpManager);
    await pluginState.skillMcpManager.cleanup();
  }

  if (pluginState.backgroundManager) {
    await pluginState.backgroundManager.shutdown();
  }

  if (pluginState.sqlite) {
    await pluginState.sqlite.close();
  }

  pluginState.config = undefined;
  pluginState.sqlite = undefined;
  pluginState.backgroundManager = undefined;
  pluginState.interactiveManager = undefined;
  pluginState.skillMcpManager = undefined;
  pluginState.backgroundCancelTool = undefined;
  pluginState.currentSessionId = undefined;
  pluginState.isInitialized = false;
}

function createMockOpenCodeClient(): any {
  return {
    session: {
      create: async () => ({ data: { id: `mock-session-${Date.now()}` } }),
      prompt: async () => ({ data: {} })
    }
  };
}

function createPlanContinuationRunner(projectPath: string) {
  if (!pluginState.sqlite || !pluginState.backgroundManager) return null;

  return createPlanContinuationHook({
    sqlite: pluginState.sqlite,
    backgroundManager: pluginState.backgroundManager,
    client: createMockOpenCodeClient(),
    projectPath,
    worktree: projectPath,
    defaultAgent: 'punch',
    resolveAgentConfig,
  });
}

function resolveAgentConfig(agentName?: string) {
  if (!pluginState.config?.agents || !agentName) return undefined;
  return pluginState.config.agents[agentName as keyof typeof pluginState.config.agents];
}

async function handleDelegateTask(params: Record<string, unknown>): Promise<DelegateTaskOutput> {
  if (!pluginState.isInitialized || !pluginState.backgroundManager) {
    throw new Error('Plugin not initialized');
  }

  const input: DelegateTaskInput = {
    task: params.task as string,
    agent: params.agent as string | undefined,
    context: params.context as string | undefined,
    timeout: params.timeout as number | undefined,
    planId: params.planId as string | undefined,
    planTaskId: params.planTaskId as string | undefined,
  };

  const client = createMockOpenCodeClient();
  const ctx = {
    backgroundManager: pluginState.backgroundManager,
    client,
    parentSessionId: pluginState.currentSessionId,
    agentConfig: resolveAgentConfig(input.agent ?? 'punch'),
    resolveAgentConfig
  };

  return await delegateTask(input, ctx);
}

async function handleBackgroundOutput(params: Record<string, unknown>): Promise<BackgroundOutputResult> {
  if (!pluginState.isInitialized || !pluginState.backgroundManager) {
    throw new Error('Plugin not initialized');
  }

  const outputParams: BackgroundOutputParams = {
    taskId: params.taskId as string,
    wait: params.wait as boolean | undefined,
    timeout: params.timeout as number | undefined
  };

  return await getBackgroundOutput(pluginState.backgroundManager, outputParams);
}

async function handleBackgroundCancel(params: Record<string, unknown>): Promise<BackgroundCancelResult> {
  if (!pluginState.isInitialized || !pluginState.backgroundCancelTool) {
    throw new Error('Plugin not initialized');
  }

  const cancelParams: BackgroundCancelParams = {
    taskId: params.taskId as string,
    all: params.all as boolean | undefined
  };

  return await pluginState.backgroundCancelTool.execute(cancelParams);
}

async function handleInteractiveBash(params: Record<string, unknown>): Promise<InteractiveBashOutput> {
  if (!pluginState.isInitialized) {
    throw new Error('Plugin not initialized');
  }

  const input: InteractiveBashInput = {
    command: params.command as string,
    action: params.action as 'start' | 'send' | 'capture' | 'close',
    sessionId: params.sessionId as string | undefined,
    input: params.input as string | undefined,
    cwd: params.cwd as string | undefined,
    lines: params.lines as number | undefined
  };

  const ctx = pluginState.interactiveManager ? { manager: pluginState.interactiveManager } : {};
  return await interactiveBash(input, ctx);
}

async function handleSkillMcp(params: Record<string, unknown>): Promise<SkillMcpResult> {
  if (!pluginState.isInitialized || !pluginState.skillMcpManager) {
    throw new Error('Plugin not initialized');
  }

  const skillParams: SkillMcpParams = {
    skill: params.skill as string,
    action: params.action as 'load' | 'invoke' | 'unload',
    tool: params.tool as string | undefined,
    params: params.params as Record<string, unknown> | undefined
  };

  const ctx = {
    manager: pluginState.skillMcpManager,
    skillPaths: []
  };

  return await skillMcp(skillParams, ctx);
}

async function handlePlanWrite(params: Record<string, unknown>): Promise<unknown> {
  if (!pluginState.isInitialized || !pluginState.sqlite) {
    throw new Error('Plugin not initialized');
  }

  return await writePlan(pluginState.sqlite, {
    ...(params as unknown as PlanWriteInput),
    projectPath: (params.projectPath as string | undefined) ?? process.cwd(),
    sessionId: (params.sessionId as string | undefined) ?? pluginState.currentSessionId,
  });
}

async function handlePlanRead(params: Record<string, unknown>): Promise<unknown> {
  if (!pluginState.isInitialized || !pluginState.sqlite) {
    throw new Error('Plugin not initialized');
  }

  return await readPlan(pluginState.sqlite, {
    ...(params as unknown as PlanReadInput),
    projectPath: (params.projectPath as string | undefined) ?? process.cwd(),
  });
}

async function handlePlanList(params: Record<string, unknown>): Promise<unknown> {
  if (!pluginState.isInitialized || !pluginState.sqlite) {
    throw new Error('Plugin not initialized');
  }

  return await listPlans(pluginState.sqlite, {
    ...(params as unknown as PlanListInput),
    projectPath: (params.projectPath as string | undefined) ?? process.cwd(),
  });
}

async function handlePlanUpdateTask(params: Record<string, unknown>): Promise<unknown> {
  if (!pluginState.isInitialized || !pluginState.sqlite) {
    throw new Error('Plugin not initialized');
  }

  return await updatePlanTaskState(pluginState.sqlite, {
    planId: params.planId as string,
    taskId: params.taskId as string | undefined,
    taskNumber: params.taskNumber as string | undefined,
    status: params.status as 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled' | undefined,
    wave: params.wave as string | undefined,
    notes: params.notes as string | undefined,
    eventType: params.eventType as string | undefined,
    eventPayload: params.eventPayload as Record<string, unknown> | undefined,
  });
}

async function handleSessionStart(data?: Record<string, unknown>): Promise<void> {
  if (data?.sessionId) {
    pluginState.currentSessionId = data.sessionId as string;
  }
}

async function handleSessionEnd(_data?: Record<string, unknown>): Promise<void> {
  await shutdownPlugin();
}

function registerTools(_config: Config): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      name: 'delegate-task',
      description: 'Delegate a task to background execution using an AI agent. Exploratory tasks are auto-routed to scout for low-token repo discovery.',
      schema: delegateTaskSchema as unknown as Record<string, unknown>,
      handler: handleDelegateTask
    },
    {
      name: 'plan-write',
      description: 'Write or update a structured execution plan in the SQLite plan store',
      schema: {
        type: 'object',
        properties: {
          agent: { type: 'string' },
          title: { type: 'string' },
          sourceRequest: { type: 'string' },
          markdown: { type: 'string' }
        },
        required: ['agent', 'title', 'sourceRequest', 'markdown']
      },
      handler: handlePlanWrite
    },
    {
      name: 'plan-read',
      description: 'Read a stored plan and its tasks from the SQLite plan store',
      schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          projectPath: { type: 'string' },
          planName: { type: 'string' },
          status: { type: 'string' }
        }
      },
      handler: handlePlanRead
    },
    {
      name: 'plan-list',
      description: 'List stored plans for the current project or session',
      schema: {
        type: 'object',
        properties: {
          projectPath: { type: 'string' },
          sessionId: { type: 'string' },
          status: { type: 'string' },
          limit: { type: 'number' }
        }
      },
      handler: handlePlanList
    },
    {
      name: 'plan-update-task',
      description: 'Update a stored plan task status and append an optional plan event',
      schema: {
        type: 'object',
        properties: {
          planId: { type: 'string' },
          taskId: { type: 'string' },
          taskNumber: { type: 'string' },
          status: { type: 'string' },
          wave: { type: 'string' },
          notes: { type: 'string' },
          eventType: { type: 'string' },
          eventPayload: { type: 'object' }
        },
        required: ['planId']
      },
      handler: handlePlanUpdateTask
    },
    {
      name: 'background-output',
      description: 'Get output from a background task, optionally waiting for completion',
      schema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Task ID to get output for' },
          wait: { type: 'boolean', description: 'Wait for task completion' },
          timeout: { type: 'number', description: 'Timeout in milliseconds when waiting' }
        },
        required: ['taskId']
      },
      handler: handleBackgroundOutput
    },
    {
      name: 'background-cancel',
      description: 'Cancel a running or pending background task, or cancel all tasks',
      schema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Task ID to cancel' },
          all: { type: 'boolean', description: 'Cancel all cancellable tasks' }
        }
      },
      handler: handleBackgroundCancel
    },
    {
      name: 'interactive-bash',
      description: 'Create and manage interactive bash sessions using tmux',
      schema: interactiveBashSchema as unknown as Record<string, unknown>,
      handler: handleInteractiveBash
    },
    {
      name: 'skill-mcp',
      description: 'Load, invoke, and unload skill MCP servers with embedded instructions',
      schema: skillMcpSchema as unknown as Record<string, unknown>,
      handler: handleSkillMcp
    }
  ];

  return tools;
}

export function createPlugin(): MonkeyCodePlugin {
  const hooks: HookHandlers = {
    onConfig: async (context: PluginContext) => {
      try {
        await initializePlugin(context);
        if (pluginState.config) {
          registerTools(pluginState.config);
        }
      } catch (error) {
        console.error('[monkey-code] Failed to initialize plugin:', error);
        throw error;
      }
    },

    onTool: async (context: ToolContext) => {
      const { toolName, params } = context;
      
      switch (toolName) {
        case 'delegate-task':
          return await handleDelegateTask(params);
        case 'plan-write':
          return await handlePlanWrite(params);
        case 'plan-read':
          return await handlePlanRead(params);
        case 'plan-list':
          return await handlePlanList(params);
        case 'plan-update-task':
          return await handlePlanUpdateTask(params);
        case 'background-output':
          return await handleBackgroundOutput(params);
        case 'background-cancel':
          return await handleBackgroundCancel(params);
        case 'interactive-bash':
          return await handleInteractiveBash(params);
        case 'skill-mcp':
          return await handleSkillMcp(params);
        default:
          return undefined;
      }
    },

    onEvent: async (event: PluginEvent) => {
      switch (event.type) {
        case 'session:start':
          await handleSessionStart(event.data);
          break;
        case 'session:end':
          await handleSessionEnd(event.data);
          break;
        case 'session:idle':
          if (!pluginState.currentSessionId && event.data?.sessionId) {
            pluginState.currentSessionId = event.data.sessionId as string;
          }
          if (pluginState.currentSessionId) {
            const continuation = createPlanContinuationRunner(process.cwd());
            if (continuation) {
              await continuation.continue({ sessionID: pluginState.currentSessionId });
            }
          }
          break;
        case 'task:complete':
          if (pluginState.sqlite && pluginState.backgroundManager && pluginState.currentSessionId) {
            const continuation = createPlanContinuationRunner(process.cwd());
            await continuation?.continue({ sessionID: pluginState.currentSessionId });
            const taskId = event.data?.taskId as string | undefined;
            if (taskId) {
              const task = await pluginState.sqlite.getTask(taskId);
              if (task?.plan_id) {
                await pluginState.sqlite.finalizePlanStatus(task.plan_id);
              }
            }
          }
          break;
        case 'task:failed':
          if (pluginState.sqlite && event.data?.taskId) {
            const task = await pluginState.sqlite.getTask(event.data.taskId as string);
            if (task?.plan_id) {
              await pluginState.sqlite.finalizePlanStatus(task.plan_id);
            }
          }
          break;
      }
    },

    onChatParams: async (input: unknown, output: unknown): Promise<void> => {
      await handleChatParams(input, output);
    },

    onChatMessage: async (input: unknown, output: unknown): Promise<void> => {
      if (!pluginState.sqlite) return;

      const startWorkHook = createStartWorkHook({
        sqlite: pluginState.sqlite,
        projectPath: process.cwd(),
        worktree: process.cwd(),
        defaultAgent: 'punch'
      });
      const stopAllHook = pluginState.backgroundManager
        ? createStopAllHook({
            backgroundManager: pluginState.backgroundManager,
            interactiveManager: pluginState.interactiveManager,
          })
        : null;

      await startWorkHook['chat.message']?.(
        input as { sessionID: string },
        output as { parts: Array<{ type: string; text?: string }>; message?: Record<string, unknown> }
      );
      await stopAllHook?.['chat.message']?.(
        input as { sessionID: string },
        output as { parts: Array<{ type: string; text?: string }>; message?: Record<string, unknown> }
      );
    }
  };

  return {
    name: 'monkey-code',
    version: '0.1.0',
    hooks
  };
}

export function getPluginState(): PluginState {
  return { ...pluginState };
}

export function resetPluginState(): void {
  pluginState.config = undefined;
  pluginState.sqlite = undefined;
  pluginState.backgroundManager = undefined;
  pluginState.interactiveManager = undefined;
  pluginState.skillMcpManager = undefined;
  pluginState.backgroundCancelTool = undefined;
  pluginState.currentSessionId = undefined;
  pluginState.isInitialized = false;
}

export default createPlugin;
