import type { Task } from '../types/index.js';
import { BackgroundManager } from '../managers/BackgroundManager.js';

export interface BackgroundOutputParams {
  taskId: string;
  wait?: boolean;
  timeout?: number;
}

export interface BackgroundOutputResult {
  taskId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  output?: string;
  error?: string;
  startTime: string;
  endTime?: string;
}

export async function getBackgroundOutput(
  manager: BackgroundManager,
  params: BackgroundOutputParams
): Promise<BackgroundOutputResult> {
  const { taskId, wait = false, timeout = 30000 } = params;

  if (!taskId || typeof taskId !== 'string') {
    throw new Error('taskId is required and must be a string');
  }

  const startTime = new Date().toISOString();
  const task = await manager.getStatus(taskId);

  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  if (!wait || task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
    return formatTaskResult(task, startTime);
  }

  return await waitForTaskCompletion(manager, taskId, startTime, timeout);
}

async function waitForTaskCompletion(
  manager: BackgroundManager,
  taskId: string,
  startTime: string,
  timeout: number
): Promise<BackgroundOutputResult> {
  const pollInterval = 100;
  const endTime = Date.now() + timeout;

  while (Date.now() < endTime) {
    const task = await manager.getStatus(taskId);

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return formatTaskResult(task, startTime);
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  const task = await manager.getStatus(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  return formatTaskResult(task, startTime);
}

function formatTaskResult(task: Task, startTime: string): BackgroundOutputResult {
  const endTime = task.completedAt ? new Date(task.completedAt).toISOString() : undefined;

  return {
    taskId: task.id,
    status: task.status,
    output: task.output,
    error: task.error,
    startTime,
    endTime
  };
}

export default getBackgroundOutput;
