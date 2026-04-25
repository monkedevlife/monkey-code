import { BackgroundManager } from '../managers/BackgroundManager';
import { SQLiteClient } from '../utils/sqlite-client';

export interface BackgroundCancelParams {
  taskId: string;
  all?: boolean;
}

export interface BackgroundCancelResult {
  success: boolean;
  taskId?: string;
  cancelledCount: number;
  summary: string;
  cancelledTasks: string[];
  notFoundTasks: string[];
  alreadyCompletedTasks: string[];
  error?: string;
  nextActions: Array<{
    action: string;
    description: string;
    tool: string;
    params: Record<string, string>;
  }>;
}

function makeNextActions(taskId?: string): BackgroundCancelResult['nextActions'] {
  const actions: BackgroundCancelResult['nextActions'] = [
    {
      action: 'list-tasks',
      description: 'List all background tasks',
      tool: 'background-output',
      params: {}
    }
  ];
  if (taskId) {
    actions.push({
      action: 'check-status',
      description: 'Check task status',
      tool: 'background-output',
      params: { taskId }
    });
  }
  return actions;
}

export class BackgroundCancelTool {
  private backgroundManager: BackgroundManager;
  private sqlite: SQLiteClient;

  constructor(backgroundManager: BackgroundManager, sqlite: SQLiteClient) {
    this.backgroundManager = backgroundManager;
    this.sqlite = sqlite;
  }

  async execute(params: BackgroundCancelParams): Promise<BackgroundCancelResult> {
    try {
      if (params.all) {
        return await this.cancelAllTasks();
      }

      if (!params.taskId) {
        return {
          success: false,
          cancelledCount: 0,
          summary: 'Either taskId or all parameter is required',
          cancelledTasks: [],
          notFoundTasks: [],
          alreadyCompletedTasks: [],
          error: 'Missing required parameter',
          nextActions: makeNextActions()
        };
      }

      return await this.cancelSingleTask(params.taskId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        taskId: params.taskId,
        cancelledCount: 0,
        summary: 'Failed to cancel task',
        cancelledTasks: [],
        notFoundTasks: params.taskId ? [params.taskId] : [],
        alreadyCompletedTasks: [],
        error: errorMessage,
        nextActions: makeNextActions(params.taskId)
      };
    }
  }

  private async cancelSingleTask(taskId: string): Promise<BackgroundCancelResult> {
    const task = await this.sqlite.getTask(taskId);

    if (!task) {
      return {
        success: false,
        taskId,
        cancelledCount: 0,
        summary: `Task not found: ${taskId}`,
        cancelledTasks: [],
        notFoundTasks: [taskId],
        alreadyCompletedTasks: [],
        error: 'Task not found',
        nextActions: makeNextActions(taskId)
      };
    }

    if (task.status === 'completed' || task.status === 'failed') {
      return {
        success: false,
        taskId,
        cancelledCount: 0,
        summary: `Cannot cancel task in ${task.status} state`,
        cancelledTasks: [],
        notFoundTasks: [],
        alreadyCompletedTasks: [taskId],
        error: `Task is already ${task.status}`,
        nextActions: makeNextActions(taskId)
      };
    }

    await this.backgroundManager.cancel(taskId);

    return {
      success: true,
      taskId,
      cancelledCount: 1,
      summary: `Task ${taskId} cancelled`,
      cancelledTasks: [taskId],
      notFoundTasks: [],
      alreadyCompletedTasks: [],
      nextActions: makeNextActions(taskId)
    };
  }

  private async cancelAllTasks(): Promise<BackgroundCancelResult> {
    const allTasks = await this.backgroundManager.listTasks();
    const cancellableTasks = allTasks.filter(
      (task) => task.status !== 'completed' && task.status !== 'failed'
    );

    const cancelledTasks: string[] = [];
    const errors: string[] = [];

    for (const task of cancellableTasks) {
      try {
        await this.backgroundManager.cancel(task.id);
        cancelledTasks.push(task.id);
      } catch (error) {
        errors.push(`Failed to cancel ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const alreadyCompletedTasks = allTasks
      .filter((task) => task.status === 'completed' || task.status === 'failed')
      .map((task) => task.id);

    if (errors.length > 0) {
      return {
        success: false,
        cancelledCount: cancelledTasks.length,
        summary: `Cancelled ${cancelledTasks.length} task(s) with errors`,
        cancelledTasks,
        notFoundTasks: [],
        alreadyCompletedTasks,
        error: errors.join('; '),
        nextActions: makeNextActions()
      };
    }

    return {
      success: true,
      cancelledCount: cancelledTasks.length,
      summary: `Cancelled ${cancelledTasks.length} task(s)`,
      cancelledTasks,
      notFoundTasks: [],
      alreadyCompletedTasks,
      nextActions: makeNextActions()
    };
  }
}

export async function createBackgroundCancelTool(
  backgroundManager: BackgroundManager,
  sqlite: SQLiteClient
): Promise<BackgroundCancelTool> {
  return new BackgroundCancelTool(backgroundManager, sqlite);
}

export default BackgroundCancelTool;
