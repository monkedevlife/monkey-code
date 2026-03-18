import { BackgroundManager } from '../managers/BackgroundManager';
import { SQLiteClient } from '../utils/sqlite-client';

export interface BackgroundCancelParams {
  taskId: string;
  all?: boolean;
}

export interface BackgroundCancelResult {
  success: boolean;
  taskId?: string;
  cancelledCount?: number;
  message: string;
  error?: string;
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
          message: 'Either taskId or all parameter is required',
          error: 'Missing required parameter'
        };
      }

      return await this.cancelSingleTask(params.taskId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        taskId: params.taskId,
        message: 'Failed to cancel task',
        error: errorMessage
      };
    }
  }

  private async cancelSingleTask(taskId: string): Promise<BackgroundCancelResult> {
    const task = await this.sqlite.getTask(taskId);

    if (!task) {
      return {
        success: false,
        taskId,
        message: `Task not found: ${taskId}`,
        error: 'Task not found'
      };
    }

    if (task.status === 'completed' || task.status === 'failed') {
      return {
        success: false,
        taskId,
        message: `Cannot cancel task in ${task.status} state`,
        error: `Task is already ${task.status}`
      };
    }

    await this.backgroundManager.cancel(taskId);

    return {
      success: true,
      taskId,
      message: `Task ${taskId} has been cancelled`
    };
  }

  private async cancelAllTasks(): Promise<BackgroundCancelResult> {
    const allTasks = await this.backgroundManager.listTasks();
    const cancellableTasks = allTasks.filter(
      (task) => task.status !== 'completed' && task.status !== 'failed'
    );

    let cancelledCount = 0;
    const errors: string[] = [];

    for (const task of cancellableTasks) {
      try {
        await this.backgroundManager.cancel(task.id);
        cancelledCount++;
      } catch (error) {
        errors.push(`Failed to cancel ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        cancelledCount,
        message: `Cancelled ${cancelledCount} task(s) with errors`,
        error: errors.join('; ')
      };
    }

    return {
      success: true,
      cancelledCount,
      message: `Successfully cancelled ${cancelledCount} task(s)`
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
