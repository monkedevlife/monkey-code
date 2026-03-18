import { SQLiteClient } from "../utils/sqlite-client";
import { BackgroundTask, Task, IBackgroundManager } from "../types";

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
}

export interface NotificationCallback {
  (taskId: string, status: Task["status"], output?: string, error?: string): void;
}

export interface BackgroundManagerConfig {
  concurrencyLimit?: number;
  pollIntervalMs?: number;
}

export class BackgroundManager implements IBackgroundManager {
  private sqlite: SQLiteClient;
  private concurrencyLimit: number;
  private pollIntervalMs: number;
  private runningTasks: Map<string, AbortController> = new Map();
  private notificationCallbacks: Map<string, NotificationCallback> = new Map();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private isPolling = false;
  private pendingPromises: Map<string, Promise<void>> = new Map();

  constructor(sqlite: SQLiteClient, config: BackgroundManagerConfig = {}) {
    this.sqlite = sqlite;
    this.concurrencyLimit = config.concurrencyLimit ?? 5;
    this.pollIntervalMs = config.pollIntervalMs ?? 5000;
  }

  async initialize(): Promise<void> {
    await this.sqlite.initialize();
    this.startPolling();
  }

  async shutdown(): Promise<void> {
    this.stopPolling();
    const runningTaskIds = Array.from(this.runningTasks.keys());
    for (const taskId of runningTaskIds) {
      await this.cancel(taskId);
    }
    await Promise.all(this.pendingPromises.values());
    this.notificationCallbacks.clear();
    this.pendingPromises.clear();
  }

  private startPolling(): void {
    if (this.isPolling) return;
    this.isPolling = true;
    this.pollTimer = setInterval(() => {
      this.processPendingTasks();
    }, this.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isPolling = false;
  }

  private async processPendingTasks(): Promise<void> {
    const runningCount = this.runningTasks.size;
    const availableSlots = this.concurrencyLimit - runningCount;
    if (availableSlots <= 0) return;
    const pendingTasks = await this.sqlite.getTasksByStatus("pending");
    const tasksToStart = pendingTasks.slice(0, availableSlots);
    for (const task of tasksToStart) {
      await this.startTask(task.id);
    }
  }

  private async startTask(taskId: string): Promise<void> {
    const task = await this.sqlite.getTask(taskId);
    if (!task || task.status !== "pending") return;
    await this.sqlite.updateTaskStatus(taskId, "in_progress");
    const abortController = new AbortController();
    this.runningTasks.set(taskId, abortController);
    const taskPromise = this.executeTask(taskId, task.command, abortController.signal)
      .catch(async (error) => {
        if (!abortController.signal.aborted) {
          await this.handleTaskCompletion(taskId, "failed", "", error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        this.pendingPromises.delete(taskId);
      });
    this.pendingPromises.set(taskId, taskPromise);
  }

  private async executeTask(taskId: string, command: string, signal: AbortSignal): Promise<void> {
    try {
      if (signal.aborted) {
        throw new Error("Task was cancelled");
      }
      const proc = Bun.spawn(command.split(" "), { stdout: "pipe", stderr: "pipe", signal });
      await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = proc.exitCode;
      if (signal.aborted) {
        await this.handleTaskCompletion(taskId, "cancelled", stdout, stderr);
      } else if (exitCode === 0) {
        await this.handleTaskCompletion(taskId, "completed", stdout, stderr);
      } else {
        await this.handleTaskCompletion(taskId, "failed", stdout, stderr || `Process exited with code ${exitCode}`);
      }
    } catch (error) {
      if (signal.aborted) {
        await this.handleTaskCompletion(taskId, "cancelled", "", "Task was cancelled");
      } else {
        throw error;
      }
    }
  }

  private async handleTaskCompletion(taskId: string, status: Task["status"], output: string, error?: string): Promise<void> {
    this.runningTasks.delete(taskId);
    const completedAt = Date.now();
    const outputText = error ? `${output}\nERROR: ${error}`.trim() : output;
    const dbStatus = status === "cancelled" ? "failed" : status;
    await this.sqlite.updateTaskStatus(taskId, dbStatus as "pending" | "in_progress" | "completed" | "failed", outputText, completedAt);
    const callback = this.notificationCallbacks.get(taskId);
    if (callback) {
      callback(taskId, status, output, error);
      this.notificationCallbacks.delete(taskId);
    }
    this.processPendingTasks();
  }

  async launch(taskInput: LaunchTaskInput): Promise<string> {
    const taskId = this.generateTaskId();
    const now = Date.now();
    const task: BackgroundTask = {
      id: taskId,
      status: "pending",
      command: taskInput.command,
      createdAt: now,
      agentName: taskInput.agentName,
      context: taskInput.context,
      timeout: taskInput.timeout,
      parentSessionId: taskInput.parentSessionId,
    };
    await this.sqlite.storeTask({ id: task.id, status: task.status, command: task.command, output: "", created_at: task.createdAt });
    if (taskInput.parentSessionId) {
      this.notificationCallbacks.set(taskId, (id, status) => {
        console.log(`[BackgroundManager] Task ${id} completed with status: ${status}`);
      });
    }
    await this.processPendingTasks();
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
      await this.sqlite.updateTaskStatus(taskId, "failed", "Task was cancelled before execution", Date.now());
      return;
    }
    const abortController = this.runningTasks.get(taskId);
    if (abortController) {
      abortController.abort();
      const promise = this.pendingPromises.get(taskId);
      if (promise) {
        await promise.catch(() => {});
      }
    }
  }

  async getStatus(taskId: string): Promise<Task | null> {
    const task = await this.sqlite.getTask(taskId);
    if (!task) return null;
    const status: Task["status"] = task.status as Task["status"];
    return {
      id: task.id,
      status,
      command: task.command,
      output: task.output,
      createdAt: task.created_at,
      completedAt: task.completed_at,
    };
  }

  async getOutput(taskId: string): Promise<string | null> {
    const task = await this.sqlite.getTask(taskId);
    if (!task) return null;
    return task.output;
  }

  async listTasks(filter?: TaskFilter): Promise<Task[]> {
    let tasks: Task[] = [];
    if (filter?.status) {
      const dbStatus = filter.status;
      const dbTasks = await this.sqlite.getTasksByStatus(dbStatus as "pending" | "in_progress" | "completed" | "failed");
      tasks = dbTasks.map((t) => {
        return { id: t.id, status: t.status as Task["status"], command: t.command, output: t.output, createdAt: t.created_at, completedAt: t.completed_at };
      });
    } else {
      const dbStatuses = ["pending", "in_progress", "completed", "failed"] as const;
      for (const dbStatus of dbStatuses) {
        const dbTasks = await this.sqlite.getTasksByStatus(dbStatus);
        tasks.push(...dbTasks.map((t) => {
          return { id: t.id, status: t.status as Task["status"], command: t.command, output: t.output, createdAt: t.created_at, completedAt: t.completed_at };
        }));
      }
    }
    if (filter?.parentSessionId) {
      tasks = tasks.filter((t) => (t as BackgroundTask).parentSessionId === filter.parentSessionId);
    }
    return tasks.sort((a, b) => b.createdAt - a.createdAt);
  }

  getRunningCount(): number {
    return this.runningTasks.size;
  }

  getConcurrencyLimit(): number {
    return this.concurrencyLimit;
  }

  setConcurrencyLimit(limit: number): void {
    if (limit < 1) {
      throw new Error("Concurrency limit must be at least 1");
    }
    this.concurrencyLimit = limit;
    this.processPendingTasks();
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
