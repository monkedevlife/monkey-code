export type DelegatedTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface DelegatedTaskRouting {
  originalAgent: string;
  finalAgent: string;
  reason: string;
}

export interface DelegatedTaskRecord {
  id: string;
  sessionId: string;
  parentSessionId?: string;
  status: DelegatedTaskStatus;
  agent: string;
  requestedAgent?: string;
  description: string;
  timeout: number;
  createdAt: string;
  completedAt?: string;
  output?: string;
  error?: string;
  routing?: DelegatedTaskRouting;
}

export interface CreateDelegatedTaskInput {
  taskId?: string;
  sessionId: string;
  parentSessionId?: string;
  agent: string;
  requestedAgent?: string;
  description: string;
  timeout: number;
  createdAt?: string;
  routing?: DelegatedTaskRouting;
}

export class DelegatedTaskStore {
  private tasks = new Map<string, DelegatedTaskRecord>();
  private sessionToTaskId = new Map<string, string>();
  private pendingNotifications = new Map<string, string[]>();

  createTask(input: CreateDelegatedTaskInput): DelegatedTaskRecord {
    const task: DelegatedTaskRecord = {
      id: input.taskId ?? input.sessionId,
      sessionId: input.sessionId,
      parentSessionId: input.parentSessionId,
      status: 'in_progress',
      agent: input.agent,
      requestedAgent: input.requestedAgent,
      description: input.description,
      timeout: input.timeout,
      createdAt: input.createdAt ?? new Date().toISOString(),
      routing: input.routing,
    };

    this.tasks.set(task.id, task);
    this.sessionToTaskId.set(task.sessionId, task.id);
    return task;
  }

  getTask(taskId: string): DelegatedTaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  getTaskBySessionId(sessionId: string): DelegatedTaskRecord | undefined {
    const taskId = this.sessionToTaskId.get(sessionId);
    return taskId ? this.tasks.get(taskId) : undefined;
  }

  listActiveTasks(): DelegatedTaskRecord[] {
    return Array.from(this.tasks.values()).filter((task) => task.status === 'pending' || task.status === 'in_progress');
  }

  listTasks(): DelegatedTaskRecord[] {
    return Array.from(this.tasks.values());
  }

  updateOutput(taskId: string, output?: string) {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;
    task.output = output;
    return task;
  }

  markCompletedBySession(sessionId: string, output?: string) {
    const task = this.getTaskBySessionId(sessionId);
    if (!task || this.isTerminal(task.status)) return undefined;
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    task.output = output;
    return task;
  }

  markFailedBySession(sessionId: string, error: string, output?: string) {
    const task = this.getTaskBySessionId(sessionId);
    if (!task || this.isTerminal(task.status)) return undefined;
    task.status = 'failed';
    task.completedAt = new Date().toISOString();
    task.error = error;
    task.output = output;
    return task;
  }

  markCancelled(taskId: string, error?: string) {
    const task = this.tasks.get(taskId);
    if (!task || this.isTerminal(task.status)) return undefined;
    task.status = 'cancelled';
    task.completedAt = new Date().toISOString();
    task.error = error;
    return task;
  }

  queueNotification(sessionId: string | undefined, notification: string) {
    if (!sessionId || !notification.trim()) return;
    const existing = this.pendingNotifications.get(sessionId) ?? [];
    existing.push(notification);
    this.pendingNotifications.set(sessionId, existing);
  }

  consumeNotifications(sessionId: string): string[] {
    const notifications = this.pendingNotifications.get(sessionId) ?? [];
    this.pendingNotifications.delete(sessionId);
    return notifications;
  }

  clear() {
    this.tasks.clear();
    this.sessionToTaskId.clear();
    this.pendingNotifications.clear();
  }

  private isTerminal(status: DelegatedTaskStatus) {
    return status === 'completed' || status === 'failed' || status === 'cancelled';
  }
}
