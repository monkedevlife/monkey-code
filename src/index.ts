import { join } from 'path';
import { tool, type Plugin, type Config as OpenCodeConfig } from '@opencode-ai/plugin';
import { readFileSync, existsSync } from 'fs';
import { loadConfig, getConfigPaths, type Config as MonkeyConfig, type McpsConfig } from './config.js';
import { createSQLiteClient, type SQLiteClient } from './utils/sqlite-client.js';
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

const agents = ['punch', 'harambe', 'caesar', 'george', 'tasker', 'scout', 'builder'] as const;
const primaryAgents = new Set(['punch', 'harambe', 'caesar', 'george']);
const schema = tool.schema;
const pluginRoot = new URL('..', import.meta.url);

type PluginState = {
  config?: MonkeyConfig;
  sqlite?: SQLiteClient;
  backgroundManager?: BackgroundManager;
  interactiveManager?: InteractiveManager;
  skillMcpManager?: SkillMcpManager;
  backgroundCancelTool?: Awaited<ReturnType<typeof createBackgroundCancelTool>>;
  isInitialized: boolean;
};

const pluginState: PluginState = {
  isInitialized: false,
};

type BundledAgentDefinition = {
  name: (typeof agents)[number];
  description?: string;
  model?: string;
  prompt: string;
  mode: 'primary' | 'subagent';
  tools?: string[];
  permission?: Record<string, unknown>;
};

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseInlineToolList(value: string | undefined) {
  if (!value) return undefined;

  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return undefined;

  const entries = trimmed
    .slice(1, -1)
    .split(',')
    .map((entry) => entry.trim().replace(/^['"`]|['"`]$/g, ''))
    .filter(Boolean);

  return entries.length > 0 ? entries : undefined;
}

export function buildBundledAgentPermission(tools: string[] | undefined) {
  if (!tools || tools.length === 0) return undefined;

  const allowedPermissions = new Set<string>();
  const normalizedTools = tools.map((toolName) => toolName.trim().toLowerCase());

  for (const toolName of normalizedTools) {
    if (!toolName) continue;

    if (toolName === 'edit' || toolName === 'write' || toolName === 'apply_patch' || toolName === 'apply-patch') {
      allowedPermissions.add('edit');
      continue;
    }

    if (toolName === 'bash') {
      allowedPermissions.add('bash');
      continue;
    }

    if (toolName === 'question') {
      allowedPermissions.add('question');
      continue;
    }

    if (toolName === 'read' || toolName === 'glob' || toolName === 'grep' || toolName === 'webfetch' || toolName === 'websearch' || toolName === 'skill' || toolName === 'todowrite') {
      allowedPermissions.add(toolName);
      continue;
    }

    if (toolName === 'delegate-task' || toolName === 'delegate_task') {
      allowedPermissions.add('delegate-task');
      continue;
    }

    if (toolName === 'plan-write' || toolName === 'plan_write') {
      allowedPermissions.add('plan-write');
      continue;
    }

    if (toolName === 'plan-read' || toolName === 'plan_read') {
      allowedPermissions.add('plan-read');
      continue;
    }

  if (toolName === 'plan-list' || toolName === 'plan_list') {
    allowedPermissions.add('plan-list');
    continue;
  }

  if (toolName === 'plan-update-task' || toolName === 'plan_update_task') {
    allowedPermissions.add('plan-update-task');
    continue;
  }

    if (toolName === 'background-output' || toolName === 'background_output') {
      allowedPermissions.add('background-output');
      continue;
    }

    if (toolName === 'background-cancel' || toolName === 'background_cancel') {
      allowedPermissions.add('background-cancel');
      continue;
    }

    if (toolName === 'interactive-bash' || toolName === 'interactive_bash') {
      allowedPermissions.add('interactive-bash');
      continue;
    }

    if (toolName === 'skill-mcp' || toolName === 'skill_mcp') {
      allowedPermissions.add('skill-mcp');
      continue;
    }

    if (toolName === 'ast_grep_search' || toolName === 'ast-grep-search') {
      allowedPermissions.add('ast_grep_search');
      continue;
    }

    if (toolName === 'ast_grep_replace' || toolName === 'ast-grep-replace') {
      allowedPermissions.add('ast_grep_replace');
      continue;
    }

    if (toolName === 'websearch_web_search_exa' || toolName.startsWith('websearch_')) {
      allowedPermissions.add('websearch');
      continue;
    }

    if (toolName === 'lsp' || toolName.startsWith('lsp_') || toolName.startsWith('lsp-')) {
      allowedPermissions.add('lsp');
      continue;
    }

    allowedPermissions.add(toolName);
  }

  return {
    '*': 'deny',
    ...Object.fromEntries(Array.from(allowedPermissions).map((toolName) => [toolName, 'allow'])),
  };
}

function mergeBundledPermission(
  bundledPermission: Record<string, unknown> | undefined,
  existingPermission: unknown,
) {
  if (!bundledPermission) return existingPermission;
  if (!isRecord(existingPermission)) return bundledPermission;

  return {
    ...bundledPermission,
    ...existingPermission,
  };
}

export function readBundledAgent(name: typeof agents[number]): BundledAgentDefinition | undefined {
  const file = new URL(`./agents/${name}.md`, pluginRoot);
  if (!existsSync(file)) return undefined;

  const content = readFileSync(file, 'utf-8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return undefined;

  const frontmatter = match[1] ?? '';
  const prompt = (match[2] ?? '').trim();
  const meta = Object.fromEntries(
    frontmatter
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(':');
        if (idx === -1) return [line, ''];
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
      }),
  );

  const tools = parseInlineToolList(meta.tools);

  return {
    name,
    description: meta.description,
    model: meta.model,
    prompt,
    mode: primaryAgents.has(name) ? 'primary' : 'subagent',
    tools,
    permission: buildBundledAgentPermission(tools),
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

    const existing =
      agentConfig[name] && typeof agentConfig[name] === 'object' && !Array.isArray(agentConfig[name])
        ? (agentConfig[name] as Record<string, unknown>)
        : {};

    const configured = resolveAgentConfig(name);
    agentConfig[name] = {
      ...existing,
      ...(bundled.description ? { description: bundled.description } : {}),
      ...(bundled.prompt ? { prompt: bundled.prompt } : {}),
      ...(bundled.model ? { model: bundled.model } : {}),
      ...(configured?.model ? { model: configured.model } : {}),
      ...(configured?.temperature !== undefined ? { temperature: configured.temperature } : {}),
      ...(bundled.permission ? { permission: mergeBundledPermission(bundled.permission, existing.permission) } : {}),
      mode: bundled.mode,
    };
  }

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

function resolveAgentConfig(agentName?: string) {
  if (!pluginState.config?.agents || !agentName) return undefined;
  return pluginState.config.agents[agentName as keyof typeof pluginState.config.agents];
}

function createClientAdapter(input: Parameters<Plugin>[0]) {
  return {
    session: {
      create: async (params: { parentID?: string; title?: string }) => {
        const result = await input.client.session.create({
          body: {
            parentID: params.parentID,
            title: params.title,
          },
        });

        return {
          data: result.data ? { id: result.data.id } : undefined,
        };
      },
      prompt: async (params: {
        sessionID: string;
        agent?: string;
        system?: string;
        parts: Array<{ type: string; text: string }>;
        noReply?: boolean;
      }) => {
        const result = await input.client.session.prompt({
          path: { id: params.sessionID },
          body: {
            agent: params.agent,
            system: params.system,
            noReply: params.noReply,
            parts: params.parts.map((part) => ({
              type: 'text' as const,
              text: part.text,
            })),
          },
        });

        return { data: result.data };
      },
    },
  };
}

async function initializePlugin(input: Parameters<Plugin>[0]) {
  if (pluginState.isInitialized) return;

  const config = loadConfig(input.worktree);
  pluginState.config = config;

  const paths = getConfigPaths(input.worktree);
  const sqlite = createSQLiteClient(paths.dbPath);
  await sqlite.initialize();
  pluginState.sqlite = sqlite;

  const backgroundConfig: BackgroundManagerConfig = {
    concurrencyLimit: config.background?.maxConcurrent ?? 5,
    pollIntervalMs: config.background?.pollInterval ?? 5000,
  };
  const backgroundManager = createBackgroundManager(sqlite, backgroundConfig);
  await backgroundManager.initialize();
  pluginState.backgroundManager = backgroundManager;

  pluginState.interactiveManager = createInteractiveManager();

  const skillMcpOptions: SkillMcpManagerOptions = {
    builtinConfig: config.mcps as McpsConfig,
  };
  const skillMcpManager = createSkillMcpManager(skillMcpOptions);
  try {
    await skillMcpManager.initializeBuiltinMcps();
  } catch (error) {
    console.warn('[monkey-code] Failed to initialize some builtin MCPs:', error instanceof Error ? error.message : String(error));
  }
  pluginState.skillMcpManager = skillMcpManager;

  pluginState.backgroundCancelTool = await createBackgroundCancelTool(backgroundManager, sqlite);
  pluginState.isInitialized = true;
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
  pluginState.isInitialized = false;
}

async function handleDelegateTaskRequest(args: DelegateTaskInput, sessionID: string, input: Parameters<Plugin>[0]) {
  if (!pluginState.backgroundManager) throw new Error('Plugin not initialized');

  return delegateTask(args, {
    backgroundManager: pluginState.backgroundManager,
    client: createClientAdapter(input),
    parentSessionId: sessionID,
    agentConfig: resolveAgentConfig(args.agent ?? 'punch'),
    resolveAgentConfig,
    worktree: input.worktree,
    directory: input.directory,
  });
}

async function handleBackgroundOutputRequest(args: BackgroundOutputParams) {
  if (!pluginState.backgroundManager) throw new Error('Plugin not initialized');
  return getBackgroundOutput(pluginState.backgroundManager, args);
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
  await initializePlugin(input);
  const startWorkHook = pluginState.sqlite
    ? createStartWorkHook({
        sqlite: pluginState.sqlite,
        projectPath: buildProjectPath(input),
        worktree: input.worktree,
        defaultAgent: 'punch',
      })
    : null;
  const planContinuationHook = pluginState.sqlite && pluginState.backgroundManager
    ? createPlanContinuationHook({
        sqlite: pluginState.sqlite,
        backgroundManager: pluginState.backgroundManager,
        client: createClientAdapter(input),
        projectPath: buildProjectPath(input),
        worktree: input.worktree,
        defaultAgent: 'punch',
        resolveAgentConfig,
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
          return stringify(await handleSkillMcpRequest(args, input.worktree));
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
          return stringify(await handlePlanUpdateTaskRequest(args));
        },
      }),
    },
    event: async ({ event }) => {
      if (event.type === 'server.instance.disposed') {
        await shutdownPlugin();
      }

      if (event.type === 'session.idle') {
        const sessionID = ((event as { properties?: Record<string, unknown> }).properties?.sessionID as string | undefined) ?? '';
        if (sessionID) {
          await planContinuationHook?.continue({ sessionID });
        }
      }
    },
    'chat.params': async (hookInput, output) => {
      await handleChatParams(hookInput, output);
    },
    'chat.message': async (hookInput, output) => {
      if (startWorkHook) {
        await startWorkHook['chat.message']?.(hookInput as { sessionID: string }, output as { parts: Array<{ type: string; text?: string }>; message?: Record<string, unknown> });
      }
      if (stopAllHook) {
        await stopAllHook['chat.message']?.(hookInput as { sessionID: string; client?: unknown }, output as { parts: Array<{ type: string; text?: string }>; message?: Record<string, unknown> });
      }
    },
  };
};

const plugin = {
  id: 'monkey-code',
  server,
};

export default plugin;
