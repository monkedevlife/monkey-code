import { join } from 'path';
import { tool, type Plugin, type Config as OpenCodeConfig } from '@opencode-ai/plugin';
import { loadConfig, getConfigPaths, type Config as MonkeyConfig, type McpsConfig } from './config.js';
import type { CavemanRuntimeState } from './types/index.js';
import type { SQLiteClient } from './utils/sqlite-client.js';
import { createBackgroundManager, type BackgroundManager, type BackgroundManagerConfig } from './managers/BackgroundManager.js';
import { createInteractiveManager, type InteractiveManager } from './managers/InteractiveManager.js';
import { createSkillMcpManager, type SkillMcpManager, type SkillMcpManagerOptions } from './managers/SkillMcpManager.js';
import { delegateTask, type DelegateTaskInput } from './tools/delegate-task.js';
import { getBackgroundOutput, type BackgroundOutputParams } from './tools/background-output.js';
import { createBackgroundCancelTool, type BackgroundCancelParams } from './tools/background-cancel.js';
import { interactiveBash, type InteractiveBashInput, cleanupSessions } from './tools/interactive-bash.js';
import { skillMcp, type SkillMcpParams, cleanupAllSkills } from './tools/skill-mcp.js';
import { writePlan, readPlan, listPlans, updatePlanTaskState, type PlanWriteInput, type PlanReadInput, type PlanListInput } from './tools/plan-store.js';
import { createStartWorkHook } from './hooks/start-work.js';
import { createPlanContinuationHook } from './hooks/plan-continuation.js';
import { createStopAllHook } from './hooks/stop-all.js';
import { handleChatParams } from './hooks/chat-params.js';
import { createReviewPlanHook } from './hooks/review-plan.js';
import { createBrainstormHook } from './hooks/brainstorm.js';
import { createToolTranscriptHook } from './hooks/tool-transcript-hook.js';
import { readTranscriptEntries, formatTranscriptProgress } from './hooks/transcript.js';
import { handleOpenSpecRead, handleOpenSpecWrite, handleOpenSpecList } from './tools/openspec.js';
import { readBundledAgent, buildBundledAgentPermission } from './bundled-agents.js';
import { getCavemanInstructions, type CavemanLevel, CAVEMAN_LEVELS } from './caveman.js';
import { DelegatedTaskStore } from './tools/delegated-task-store.js';

const agents = ['punch', 'harambe', 'caesar', 'george', 'tasker', 'scout', 'builder', 'openspec-plan'] as const;
const schema = tool.schema;
const transcriptHook = createToolTranscriptHook();

type PluginState = {
  config?: MonkeyConfig;
  sqlite?: SQLiteClient;
  backgroundManager?: BackgroundManager;
  interactiveManager?: InteractiveManager;
  skillMcpManager?: SkillMcpManager;
  backgroundCancelTool?: Awaited<ReturnType<typeof createBackgroundCancelTool>>;
  cavemanRuntime?: CavemanRuntimeState;
  delegatedTaskStore: DelegatedTaskStore;
  isInitialized: boolean;
};

const pluginState: PluginState = {
  delegatedTaskStore: new DelegatedTaskStore(),
  isInitialized: false,
};

let runtimeInitPromise: Promise<void> | undefined;

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeBundledPermission(
  bundledPermission: Record<string, unknown> | undefined,
  existingPermission: unknown,
): Record<string, unknown> | undefined {
  if (!bundledPermission) return existingPermission as Record<string, unknown> | undefined;
  if (!isRecord(existingPermission)) return bundledPermission;

  return {
    ...bundledPermission,
    ...existingPermission,
  };
}

function applyMonkeyAgents(config: OpenCodeConfig) {
  const mutableConfig = config as OpenCodeConfig & {
    agent?: Record<string, unknown>;
    default_agent?: string;
    mcp?: Record<string, unknown>;
  };
  const agentConfig =
    mutableConfig.agent && typeof mutableConfig.agent === 'object' && !Array.isArray(mutableConfig.agent)
      ? mutableConfig.agent
      : {};

  for (const name of agents) {
    const bundled = readBundledAgent(name);
    if (!bundled) continue;
    if (name === 'openspec-plan' && !pluginState.config?.openspec) continue;
    if (name === 'caesar' && pluginState.config?.openspec) {
      bundled.tools = [...(bundled.tools ?? []), 'openspec-read', 'openspec-write', 'openspec-list']
      bundled.permission = buildBundledAgentPermission(bundled.tools)
      bundled.prompt = (bundled.prompt ?? '') + '\n\n## OpenSpec Mode\n\nOpenSpec is enabled. You have additional tools for architectural specification:\n- `openspec-read` — read spec files from the central OpenSpec store\n- `openspec-write` — create or update spec files\n- `openspec-list` — list all spec files for the current project\n\nFiles live under `~/.config/monkey-code/openspec/<project-id>/`. Use `delegate-task` to hand off detailed spec authoring to the `openspec-plan` subagent. Do not write specs inline — delegate them.\n'
    }

    const existing =
      agentConfig[name] && typeof agentConfig[name] === 'object' && !Array.isArray(agentConfig[name])
        ? (agentConfig[name] as Record<string, unknown>)
        : {};

    const configured = resolveAgentConfig(name);
    // Caveman prompt injection (runtime override beats config)
    const isCavemanActive = pluginState.cavemanRuntime?.active ?? pluginState.config?.caveman?.enabled ?? false;
    const cavemanIntensity = pluginState.cavemanRuntime?.intensity ?? pluginState.config?.caveman?.intensity ?? 'full';
    let agentPrompt = bundled.prompt ?? '';
    if (isCavemanActive) {
      const cavemanBlock = getCavemanInstructions(cavemanIntensity as CavemanLevel);
      agentPrompt = cavemanBlock + '\n\n' + agentPrompt;
    }
    agentConfig[name] = {
      ...existing,
      ...(bundled.description ? { description: bundled.description } : {}),
      ...(agentPrompt ? { prompt: agentPrompt } : {}),
      ...(bundled.model ? { model: bundled.model } : {}),
      ...(configured?.model ? { model: configured.model } : {}),
      ...(configured?.temperature !== undefined ? { temperature: configured.temperature } : {}),
      ...(bundled.permission ? { permission: mergeBundledPermission(bundled.permission, existing.permission) } : {}),
      mode: bundled.mode,
    };
  }

  // Register slash commands for OpenCode autocomplete
  const commandConfig = (mutableConfig as Record<string, unknown>).command as Record<string, unknown> ?? {};
  (mutableConfig as Record<string, unknown>).command = {
    ...commandConfig,
    'start-work': {
      name: 'start-work',
      description: 'Start working from a stored execution plan',
      template: '/start-work $ARGUMENTS',
      hints: ['$ARGUMENTS'],
    },
    'review-plan': {
      name: 'review-plan',
      description: 'Review a stored execution plan using Harambe (critic)',
      template: '/review-plan $ARGUMENTS',
      hints: ['$ARGUMENTS'],
    },
    'stop-all': {
      name: 'stop-all',
      description: 'Cancel all background tasks and terminate active processes',
      template: '/stop-all',
    },
    'brainstorm': {
      name: 'brainstorm',
      description: 'Brainstorm creative ideas and design directions using George (creative)',
      template: '/brainstorm $ARGUMENTS',
      hints: ['$ARGUMENTS'],
    },
  };

  for (const name of ['build', 'plan'] as const) {
    const existing =
      agentConfig[name] && typeof agentConfig[name] === 'object' && !Array.isArray(agentConfig[name])
        ? (agentConfig[name] as Record<string, unknown>)
        : {};
    agentConfig[name] = { ...existing, disable: true, hidden: true };
  }

  mutableConfig.agent = agentConfig;
  mutableConfig.default_agent = 'punch';

  const mcpConfig =
    mutableConfig.mcp && typeof mutableConfig.mcp === 'object' && !Array.isArray(mutableConfig.mcp)
      ? mutableConfig.mcp
      : {};

  if (pluginState.config?.mcps?.context7?.enabled !== false) {
    mcpConfig.context7 = {
      ...(mcpConfig.context7 && typeof mcpConfig.context7 === 'object' && !Array.isArray(mcpConfig.context7)
        ? (mcpConfig.context7 as Record<string, unknown>)
        : {}),
      type: 'remote',
      url: 'https://mcp.context7.com/mcp',
      enabled: true,
      ...(pluginState.config?.mcps?.context7?.apiKey
        ? {
            headers: {
              Authorization: `Bearer ${pluginState.config.mcps.context7.apiKey}`,
            },
          }
        : {}),
      oauth: false,
    };
  }

  if (pluginState.config?.mcps?.grepApp?.enabled !== false) {
    mcpConfig.grep_app = {
      ...(mcpConfig.grep_app && typeof mcpConfig.grep_app === 'object' && !Array.isArray(mcpConfig.grep_app)
        ? (mcpConfig.grep_app as Record<string, unknown>)
        : {}),
      type: 'remote',
      url: 'https://mcp.grep.app',
      enabled: true,
      oauth: false,
    };
  }

  mutableConfig.mcp = mcpConfig;
}

function buildProjectPath(input: Parameters<Plugin>[0]) {
  return input.worktree ?? input.directory;
}

function ensureConfigLoaded(worktree: string) {
  if (!pluginState.config) {
    pluginState.config = loadConfig(worktree);
  }

  return pluginState.config;
}

function resolveAgentConfig(agentName?: string) {
  if (!pluginState.config?.agents || !agentName) return undefined;
  return pluginState.config.agents[agentName as keyof typeof pluginState.config.agents];
}

function createClientAdapter(input: Parameters<Plugin>[0]) {
  return {
    session: {
      get: input.client.session.get
        ? async (params: { path: { id: string }; query?: { directory?: string } }) => {
            const result = await input.client.session.get({
              path: { id: params.path.id },
              query: params.query,
            });
            return { data: result.data as { directory?: string } | undefined };
          }
        : undefined,
      create: async (params: {
        body?: { parentID?: string; title?: string; permission?: Array<{ permission: string; action: string; pattern: string }> };
        query?: { directory?: string };
      }) => {
        const result = await input.client.session.create({
          body: {
            parentID: params.body?.parentID,
            title: params.body?.title,
            permission: params.body?.permission,
          } as Record<string, unknown>,
          query: params.query,
        });
        return {
          data: result.data ? { id: result.data.id } : undefined,
        };
      },
      prompt: async (params: {
        path: { id: string };
        body: {
          agent?: string;
          system?: string;
          parts: Array<{ type: string; text: string }>;
          noReply?: boolean;
          tools?: Record<string, boolean>;
          model?: { providerID: string; modelID: string };
        };
      }) => {
        const result = await input.client.session.prompt({
          path: { id: params.path.id },
          body: {
            agent: params.body.agent,
            system: params.body.system,
            noReply: params.body.noReply,
            parts: params.body.parts.map((part) => ({
              type: 'text' as const,
              text: part.text,
            })),
            tools: params.body.tools,
            model: params.body.model,
          },
        });
        return { data: result.data };
      },
      abort: input.client.session.abort
        ? async (params: { path: { id: string } }) => {
            return input.client.session.abort({ path: { id: params.path.id } });
          }
        : undefined,
    },
  };
}

async function initializePlugin(input: Parameters<Plugin>[0]) {
  if (pluginState.isInitialized) return;
  if (runtimeInitPromise) {
    await runtimeInitPromise;
    return;
  }

  runtimeInitPromise = (async () => {
    const config = ensureConfigLoaded(input.worktree);
    const paths = getConfigPaths(input.worktree);
    const { createSQLiteClient } = await import('./utils/sqlite-client.js');
    const sqlite = createSQLiteClient(paths.dbPath);
    const backgroundConfig: BackgroundManagerConfig = {
      concurrencyLimit: config.background?.maxConcurrent ?? 5,
      pollIntervalMs: config.background?.pollInterval ?? 5000,
    };
    const backgroundManager = createBackgroundManager(sqlite, backgroundConfig);
    const interactiveManager = createInteractiveManager();
    const skillMcpOptions: SkillMcpManagerOptions = {
      builtinConfig: config.mcps as McpsConfig,
    };
    const skillMcpManager = createSkillMcpManager(skillMcpOptions);

    try {
      await sqlite.initialize();
      await backgroundManager.initialize();
      try {
        await skillMcpManager.initializeBuiltinMcps();
      } catch (error) {
        console.warn('[monkey-code] Failed to initialize some builtin MCPs:', error instanceof Error ? error.message : String(error));
      }

      pluginState.sqlite = sqlite;
      pluginState.backgroundManager = backgroundManager;
      pluginState.interactiveManager = interactiveManager;
      pluginState.skillMcpManager = skillMcpManager;
      pluginState.backgroundCancelTool = await createBackgroundCancelTool(backgroundManager, sqlite, pluginState.delegatedTaskStore, createClientAdapter(input));
      pluginState.isInitialized = true;
    } catch (error) {
      await skillMcpManager.cleanup().catch(() => undefined);
      await backgroundManager.shutdown().catch(() => undefined);
      await sqlite.close().catch(() => undefined);
      throw error;
    }
  })();

  try {
    await runtimeInitPromise;
  } finally {
    runtimeInitPromise = undefined;
  }
}

async function shutdownPlugin() {
  if (!pluginState.isInitialized) return;

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
  pluginState.delegatedTaskStore.clear();
  pluginState.isInitialized = false;
}

async function handleDelegateTaskRequest(args: DelegateTaskInput, sessionID: string, input: Parameters<Plugin>[0]) {
  return delegateTask(args, {
    client: createClientAdapter(input),
    parentSessionId: sessionID,
    agentConfig: resolveAgentConfig(args.agent ?? 'punch'),
    resolveAgentConfig,
    worktree: input.worktree,
    directory: input.directory,
    delegatedTaskStore: pluginState.delegatedTaskStore,
  });
}

async function handleBackgroundOutputRequest(args: BackgroundOutputParams) {
  if (!pluginState.backgroundManager) throw new Error('Plugin not initialized');
  return getBackgroundOutput(pluginState.backgroundManager, args, pluginState.delegatedTaskStore);
}

async function handleBackgroundCancelRequest(args: BackgroundCancelParams) {
  if (!pluginState.backgroundCancelTool) throw new Error('Plugin not initialized');
  return pluginState.backgroundCancelTool.execute(args);
}

async function handleInteractiveBashRequest(args: InteractiveBashInput, directory: string) {
  if (!pluginState.interactiveManager) throw new Error('Plugin not initialized');
  return interactiveBash(
    {
      ...args,
      cwd: args.cwd ?? directory,
    },
    { manager: pluginState.interactiveManager },
  );
}

async function handleSkillMcpRequest(args: SkillMcpParams, worktree: string) {
  if (!pluginState.skillMcpManager) throw new Error('Plugin not initialized');
  return skillMcp(args, {
    manager: pluginState.skillMcpManager,
    skillPaths: [join(worktree, '.opencode', 'skills')],
  });
}

async function handlePlanWriteRequest(args: PlanWriteInput, sessionID: string, input: Parameters<Plugin>[0]) {
  if (!pluginState.sqlite) throw new Error('Plugin not initialized');

  return writePlan(pluginState.sqlite, {
    ...args,
    projectPath: args.projectPath || buildProjectPath(input),
    worktree: args.worktree ?? input.worktree,
    sessionId: args.sessionId ?? sessionID,
  });
}

async function handlePlanReadRequest(args: PlanReadInput, input: Parameters<Plugin>[0]) {
  if (!pluginState.sqlite) throw new Error('Plugin not initialized');

  return readPlan(pluginState.sqlite, {
    ...args,
    projectPath: args.projectPath || buildProjectPath(input),
  });
}

async function handlePlanListRequest(args: PlanListInput, input: Parameters<Plugin>[0]) {
  if (!pluginState.sqlite) throw new Error('Plugin not initialized');

  return listPlans(pluginState.sqlite, {
    ...args,
    projectPath: args.projectPath || buildProjectPath(input),
  });
}

async function handlePlanUpdateTaskRequest(
  args: {
    planId: string;
    taskId?: string;
    taskNumber?: string;
    status?: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';
    wave?: string;
    notes?: string;
    eventType?: string;
    eventPayload?: Record<string, unknown>;
  },
) {
  if (!pluginState.sqlite) throw new Error('Plugin not initialized');

  return updatePlanTaskState(pluginState.sqlite, args);
}

export const server: Plugin = async (input) => {
  ensureConfigLoaded(input.worktree);

  return {
    config: async (config: OpenCodeConfig) => {
      applyMonkeyAgents(config);
    },
    tool: {
      'delegate-task': tool({
        description:
          'Offload parallel exploration or focused execution to another monkey agent. Exploratory tasks are auto-routed to scout so repo discovery uses low-token grep_app-style exploration and returns compact findings. Use tasker for small atomic work, builder for focused code output, and background-output to collect results.',
        args: {
          task: schema.string().describe('Task description'),
          agent: schema.enum(agents).optional().describe('Agent to use'),
          context: schema.string().optional().describe('Additional context'),
          timeout: schema.number().min(1).max(240).optional().describe('Timeout in minutes'),
          planId: schema.string().optional().describe('Optional plan ID to associate the background task with'),
          planTaskId: schema.string().optional().describe('Optional plan task ID to associate the background task with'),
        },
        async execute(args, context) {
          await initializePlugin(input);
          return stringify(await handleDelegateTaskRequest(args, context.sessionID, input));
        },
      }),
      'plan-write': tool({
        description: 'Write or update a structured execution plan in the SQLite plan store',
        args: {
          id: schema.string().optional().describe('Existing plan ID to update'),
          projectPath: schema.string().optional().describe('Project path for the plan'),
          worktree: schema.string().optional().describe('Worktree path for the plan'),
          sessionId: schema.string().optional().describe('Owning session ID'),
          parentSessionId: schema.string().optional().describe('Parent session ID'),
          agent: schema.string().describe('Agent creating the plan'),
          title: schema.string().describe('Plan title'),
          slug: schema.string().optional().describe('Plan slug'),
          status: schema.enum(['draft', 'active', 'blocked', 'completed', 'cancelled', 'superseded']).optional().describe('Plan status'),
          sourceRequest: schema.string().describe('Original user request'),
          summary: schema.string().optional().describe('Short summary of the plan'),
          markdown: schema.string().describe('Full plan markdown'),
          plan: schema.record(schema.string(), schema.unknown()).optional().describe('Structured plan JSON payload'),
          tasks: schema.array(
            schema.object({
              id: schema.string().optional(),
              taskNumber: schema.string().optional(),
              title: schema.string(),
              status: schema.enum(['pending', 'in_progress', 'completed', 'blocked', 'cancelled']).optional(),
              wave: schema.string().optional(),
              dependsOn: schema.array(schema.string()).optional(),
              category: schema.string().optional(),
              skills: schema.array(schema.string()).optional(),
              references: schema.array(schema.unknown()).optional(),
              acceptanceCriteria: schema.array(schema.string()).optional(),
              qaScenarios: schema.array(schema.unknown()).optional(),
              notes: schema.string().optional(),
            })
          ).optional().describe('Structured plan tasks'),
        },
        async execute(args, context) {
          await initializePlugin(input);
          return stringify(await handlePlanWriteRequest(args as PlanWriteInput, context.sessionID, input));
        },
      }),
      'plan-read': tool({
        description: 'Read a stored plan and its tasks from the SQLite plan store',
        args: {
          id: schema.string().optional().describe('Plan ID'),
          projectPath: schema.string().optional().describe('Project path'),
          planName: schema.string().optional().describe('Plan slug or title'),
          status: schema.enum(['draft', 'active', 'blocked', 'completed', 'cancelled', 'superseded']).optional().describe('Optional status filter when reading latest plan'),
        },
        async execute(args) {
          await initializePlugin(input);
          return stringify(await handlePlanReadRequest(args as PlanReadInput, input));
        },
      }),
      'plan-list': tool({
        description: 'List stored plans for the current project or session',
        args: {
          projectPath: schema.string().optional().describe('Project path'),
          sessionId: schema.string().optional().describe('Session ID filter'),
          status: schema.enum(['draft', 'active', 'blocked', 'completed', 'cancelled', 'superseded']).optional().describe('Status filter'),
          limit: schema.number().min(1).max(200).optional().describe('Maximum number of plans to return'),
        },
        async execute(args) {
          await initializePlugin(input);
          return stringify(await handlePlanListRequest(args as PlanListInput, input));
        },
      }),
      'plan-update-task': tool({
        description: 'Update a stored plan task status and append an optional plan event',
        args: {
          planId: schema.string().describe('Plan ID'),
          taskId: schema.string().optional().describe('Plan task ID'),
          taskNumber: schema.string().optional().describe('Plan task number'),
          status: schema.enum(['pending', 'in_progress', 'completed', 'blocked', 'cancelled']).optional().describe('Updated task status'),
          wave: schema.string().optional().describe('Wave label'),
          notes: schema.string().optional().describe('Task notes'),
          eventType: schema.string().optional().describe('Optional plan event type to append'),
          eventPayload: schema.record(schema.string(), schema.unknown()).optional().describe('Optional plan event payload'),
        },
        async execute(args) {
          await initializePlugin(input);
          return stringify(await handlePlanUpdateTaskRequest(args));
        },
      }),
      'background-output': tool({
        description: 'Get output from a background task, optionally waiting for completion',
        args: {
          taskId: schema.string().describe('Task ID to get output for'),
          wait: schema.boolean().optional().describe('Wait for task completion'),
          timeout: schema.number().optional().describe('Timeout in milliseconds when waiting'),
        },
        async execute(args) {
          await initializePlugin(input);
          return stringify(await handleBackgroundOutputRequest(args));
        },
      }),
      'background-cancel': tool({
        description: 'Cancel a running or pending background task, or cancel all tasks',
        args: {
          taskId: schema.string().optional().describe('Task ID to cancel'),
          all: schema.boolean().optional().describe('Cancel all cancellable tasks'),
        },
        async execute(args) {
          await initializePlugin(input);
          if (!args.all && !args.taskId) {
            throw new Error('taskId is required unless all is true');
          }

          return stringify(
            await handleBackgroundCancelRequest({
              taskId: args.taskId ?? '',
              all: args.all,
            }),
          );
        },
      }),
      'interactive-bash': tool({
        description: 'Create and manage interactive bash sessions using tmux',
        args: {
          command: schema.string().optional().describe('Command to run in the interactive session'),
          action: schema.enum(['start', 'send', 'capture', 'close']).describe('Action to perform'),
          sessionId: schema.string().optional().describe('Session ID for send/capture/close actions'),
          input: schema.string().optional().describe('Input to send to the session'),
          cwd: schema.string().optional().describe('Working directory for the session'),
          lines: schema.number().min(1).max(1000).optional().describe('Number of lines to capture'),
        },
        async execute(args, context) {
          await initializePlugin(input);
          return stringify(
            await handleInteractiveBashRequest(
              {
                command: args.command ?? '',
                action: args.action,
                sessionId: args.sessionId,
                input: args.input,
                cwd: args.cwd,
                lines: args.lines,
              },
              context.directory,
            ),
          );
        },
      }),
      'skill-mcp': tool({
        description: 'Load, invoke, and unload skill MCP servers with embedded instructions',
        args: {
          skill: schema.string().describe('Skill name or path'),
          action: schema.enum(['load', 'invoke', 'unload']).describe('Action to perform'),
          tool: schema.string().optional().describe('Tool to invoke'),
          params: schema.record(schema.string(), schema.unknown()).optional().describe('Tool parameters'),
        },
        async execute(args) {
          await initializePlugin(input);
          return stringify(await handleSkillMcpRequest(args, input.worktree));
        },
      }),
      'openspec-read': tool({
        description: 'Read an OpenSpec specification file',
        args: {
          file: schema.string().describe('Relative path to openspec file'),
        },
        async execute(args) {
          await initializePlugin(input);
          return stringify(await handleOpenSpecRead(args, { sqlite: pluginState.sqlite!, worktree: input.worktree }));
        },
      }),
      'openspec-write': tool({
        description: 'Write or update an OpenSpec specification file',
        args: {
          file: schema.string().describe('Relative path to the openspec file'),
          content: schema.string().describe('File content'),
        },
        async execute(args) {
          await initializePlugin(input);
          return stringify(await handleOpenSpecWrite(args, { sqlite: pluginState.sqlite!, worktree: input.worktree }));
        },
      }),
      'openspec-list': tool({
        description: 'List OpenSpec specification files for the current project',
        args: {
          directory: schema.string().optional().describe('Optional subdirectory filter'),
        },
        async execute(args) {
          await initializePlugin(input);
          return stringify(await handleOpenSpecList(args, { sqlite: pluginState.sqlite!, worktree: input.worktree }));
        },
      }),
    },
    event: async ({ event }) => {
      if (event.type === 'server.instance.disposed') {
        await shutdownPlugin();
      }

        if (event.type === 'session.idle') {
        try {
          await initializePlugin(input);
        } catch {
          return;
        }

        const sessionID = ((event as { properties?: Record<string, unknown> }).properties?.sessionID as string | undefined) ?? '';
        if (sessionID) {
          const delegatedTask = pluginState.delegatedTaskStore.getTaskBySessionId(sessionID);
          if (delegatedTask) {
            const entries = readTranscriptEntries(sessionID);
            const latestOutput = formatTranscriptProgress(entries) || undefined;
            const completedTask = pluginState.delegatedTaskStore.markCompletedBySession(sessionID, latestOutput);
            if (completedTask) {
              pluginState.delegatedTaskStore.queueNotification(
                delegatedTask.parentSessionId,
                `<system-reminder>\n[BACKGROUND TASK COMPLETED]\n**ID:** \`${delegatedTask.id}\`\n**Description:** ${delegatedTask.description}\n\nUse \`background-output\` with \`taskId=\"${delegatedTask.id}\"\` to retrieve the result.\n</system-reminder>`
              );
            }
          }

          const planContinuationHook = pluginState.sqlite
            ? createPlanContinuationHook({
                sqlite: pluginState.sqlite,
                client: createClientAdapter(input),
                projectPath: buildProjectPath(input),
                worktree: input.worktree,
                defaultAgent: 'punch',
                resolveAgentConfig,
              })
            : null;
          await planContinuationHook?.continue({ sessionID });
        }
      }
    },
    'chat.params': async (hookInput, output) => {
      await handleChatParams(hookInput, output);
    },
    'chat.message': async (hookInput, output) => {
      try {
        await initializePlugin(input);
      } catch {
        return;
      }

      const messageText = (hookInput as { parts?: Array<{ type: string; text?: string }> }).parts
        ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map(p => p.text)
        .join(' ') ?? '';
      const textLower = messageText.toLowerCase().trim();
      const outputParts = (output as { parts: Array<{ type: string; text?: string }> }).parts;
      const delegatedNotifications = pluginState.delegatedTaskStore.consumeNotifications((hookInput as { sessionID: string }).sessionID);
      if (delegatedNotifications.length > 0) {
        outputParts.unshift({
          type: 'text',
          text: delegatedNotifications.join('\n\n'),
        });
      }
      const cavemanSlashMatch = textLower.match(/^\/caveman(?:\s+(lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra|wenyan|stop|off))?$/);
      const cavemanNaturalOff = /^(stop caveman|deactivate caveman|normal mode|disable caveman)\b/.test(textLower);
      const cavemanNaturalOn = /^(activate caveman|turn on caveman)\b/.test(textLower);
      const defaultIntensity = pluginState.config?.caveman?.intensity ?? 'full';

      if (cavemanSlashMatch) {
        const intensity = cavemanSlashMatch[1];
        if (intensity === 'stop' || intensity === 'off') {
          pluginState.cavemanRuntime = undefined;
          outputParts.push({ type: 'text', text: '🦣 Caveman mode disabled.' });
        } else if (intensity === 'wenyan') {
          pluginState.cavemanRuntime = { active: true, intensity: 'wenyan-full' };
          outputParts.push({ type: 'text', text: '🦣 Caveman mode activated: wenyan-full' });
        } else if (!intensity) {
          pluginState.cavemanRuntime = { active: true, intensity: defaultIntensity };
          outputParts.push({ type: 'text', text: `🦣 Caveman mode activated: ${defaultIntensity}` });
        } else if (CAVEMAN_LEVELS.includes(intensity as CavemanLevel)) {
          pluginState.cavemanRuntime = { active: true, intensity: intensity as CavemanLevel };
          outputParts.push({ type: 'text', text: `🦣 Caveman mode activated: ${intensity}` });
        } else {
          outputParts.push({ type: 'text', text: `Unknown caveman level: ${intensity}. Valid: ${CAVEMAN_LEVELS.join(', ')}, stop, off` });
        }
      } else if (cavemanNaturalOff) {
        pluginState.cavemanRuntime = undefined;
        outputParts.push({ type: 'text', text: '🦣 Caveman mode disabled.' });
      } else if (cavemanNaturalOn) {
        pluginState.cavemanRuntime = { active: true, intensity: defaultIntensity };
        outputParts.push({ type: 'text', text: `🦣 Caveman mode activated: ${defaultIntensity}` });
      }

      const startWorkHook = pluginState.sqlite
        ? createStartWorkHook({
            sqlite: pluginState.sqlite,
            projectPath: buildProjectPath(input),
            worktree: input.worktree,
            defaultAgent: 'punch',
          })
        : null;
      const stopAllHook = pluginState.backgroundManager
        ? createStopAllHook({
            backgroundManager: pluginState.backgroundManager,
            interactiveManager: pluginState.interactiveManager,
            abortCurrentSession: async (sessionID: string) => {
              await input.client.session.abort({ path: { id: sessionID } });
            },
          })
        : null;
      const reviewPlanHook = pluginState.sqlite
        ? createReviewPlanHook({
            sqlite: pluginState.sqlite,
            projectPath: buildProjectPath(input),
          })
        : null;
      const brainstormHook = createBrainstormHook();

      if (startWorkHook) {
        await startWorkHook['chat.message']?.(hookInput as { sessionID: string }, output as { parts: Array<{ type: string; text?: string }>; message?: Record<string, unknown> });
      }
      if (stopAllHook) {
        await stopAllHook['chat.message']?.(hookInput as { sessionID: string; client?: { session?: { abort?: (params: unknown) => Promise<unknown> } } }, output as { parts: Array<{ type: string; text?: string }>; message?: Record<string, unknown> });
      }
      if (reviewPlanHook) {
        await reviewPlanHook['chat.message']?.(hookInput as { sessionID: string }, output as { parts: Array<{ type: string; text?: string }>; message?: Record<string, unknown> });
      }
      await brainstormHook['chat.message']?.(hookInput as { sessionID: string }, output as { parts: Array<{ type: string; text?: string }>; message?: Record<string, unknown> });
    },
    'command.execute.before': async (hookInput, output) => {
      try {
        await initializePlugin(input);
      } catch {
        return;
      }

      const startWorkHook = pluginState.sqlite
        ? createStartWorkHook({
            sqlite: pluginState.sqlite,
            projectPath: buildProjectPath(input),
            worktree: input.worktree,
            defaultAgent: 'punch',
          })
        : null;
      const stopAllHook = pluginState.backgroundManager
        ? createStopAllHook({
            backgroundManager: pluginState.backgroundManager,
            interactiveManager: pluginState.interactiveManager,
            abortCurrentSession: async (sessionID: string) => {
              await input.client.session.abort({ path: { id: sessionID } });
            },
          })
        : null;
      const reviewPlanHook = pluginState.sqlite
        ? createReviewPlanHook({
            sqlite: pluginState.sqlite,
            projectPath: buildProjectPath(input),
          })
        : null;
      const brainstormHook = createBrainstormHook();

      if (startWorkHook) {
        await startWorkHook['command.execute.before']?.(hookInput as { sessionID: string; command: string; arguments: string }, output as { parts: Array<{ type: string; text?: string }>; message?: Record<string, unknown> });
      }
      if (stopAllHook) {
        await stopAllHook['command.execute.before']?.(hookInput as { sessionID: string; command: string; arguments: string }, output as { parts: Array<{ type: string; text?: string }>; message?: Record<string, unknown> });
      }
      if (reviewPlanHook) {
        await reviewPlanHook['command.execute.before']?.(hookInput as { sessionID: string; command: string; arguments: string }, output as { parts: Array<{ type: string; text?: string }>; message?: Record<string, unknown> });
      }
      await brainstormHook['command.execute.before']?.(hookInput as { sessionID: string; command: string; arguments: string }, output as { parts: Array<{ type: string; text?: string }>; message?: Record<string, unknown> });
    },
    'tool.execute.before': transcriptHook['tool.execute.before'],
    'tool.execute.after': async (hookInput, output) => {
      await transcriptHook['tool.execute.after'](hookInput, output).catch(() => {});

      if (hookInput.tool !== 'plan-write') return;

      try {
        const parsed = JSON.parse(output.output);
        const planTitle = parsed?.plan?.title;
        if (planTitle) {
          const args = hookInput.args as Record<string, unknown> | undefined;
          const isUpdate = Boolean(args?.id);
          const action = isUpdate ? "updated" : "saved";
          output.title = `Plan "${planTitle}" ${action}`;
          output.output = [
            `Plan "${planTitle}" is ready.`,
            isUpdate ? "" : `Start: /start-work "${planTitle}"`,
            `Review: /review-plan "${planTitle}"`,
            "",
            output.output,
          ].filter(Boolean).join("\n");
        }
      } catch {
        // output might not be parseable JSON
      }
    },
  };
};

const plugin = Object.assign(server, {
  id: 'monkey-code',
  server,
});

export default plugin;
