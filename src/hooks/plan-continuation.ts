import { delegateTask, type OpenCodeClient } from "../tools/delegate-task.js";
import type { BackgroundManager } from "../managers/BackgroundManager.js";
import type { SQLiteClient } from "../utils/sqlite-client.js";
import { updatePlanTaskState } from "../tools/plan-store.js";

export interface PlanContinuationInput {
  sessionID: string;
}

export interface PlanContinuationClient extends OpenCodeClient {}

export interface PlanContinuationOptions {
  sqlite: SQLiteClient;
  backgroundManager: BackgroundManager;
  client: PlanContinuationClient;
  projectPath: string;
  worktree?: string;
  defaultAgent?: string;
  resolveAgentConfig?: (agentName: string) => unknown;
}

const activeContinuationLocks = new Set<string>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 0;

async function dispatchPlanTask(options: PlanContinuationOptions, input: PlanContinuationInput) {
  const { sqlite, backgroundManager, client, projectPath, defaultAgent = "punch", resolveAgentConfig } = options;

  const next = await sqlite.getNextRunnablePlanTask(projectPath, input.sessionID);
  if (!next) return null;

  const taskContext = [
    `Plan: ${next.plan.title}`,
    `Plan ID: ${next.plan.id}`,
    `Plan Task ID: ${next.task.id}`,
    ...(next.task.acceptance_criteria.length > 0 ? [`Acceptance Criteria: ${next.task.acceptance_criteria.join("; ")}`] : []),
    ...(next.task.notes ? [`Notes: ${next.task.notes}`] : []),
  ].join("\n");

  await updatePlanTaskState(sqlite, {
    planId: next.plan.id,
    taskId: next.task.id,
    status: "in_progress",
    eventType: "plan.task.dispatched",
    eventPayload: {
      sessionId: input.sessionID,
      agent: defaultAgent,
    },
  });

  const delegated = await delegateTask(
    {
      task: next.task.title,
      agent: defaultAgent,
      context: taskContext,
      planId: next.plan.id,
      planTaskId: next.task.id,
    },
    {
      backgroundManager,
      client,
      parentSessionId: input.sessionID,
      agentConfig: resolveAgentConfig?.(defaultAgent) as any,
      resolveAgentConfig: resolveAgentConfig as any,
      worktree: options.worktree,
      directory: projectPath,
    },
  );

  return { plan: next.plan, task: next.task, delegated };
}

export async function continueActivePlan(options: PlanContinuationOptions, input: PlanContinuationInput) {
  const { projectPath } = options;
  const lockKey = `${projectPath}::${input.sessionID}`;

  if (activeContinuationLocks.has(lockKey)) {
    return null;
  }

  if (DEBOUNCE_MS <= 0) {
    activeContinuationLocks.add(lockKey);
    try {
      return await dispatchPlanTask(options, input);
    } finally {
      activeContinuationLocks.delete(lockKey);
    }
  }

  const existingTimer = debounceTimers.get(lockKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  return new Promise<Awaited<ReturnType<typeof dispatchPlanTask>> | null>((resolve) => {
    debounceTimers.set(
      lockKey,
      setTimeout(async () => {
        debounceTimers.delete(lockKey);
        activeContinuationLocks.add(lockKey);
        try {
          const result = await dispatchPlanTask(options, input);
          resolve(result);
        } catch {
          resolve(null);
        } finally {
          activeContinuationLocks.delete(lockKey);
        }
      }, DEBOUNCE_MS)
    );
  });
}

export function createPlanContinuationHook(options: PlanContinuationOptions) {
  return {
    continue: (input: PlanContinuationInput) => continueActivePlan(options, input),
  };
}
