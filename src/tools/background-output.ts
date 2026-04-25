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
  waited: boolean;
  waitTimeMs?: number;
  outputTruncated: boolean;
  outputLength: number;
  nextActions: Array<{
    action: string;
    description: string;
    tool: string;
    params: Record<string, string>;
  }>;
}

const MAX_OUTPUT_LENGTH = 10000;

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
    return formatTaskResult(task, startTime, wait, 0);
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
  const waitStart = Date.now();
  const endTime = waitStart + timeout;

  while (Date.now() < endTime) {
    const task = await manager.getStatus(taskId);

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return formatTaskResult(task, startTime, true, Date.now() - waitStart);
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  const task = await manager.getStatus(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  return formatTaskResult(task, startTime, true, Date.now() - waitStart);
}

function formatTaskResult(
  task: Task,
  startTime: string,
  waited: boolean,
  waitTimeMs: number
): BackgroundOutputResult {
  const endTime = task.completedAt ? new Date(task.completedAt).toISOString() : undefined;
  const rawOutput = task.output || '';
  const outputTruncated = rawOutput.length > MAX_OUTPUT_LENGTH;
  const output = outputTruncated ? rawOutput.slice(0, MAX_OUTPUT_LENGTH) : rawOutput;

  const nextActions: BackgroundOutputResult['nextActions'] = [];

  if (task.status === 'pending' || task.status === 'in_progress') {
    nextActions.push({
      action: 'poll-again',
      description: 'Check task progress again',
      tool: 'background-output',
      params: { taskId: task.id }
    });
    nextActions.push({
      action: 'cancel',
      description: 'Cancel the running task',
      tool: 'background-cancel',
      params: { taskId: task.id }
    });
  } else if (task.status === 'completed') {
    nextActions.push({
      action: 'delegate-followup',
      description: 'Delegate a follow-up task',
      tool: 'delegate-task',
      params: { task: 'Follow-up task' }
    });
  }

  return {
    taskId: task.id,
    status: task.status,
    output: output || undefined,
    error: task.error,
    startTime,
    endTime,
    waited,
    waitTimeMs: waited ? waitTimeMs : undefined,
    outputTruncated,
    outputLength: rawOutput.length,
    nextActions
  };
}

export default getBackgroundOutput;
