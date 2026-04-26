// OpenCode Plugin Core Types

// Task and Background Task Management
export interface Task {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  command: string;
  output?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

export interface BackgroundTask extends Task {
  agentName?: string;
  context?: string;
  timeout?: number;
  parentSessionId?: string;
  planId?: string;
  planTaskId?: string;
  result?: unknown;
}

// Interactive Session Management
export interface InteractiveSession {
  id: string;
  command: string;
  cwd?: string;
  createdAt: number;
  isActive: boolean;
  lastOutput?: string;
}

// Skill and MCP Configuration
export interface McpServerConfig {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SkillDefinition {
  name: string;
  description?: string;
  mcpServers?: McpServerConfig[];
  content?: string;
  path?: string;
  skillDir?: string;
}

// Tool Context for Hook Execution
export interface ToolContext {
  toolName: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

// Hook Handlers Interface
export interface HookHandlers {
  onConfig?: (context: PluginContext) => void | Promise<void>;
  onTool?: (context: ToolContext) => unknown | Promise<unknown>;
  onEvent?: (event: PluginEvent) => void | Promise<void>;
  onChatParams?: (input: unknown, output: unknown) => void | Promise<void>;
  onChatMessage?: (input: unknown, output: unknown) => void | Promise<void>;
}

// Plugin Event Types
export type PluginEventType = 'session:start' | 'session:end' | 'task:complete' | 'task:failed' | 'session:idle';

export interface PluginEvent {
  type: PluginEventType;
  timestamp: number;
  data?: Record<string, unknown>;
}

// Plugin Context
export interface PluginContext {
  projectRoot: string;
  configPath: string;
  sessionId?: string;
}

// Tool Definition for Registration
export interface ToolDefinition {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

// Plugin Interface (Main Export)
export interface MonkeyCodePlugin {
  name: string;
  version: string;
  hooks: HookHandlers;
}

// Manager Interfaces
export interface IBackgroundManager {
  launch(task: BackgroundTask): Promise<string>;
  cancel(taskId: string): Promise<void>;
  getStatus(taskId: string): Promise<Task | null>;
  getOutput(taskId: string): Promise<string | null>;
  listTasks(filter?: Partial<Task>): Promise<Task[]>;
}

export interface IInteractiveManager {
  createSession(command: string, cwd?: string): Promise<InteractiveSession>;
  sendKeys(sessionId: string, keys: string): Promise<void>;
  captureOutput(sessionId: string): Promise<string>;
  closeSession(sessionId: string): Promise<void>;
  isAvailable(): boolean;
}

export interface ISkillMcpManager {
  initializeBuiltinMcps(config: any): Promise<void>;
  loadSkill(skillPath: string): Promise<SkillDefinition>;
  startMcp(serverConfig: McpServerConfig): Promise<string>;
  stopMcp(serverId: string): Promise<void>;
  getClient(serverId: string): any;
  cleanup(): Promise<void>;
}

// Database Types for SQLite
export interface TaskRecord {
  id: string;
  status: string;
  command: string;
  output?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
  sessionId?: string;
}

export interface MemoryRecord {
  id: string;
  embedding: number[];
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}
