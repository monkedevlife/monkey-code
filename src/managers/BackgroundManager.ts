import { spawn } from "node:child_process";
import { resolveCircuitBreakerSettings, recordToolCall, detectRepetitiveToolUse, type CircuitBreakerSettings, type ToolCallWindow } from "../utils/loop-detector.js";
import type { SQLiteClient } from "../utils/sqlite-client.js";
import { Task, IBackgroundManager } from "../types";
import { updatePlanTaskState } from "../tools/plan-store";

export interface TaskFilter {
  status?: Task["status"];
  parentSessionId?: string;
  agentName?: string;
}

export interface LaunchTaskInput {
  command: string;
  agentName?: string;
  context?: string;
  timeout?: number;
  parentSessionId?: string;
  planId?: string;
  planTaskId?: string;
}

export interface BackgroundTaskStatus extends Task {
  agentName?: string;
  context?: string;
  parentSessionId?: string;
  planId?: string;
  planTaskId?: string;
}

export interface NotificationCallback {
  (taskId: string, status: Task["status"], output?: string, error?: string): void | Promise<void>;
}

export interface BackgroundManagerConfig {
  concurrencyLimit?: number;
  pollIntervalMs?: number;
  staleTimeoutMs?: number;
  circuitBreaker?: Partial<CircuitBreakerSettings>;
}

const DEFAULT_CONCURRENCY_LIMIT = 5;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_STALE_TIMEOUT_MS = 2_700_000;
const MIN_RUNTIME_BEFORE_STALE_MS = 30_000;
const MAX_COMMAND_LENGTH = 100_000;

interface RunningTaskEntry {
  controller: AbortController;
  startedAt: number;
  toolCallCount: number;
  toolCallWindow?: ToolCallWindow;
  circuitBreaker: CircuitBreakerSettings;
}

function isBackgroundDebugEnabled(): boolean {
  const value = process.env.MONKEY_CODE_DEBUG_BACKGROUND?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export class BackgroundManager implements IBackgroundManager {
  private sqlite: SQLiteClient;
  private concurrencyLimit: number;
  private pollIntervalMs: number;
  private staleTimeoutMs: number;
  private circuitBreaker: CircuitBreakerSettings;
  private runningTasks: Map<string, RunningTaskEntry> = new Map();
  private notificationCallbacks: Map<string, NotificationCallback> = new Map();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private isPolling = false;
  private pendingPromises: Map<string, Promise<void>> = new Map();
  private pendingQueue: string[] = [];
  private queueProcessing = false;

  constructor(sqlite: SQLiteClient, config: BackgroundManagerConfig = {}) {
    this.sqlite = sqlite;
    this.concurrencyLimit = config.concurrencyLimit ?? DEFAULT_CONCURRENCY_LIMIT;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.staleTimeoutMs = config.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS;
    this.circuitBreaker = resolveCircuitBreakerSettings(config.circuitBreaker);
  }

  async initialize(): Promise<void> {
    await this.sqlite.initialize();
    await this.recoverOrphanedTasks();
    this.startPolling();
  }

  async shutdown(): Promise<void> {
    this.stopPolling();
    const runningIds = Array.from(this.runningTasks.keys());
    for (const taskId of runningIds) {
      await this.cancel(taskId).catch(() => {});
    }
    await Promise.all(Array.from(this.pendingPromises.values())).catch(() => {});
    this.notificationCallbacks.clear();
    this.pendingPromises.clear();
    this.pendingQueue = [];
  }

  private async recoverOrphanedTasks(): Promise<void> {
    const inProgress = await this.sqlite.getTasksByStatus("in_progress");
    for (const task of inProgress) {
      await this.sqlite.updateTaskStatus(
        task.id,
        "failed",
        "Task was orphaned (process restart detected)",
        Date.now()
      );
    }
  }

  private startPolling(): void {
    if (this.isPolling) return;
    this.isPolling = true;
    this.pollTimer = setInterval(() => {
      this.checkStaleTasks();
      this.drainQueue();
    }, this.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isPolling = false;
  }

  private async checkStaleTasks(): Promise<void> {
    const now = Date.now();
    for (const [taskId, entry] of this.runningTasks.entries()) {
      const runtime = now - entry.startedAt;
      if (runtime < MIN_RUNTIME_BEFORE_STALE_MS) continue;
      if (runtime <= this.staleTimeoutMs) continue;

      const task = await this.sqlite.getTask(taskId);
      if (!task || task.status !== "in_progress") continue;

      entry.controller.abort();
      await this.handleTaskCompletion(
        taskId,
        "failed",
        task.output || "",
        `Stale timeout: no completion after ${Math.round(runtime / 60000)} minutes`
      );
    }
  }

  private async drainQueue(): Promise<void> {
    if (this.queueProcessing) return;
    this.queueProcessing = true;

    try {
      while (this.pendingQueue.length > 0 && this.runningTasks.size < this.concurrencyLimit) {
        const taskId = this.pendingQueue.shift()!;
        await this.startTask(taskId);
      }
    } finally {
      this.queueProcessing = false;
    }
  }

  private async startTask(taskId: string): Promise<void> {
    const task = await this.sqlite.getTask(taskId);
    if (!task || task.status !== "pending") return;

    if (task.command.length > MAX_COMMAND_LENGTH) {
      await this.sqlite.updateTaskStatus(taskId, "failed", "Command exceeds maximum length", Date.now());
      return;
    }

    await this.sqlite.updateTaskStatus(taskId, "in_progress");
    if (task.plan_id && task.plan_task_id) {
      await updatePlanTaskState(this.sqlite, {
        planId: task.plan_id,
        taskId: task.plan_task_id,
        status: "in_progress",
        eventType: "plan.task.started",
        eventPayload: {
          backgroundTaskId: taskId,
          parentSessionId: task.parent_session_id,
          agentName: task.agent_name,
        },
      });
    }

    const entry: RunningTaskEntry = {
      controller: new AbortController(),
      startedAt: Date.now(),
      toolCallCount: 0,
      circuitBreaker: this.circuitBreaker,
    };
    this.runningTasks.set(taskId, entry);

    const taskPromise = this.executeTask(taskId, task.command, entry)
      .catch(async (error) => {
        if (!entry.controller.signal.aborted) {
          await this.handleTaskCompletion(
            taskId,
            "failed",
            "",
            error instanceof Error ? error.message : String(error)
          );
        }
      })
      .finally(() => {
        this.pendingPromises.delete(taskId);
      });
    this.pendingPromises.set(taskId, taskPromise);
  }

  private async executeTask(
    taskId: string,
    command: string,
    entry: RunningTaskEntry
  ): Promise<void> {
    if (entry.controller.signal.aborted) {
      await this.handleTaskCompletion(taskId, "cancelled", "", "Cancelled before execution");
      return;
    }

    const shell = process.env.SHELL || "/bin/sh";
    const proc = spawn(shell, ["-lc", command], {
      stdio: ["ignore", "pipe", "pipe"],
      signal: entry.controller.signal,
    });

    let spawnError: Error | undefined;
    proc.on("error", (err) => {
      spawnError = err;
    });

    const { stdout, stderr, exitCode } = await new Promise<{
      stdout: string;
      stderr: string;
      exitCode: number | null;
    }>((resolve) => {
      let out = "";
      let err = "";
      proc.stdout?.on("data", (chunk: Buffer) => {
        out += chunk.toString();
        const size = Buffer.byteLength(out, "utf8");
        if (size > MAX_COMMAND_LENGTH) {
          entry.controller.abort();
        }
      });
      proc.stderr?.on("data", (chunk: Buffer) => {
        err += chunk.toString();
      });
      proc.on("exit", (code) => {
        resolve({ stdout: out.slice(0, MAX_COMMAND_LENGTH), stderr: err.slice(0, MAX_COMMAND_LENGTH), exitCode: code });
      });
    });

    if (entry.controller.signal.aborted || (spawnError && spawnError.name === "AbortError")) {
      await this.handleTaskCompletion(taskId, "cancelled", stdout, stderr);
    } else if (spawnError) {
      await this.handleTaskCompletion(taskId, "failed", stdout, spawnError.message);
    } else if (exitCode === 0) {
      await this.handleTaskCompletion(taskId, "completed", stdout, stderr);
    } else {
      await this.handleTaskCompletion(taskId, "failed", stdout, stderr || `Exit code ${exitCode}`);
    }
  }

  private async handleTaskCompletion(
    taskId: string,
    status: Task["status"],
    output: string,
    error?: string
  ): Promise<void> {
    this.runningTasks.delete(taskId);
    const completedAt = Date.now();
    const outputText = error ? `${output}\nERROR: ${error}`.trim() : output;
    const dbStatus = status === "cancelled" ? "failed" : status;
    await this.sqlite.updateTaskStatus(
      taskId,
      dbStatus as "pending" | "in_progress" | "completed" | "failed",
      outputText,
      completedAt
    );

    const task = await this.sqlite.getTask(taskId);
    if (task?.plan_id && task.plan_task_id) {
      const planTaskStatus =
        status === "completed"
          ? "completed"
          : status === "cancelled"
            ? "cancelled"
            : status === "failed"
              ? "blocked"
              : undefined;
      if (planTaskStatus) {
        await updatePlanTaskState(this.sqlite, {
          planId: task.plan_id,
          taskId: task.plan_task_id,
          status: planTaskStatus,
          notes: outputText || undefined,
          eventType: `plan.task.${status}`,
          eventPayload: {
            backgroundTaskId: taskId,
            parentSessionId: task.parent_session_id,
            agentName: task.agent_name,
          },
        });
      }
    }

    const callback = this.notificationCallbacks.get(taskId);
    if (callback) {
      await Promise.resolve(callback(taskId, status, output, error));
      this.notificationCallbacks.delete(taskId);
    }

    this.drainQueue();
  }

  recordToolCall(taskId: string, toolName: string, input?: Record<string, unknown> | null): void {
    const entry = this.runningTasks.get(taskId);
    if (!entry) return;

    entry.toolCallCount++;
    entry.toolCallWindow = recordToolCall(
      entry.toolCallWindow,
      toolName,
      entry.circuitBreaker,
      input
    );

    if (entry.toolCallCount >= entry.circuitBreaker.maxToolCalls) {
      entry.controller.abort();
      this.handleTaskCompletion(
        taskId,
        "failed",
        "",
        `Circuit breaker: exceeded ${entry.circuitBreaker.maxToolCalls} tool calls`
      );
      return;
    }

    const loop = detectRepetitiveToolUse(entry.toolCallWindow);
    if (loop.triggered) {
      entry.controller.abort();
      this.handleTaskCompletion(
        taskId,
        "failed",
        "",
        `Circuit breaker: repetitive tool '${loop.toolName}' called ${loop.repeatedCount} consecutive times`
      );
    }
  }

  async launch(taskInput: LaunchTaskInput): Promise<string> {
    const taskId = this.generateTaskId();
    const now = Date.now();

    await this.sqlite.storeTask({
      id: taskId,
      status: "pending",
      command: taskInput.command,
      output: "",
      created_at: now,
      agent_name: taskInput.agentName,
      parent_session_id: taskInput.parentSessionId,
      context: taskInput.context,
      plan_id: taskInput.planId,
      plan_task_id: taskInput.planTaskId,
    });

    if (taskInput.parentSessionId) {
      this.notificationCallbacks.set(taskId, (id, status) => {
        if (isBackgroundDebugEnabled()) {
          console.log(`[BackgroundManager] Task ${id} completed: ${status}`);
        }
      });
    }

    this.pendingQueue.push(taskId);
    await this.drainQueue();
    return taskId;
  }

  async cancel(taskId: string): Promise<void> {
    const task = await this.sqlite.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status === "completed" || task.status === "failed") {
      throw new Error(`Cannot cancel task in ${task.status} state`);
    }
    if (task.status === "pending") {
      this.pendingQueue = this.pendingQueue.filter((id) => id !== taskId);
      await this.sqlite.updateTaskStatus(taskId, "failed", "Cancelled before execution", Date.now());
      if (task.plan_id && task.plan_task_id) {
        await updatePlanTaskState(this.sqlite, {
          planId: task.plan_id,
          taskId: task.plan_task_id,
          status: "cancelled",
          notes: "Cancelled before execution",
          eventType: "plan.task.cancelled",
          eventPayload: {
            backgroundTaskId: taskId,
            parentSessionId: task.parent_session_id,
            agentName: task.agent_name,
          },
        });
      }
      return;
    }

    const entry = this.runningTasks.get(taskId);
    if (entry) {
      entry.controller.abort();
      const promise = this.pendingPromises.get(taskId);
      if (promise) {
        await promise.catch(() => {});
      }
    }
  }

  async getStatus(taskId: string): Promise<Task | null> {
    const task = await this.sqlite.getTask(taskId);
    if (!task) return null;
    return {
      id: task.id,
      status: task.status as Task["status"],
      command: task.command,
      output: task.output,
      createdAt: task.created_at,
      completedAt: task.completed_at,
      agentName: task.agent_name,
      context: task.context,
      parentSessionId: task.parent_session_id,
      planId: task.plan_id,
      planTaskId: task.plan_task_id,
    } as BackgroundTaskStatus;
  }

  async getOutput(taskId: string): Promise<string | null> {
    const task = await this.sqlite.getTask(taskId);
    if (!task) return null;
    return task.output;
  }

  async listTasks(filter?: TaskFilter): Promise<Task[]> {
    let tasks: BackgroundTaskStatus[] = [];
    if (filter?.status) {
      const dbTasks = await this.sqlite.getTasksByStatus(filter.status as "pending" | "in_progress" | "completed" | "failed");
      tasks = dbTasks.map((t) => ({
        id: t.id,
        status: t.status as Task["status"],
        command: t.command,
        output: t.output,
        createdAt: t.created_at,
        completedAt: t.completed_at,
        agentName: t.agent_name,
        context: t.context,
        parentSessionId: t.parent_session_id,
        planId: t.plan_id,
        planTaskId: t.plan_task_id,
      }));
    } else {
      for (const s of ["pending", "in_progress", "completed", "failed"] as const) {
        const dbTasks = await this.sqlite.getTasksByStatus(s);
        tasks.push(...dbTasks.map((t) => ({
          id: t.id,
          status: t.status as Task["status"],
          command: t.command,
          output: t.output,
          createdAt: t.created_at,
          completedAt: t.completed_at,
          agentName: t.agent_name,
          context: t.context,
          parentSessionId: t.parent_session_id,
          planId: t.plan_id,
          planTaskId: t.plan_task_id,
        })));
      }
    }
    if (filter?.parentSessionId) {
      tasks = tasks.filter((t) => t.parentSessionId === filter.parentSessionId);
    }
    return tasks.sort((a, b) => b.createdAt - a.createdAt);
  }

  getRunningCount(): number {
    return this.runningTasks.size;
  }

  getQueuedCount(): number {
    return this.pendingQueue.length;
  }

  getConcurrencyLimit(): number {
    return this.concurrencyLimit;
  }

  setConcurrencyLimit(limit: number): void {
    if (limit < 1) {
      throw new Error("Concurrency limit must be at least 1");
    }
    this.concurrencyLimit = limit;
    this.drainQueue();
  }

  onTaskComplete(taskId: string, callback: NotificationCallback): void {
    this.notificationCallbacks.set(taskId, callback);
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

export function createBackgroundManager(sqlite: SQLiteClient, config?: BackgroundManagerConfig): BackgroundManager {
  return new BackgroundManager(sqlite, config);
}

export default BackgroundManager;
