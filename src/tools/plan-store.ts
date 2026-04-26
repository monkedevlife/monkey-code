import type {
  PlanListFilters,
  PlanRecord,
  PlanStatus,
  PlanTaskRecord,
  PlanTaskStatus,
  SavePlanInput,
  SavePlanTaskInput,
  SQLiteClient,
} from "../utils/sqlite-client.js";

export interface PlanTaskInput {
  id?: string;
  taskNumber?: string;
  title: string;
  status?: PlanTaskStatus;
  wave?: string;
  dependsOn?: string[];
  category?: string;
  skills?: string[];
  references?: unknown[];
  acceptanceCriteria?: string[];
  qaScenarios?: unknown[];
  notes?: string;
}

export interface PlanWriteInput {
  id?: string;
  projectPath: string;
  worktree?: string;
  sessionId?: string;
  parentSessionId?: string;
  agent: string;
  title: string;
  slug?: string;
  status?: PlanStatus;
  sourceRequest: string;
  summary?: string;
  markdown: string;
  plan?: Record<string, unknown>;
  tasks?: PlanTaskInput[];
}

export interface PlanWriteOutput {
  plan: PlanRecord;
  tasks: PlanTaskRecord[];
}

export interface PlanReadInput {
  id?: string;
  projectPath?: string;
  planName?: string;
  status?: PlanStatus;
}

export interface PlanReadOutput {
  plan: PlanRecord;
  tasks: PlanTaskRecord[];
}

export interface PlanListInput {
  projectPath?: string;
  sessionId?: string;
  status?: PlanStatus;
  limit?: number;
}

export interface PlanStartWorkInput {
  planName: string;
  projectPath: string;
  sessionId?: string;
  worktree?: string;
  agent?: string;
}

export interface PlanStartWorkOutput {
  plan: PlanRecord;
  tasks: PlanTaskRecord[];
  prompt: string;
}

export interface PlanTaskUpdateInput {
  planId: string;
  taskId?: string;
  taskNumber?: string;
  status?: PlanTaskStatus;
  wave?: string;
  notes?: string;
  eventType?: string;
  eventPayload?: Record<string, unknown>;
}

function normalizeTasks(tasks: PlanTaskInput[] | undefined): SavePlanTaskInput[] {
  return (tasks ?? []).map((task) => ({
    id: task.id,
    task_number: task.taskNumber,
    title: task.title,
    status: task.status,
    wave: task.wave,
    depends_on: task.dependsOn,
    category: task.category,
    skills: task.skills,
    references: task.references,
    acceptance_criteria: task.acceptanceCriteria,
    qa_scenarios: task.qaScenarios,
    notes: task.notes,
  }));
}

function buildPlanPrompt(plan: PlanRecord, tasks: PlanTaskRecord[], agent: string) {
  const taskLines = tasks.map((task) => {
    const taskNumber = task.task_number ? `${task.task_number}. ` : "";
    const wave = task.wave ? ` | wave: ${task.wave}` : "";
    const dependencies = task.depends_on.length > 0 ? ` | depends_on: ${task.depends_on.join(", ")}` : "";
    return `- ${taskNumber}${task.title} [${task.status}]${wave}${dependencies}`;
  });

  return [
    `You are starting work from the stored plan \"${plan.title}\".`,
    "",
    `Plan ID: ${plan.id}`,
    `Project Path: ${plan.project_path}`,
    ...(plan.worktree ? [`Worktree: ${plan.worktree}`] : []),
    `Executing Agent: ${agent}`,
    `Plan Status: ${plan.status}`,
    "",
    "## Summary",
    plan.summary || "No summary provided.",
    "",
    "## Markdown Plan",
    plan.plan_markdown,
    "",
    "## Tasks",
    ...(taskLines.length > 0 ? taskLines : ["- No structured tasks stored."]),
    "",
    "Begin execution from this plan. Keep the database-backed plan as the source of truth.",
  ].join("\n");
}

export async function writePlan(sqlite: SQLiteClient, input: PlanWriteInput): Promise<PlanWriteOutput> {
  const planInput: SavePlanInput = {
    id: input.id,
    project_path: input.projectPath,
    worktree: input.worktree,
    session_id: input.sessionId,
    parent_session_id: input.parentSessionId,
    agent_name: input.agent,
    title: input.title,
    slug: input.slug,
    status: input.status,
    source_request: input.sourceRequest,
    summary: input.summary,
    plan_markdown: input.markdown,
    plan_json: input.plan ? JSON.stringify(input.plan) : undefined,
  };

  const plan = await sqlite.savePlan(planInput);
  const tasks = await sqlite.replacePlanTasks(plan.id, normalizeTasks(input.tasks));
  await sqlite.appendPlanEvent(plan.id, input.id ? "plan.updated" : "plan.created", {
    agent: input.agent,
    sessionId: input.sessionId,
    taskCount: tasks.length,
  });

  return { plan, tasks };
}

export async function readPlan(sqlite: SQLiteClient, input: PlanReadInput): Promise<PlanReadOutput> {
  let plan: PlanRecord | null = null;

  if (input.id) {
    plan = await sqlite.getPlanById(input.id);
  } else if (input.projectPath && input.planName) {
    plan = await sqlite.getPlanBySlug(input.projectPath, input.planName);
  } else if (input.projectPath) {
    plan = await sqlite.getLatestPlanForProject(input.projectPath, input.status);
  }

  if (!plan) {
    throw new Error("Plan not found");
  }

  const tasks = await sqlite.getPlanTasks(plan.id);
  return { plan, tasks };
}

export async function listPlans(sqlite: SQLiteClient, input: PlanListInput): Promise<PlanRecord[]> {
  const filters: PlanListFilters = {
    project_path: input.projectPath,
    session_id: input.sessionId,
    status: input.status,
    limit: input.limit,
  };

  return sqlite.listPlans(filters);
}

export async function startWorkFromPlan(sqlite: SQLiteClient, input: PlanStartWorkInput): Promise<PlanStartWorkOutput> {
  const { plan, tasks } = await readPlan(sqlite, {
    projectPath: input.projectPath,
    planName: input.planName,
  });

  if (plan.status === "draft" || plan.status === "blocked") {
    const activated = await sqlite.savePlan({
      id: plan.id,
      project_path: plan.project_path,
      worktree: input.worktree ?? plan.worktree,
      session_id: input.sessionId ?? plan.session_id,
      parent_session_id: plan.parent_session_id,
      agent_name: input.agent ?? "punch",
      title: plan.title,
      slug: plan.slug,
      status: "active",
      source_request: plan.source_request,
      summary: plan.summary,
      plan_markdown: plan.plan_markdown,
      plan_json: plan.plan_json,
      completed_at: plan.completed_at,
      superseded_by: plan.superseded_by,
    });

    await sqlite.appendPlanEvent(activated.id, "plan.started", {
      sessionId: input.sessionId,
      worktree: input.worktree,
      agent: input.agent ?? "punch",
    });

    return {
      plan: activated,
      tasks,
      prompt: buildPlanPrompt(activated, tasks, input.agent ?? "punch"),
    };
  }

  await sqlite.appendPlanEvent(plan.id, "plan.resumed", {
    sessionId: input.sessionId,
    worktree: input.worktree,
    agent: input.agent ?? "punch",
  });

  return {
    plan,
    tasks,
    prompt: buildPlanPrompt(plan, tasks, input.agent ?? "punch"),
  };
}

export async function updatePlanTaskState(sqlite: SQLiteClient, input: PlanTaskUpdateInput): Promise<PlanTaskRecord | null> {
  const updated = await sqlite.updatePlanTask({
    plan_id: input.planId,
    task_id: input.taskId,
    task_number: input.taskNumber,
    status: input.status,
    wave: input.wave,
    notes: input.notes,
  });

  if (updated && input.eventType) {
    await sqlite.appendPlanEvent(input.planId, input.eventType, {
      taskId: updated.id,
      taskNumber: updated.task_number,
      status: updated.status,
      ...(input.eventPayload ?? {}),
    });
  }

  return updated;
}
