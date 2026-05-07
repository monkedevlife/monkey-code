import type { Task } from '../types/index.js';
import { BackgroundManager } from '../managers/BackgroundManager.js';
import {
  transcriptExists,
  readTranscriptEntries,
  formatTranscriptProgress,
} from '../hooks/transcript.js';

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
  progress?: string;
  toolCallCount?: number;
  nextActions: Array<{
    action: string;
    description: string;
    tool: string;
    params: Record<string, string>;
  }>;
}

const MAX_OUTPUT_LENGTH = 10000;
const TRANSCRIPT_POLL_INTERVAL_MS = 1000;
const TRANSCRIPT_IDLE_TIMEOUT_MS = 5000;

function isRunning(status: string): boolean {
  return status === 'pending' || status === 'in_progress';
}

function isTerminal(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
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

  if (task) {
    if (!wait || isTerminal(task.status)) {
      return formatTaskResult(task, startTime, wait, 0);
    }
    return await waitForTaskCompletion(manager, taskId, startTime, timeout);
  }

  if (transcriptExists(taskId)) {
    if (!wait) {
      return formatTranscriptResult(taskId, startTime, false, 0);
    }
    return await waitForTranscriptActivity(taskId, startTime, timeout);
  }

  throw new Error(`Task not found: ${taskId}`);
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

    if (isTerminal(task.status)) {
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

async function waitForTranscriptActivity(
  taskId: string,
  startTime: string,
  timeout: number,
): Promise<BackgroundOutputResult> {
  const waitStart = Date.now();
  const endTime = waitStart + timeout;
  let lastEntryCount = -1;
  let idleSince = 0;

  while (Date.now() < endTime) {
    const entries = readTranscriptEntries(taskId);
    const currentCount = entries.length;

    if (currentCount !== lastEntryCount) {
      lastEntryCount = currentCount;
      idleSince = Date.now();
    } else if (idleSince > 0 && Date.now() - idleSince >= TRANSCRIPT_IDLE_TIMEOUT_MS) {
      return formatTranscriptResult(taskId, startTime, true, Date.now() - waitStart);
    }

    await new Promise(resolve => setTimeout(resolve, TRANSCRIPT_POLL_INTERVAL_MS));
  }

  return formatTranscriptResult(taskId, startTime, true, Date.now() - waitStart);
}

function formatTranscriptResult(
  taskId: string,
  startTime: string,
  waited: boolean,
  waitTimeMs: number,
): BackgroundOutputResult {
  const entries = readTranscriptEntries(taskId);
  const progress = formatTranscriptProgress(entries);

  const status: BackgroundOutputResult['status'] =
    entries.length > 0 ? 'in_progress' : 'pending';

  const output = progress || undefined;

  const nextActions: BackgroundOutputResult['nextActions'] = [];

  nextActions.push({
    action: 'poll-again',
    description: 'Check task progress again',
    tool: 'background-output',
    params: { taskId },
  });
  nextActions.push({
    action: 'cancel',
    description: 'Cancel the running task',
    tool: 'background-cancel',
    params: { taskId },
  });

  return {
    taskId,
    status,
    output,
    startTime,
    waited,
    waitTimeMs: waited ? waitTimeMs : undefined,
    outputTruncated: (output?.length ?? 0) > MAX_OUTPUT_LENGTH,
    outputLength: output?.length ?? 0,
    progress,
    toolCallCount: entries.length,
    nextActions,
  };
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

  if (isRunning(task.status)) {
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

  let progress: string | undefined;
  if (isRunning(task.status) && task.id) {
    if (transcriptExists(task.id)) {
      const entries = readTranscriptEntries(task.id);
      progress = formatTranscriptProgress(entries);
    }
  }

  return {
    taskId: task.id,
    status: task.status as BackgroundOutputResult['status'],
    output: output || undefined,
    error: task.error,
    startTime,
    endTime,
    waited,
    waitTimeMs: waited ? waitTimeMs : undefined,
    outputTruncated,
    outputLength: rawOutput.length,
    progress,
    toolCallCount: progress ? readTranscriptEntries(task.id).length : undefined,
    nextActions
  };
}

export default getBackgroundOutput;
