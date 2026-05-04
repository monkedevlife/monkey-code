import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import * as sqliteVss from "sqlite-vss";

export interface Task {
  id: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  command: string;
  output: string;
  created_at: number;
  completed_at?: number;
  embedding?: Float32Array;
  agent_name?: string;
  parent_session_id?: string;
  context?: string;
  plan_id?: string;
  plan_task_id?: string;
}

export interface SearchResult {
  id: number;
  content: string;
  metadata: string;
  created_at: number;
  distance: number;
}

export type PlanStatus = "draft" | "active" | "blocked" | "completed" | "cancelled" | "superseded";
export type PlanTaskStatus = "pending" | "in_progress" | "completed" | "blocked" | "cancelled";

export interface PlanRecord {
  id: string;
  project_path: string;
  worktree?: string;
  session_id?: string;
  parent_session_id?: string;
  agent_name: string;
  title: string;
  slug: string;
  status: PlanStatus;
  source_request: string;
  summary?: string;
  plan_markdown: string;
  plan_json?: string;
  created_at: number;
  updated_at: number;
  completed_at?: number;
  superseded_by?: string;
}

export interface SavePlanInput {
  id?: string;
  project_path: string;
  worktree?: string;
  session_id?: string;
  parent_session_id?: string;
  agent_name: string;
  title: string;
  slug?: string;
  status?: PlanStatus;
  source_request: string;
  summary?: string;
  plan_markdown: string;
  plan_json?: string;
  completed_at?: number;
  superseded_by?: string;
}

export interface PlanTaskRecord {
  id: string;
  plan_id: string;
  task_number?: string;
  title: string;
  status: PlanTaskStatus;
  wave?: string;
  depends_on: string[];
  category?: string;
  skills: string[];
  references: unknown[];
  acceptance_criteria: string[];
  qa_scenarios: unknown[];
  notes?: string;
  created_at: number;
  updated_at: number;
}

export interface SavePlanTaskInput {
  id?: string;
  task_number?: string;
  title: string;
  status?: PlanTaskStatus;
  wave?: string;
  depends_on?: string[];
  category?: string;
  skills?: string[];
  references?: unknown[];
  acceptance_criteria?: string[];
  qa_scenarios?: unknown[];
  notes?: string;
}

export interface UpdatePlanTaskInput {
  plan_id: string;
  task_id?: string;
  task_number?: string;
  status?: PlanTaskStatus;
  wave?: string;
  notes?: string;
}

export interface PlanEventRecord {
  id: number;
  plan_id: string;
  event_type: string;
  payload_json?: string;
  created_at: number;
}

export interface NextPlanTaskSelection {
  plan: PlanRecord;
  task: PlanTaskRecord;
}

export interface PlanListFilters {
  project_path?: string;
  session_id?: string;
  status?: PlanStatus;
  limit?: number;
}

export class SQLiteClientError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "SQLiteClientError";
  }
}

export class SQLiteClient {
  private db: Database;
  private initialized = false;
  private vssEnabled = false;

  constructor(dbPath: string = ":memory:") {
    this.db = new Database(dbPath);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.db.exec("PRAGMA foreign_keys = ON");
      this.tryLoadVssExtensions();
      this.createTasksTable();
      this.createMemoryTable();
      this.createPlansTable();
      this.createPlanTasksTable();
      this.createPlanEventsTable();
      this.createProjectsTable();
      this.initialized = true;
    } catch (error) {
      throw new SQLiteClientError(
        `Failed to initialize database: ${error instanceof Error ? error.message : String(error)}`,
        "INIT_ERROR"
      );
    }
  }

  private tryLoadVssExtensions(): void {
    try {
      sqliteVss.loadVector(this.db);
      sqliteVss.loadVss(this.db);

      const version = this.db
        .query("SELECT vss_version()")
        .get() as { "vss_version()": string } | undefined;

      if (version && version["vss_version()"]) {
        this.vssEnabled = true;
      }
    } catch {
      this.vssEnabled = false;
    }
  }

  private createTasksTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        command TEXT NOT NULL,
        output TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        embedding BLOB,
        agent_name TEXT,
        parent_session_id TEXT,
        context TEXT,
        plan_id TEXT,
        plan_task_id TEXT
      )
    `);

    const columns = this.db.query(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>;
    const existingColumns = new Set(columns.map((column) => column.name));

    if (!existingColumns.has("agent_name")) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN agent_name TEXT`);
    }
    if (!existingColumns.has("parent_session_id")) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN parent_session_id TEXT`);
    }
    if (!existingColumns.has("context")) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN context TEXT`);
    }
    if (!existingColumns.has("plan_id")) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN plan_id TEXT`);
    }
    if (!existingColumns.has("plan_task_id")) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN plan_task_id TEXT`);
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_parent_session_id ON tasks(parent_session_id)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_plan_id ON tasks(plan_id)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_plan_task_id ON tasks(plan_task_id)
    `);
  }

  private createMemoryTable(): void {
    if (this.vssEnabled) {
      try {
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS memory USING vss0(
            embedding(1536),
            content TEXT,
            metadata TEXT,
            created_at INTEGER
          )
        `);
      } catch {
        this.vssEnabled = false;
        this.createFallbackMemoryTable();
      }
    } else {
      this.createFallbackMemoryTable();
    }
  }

  private createFallbackMemoryTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        embedding BLOB,
        content TEXT,
        metadata TEXT,
        created_at INTEGER
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_created_at ON memory(created_at)
    `);
  }

  private createPlansTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        worktree TEXT,
        session_id TEXT,
        parent_session_id TEXT,
        agent_name TEXT NOT NULL,
        title TEXT NOT NULL,
        slug TEXT NOT NULL,
        status TEXT NOT NULL,
        source_request TEXT NOT NULL,
        summary TEXT,
        plan_markdown TEXT NOT NULL,
        plan_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        superseded_by TEXT
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_plans_project_path_created_at ON plans(project_path, created_at DESC)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_plans_slug_project_path ON plans(project_path, slug)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_plans_session_id ON plans(session_id)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status)
    `);
  }

  private createPlanTasksTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plan_tasks (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        task_number TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        wave TEXT,
        depends_on TEXT,
        category TEXT,
        skills_json TEXT,
        references_json TEXT,
        acceptance_criteria_json TEXT,
        qa_scenarios_json TEXT,
        notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE CASCADE
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_plan_tasks_plan_id ON plan_tasks(plan_id, created_at ASC)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_plan_tasks_task_number ON plan_tasks(plan_id, task_number)
    `);
  }

  private createPlanEventsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plan_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE CASCADE
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_plan_events_plan_id ON plan_events(plan_id, created_at ASC)
    `);
  }

  private createProjectsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        project_path TEXT UNIQUE NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_path ON projects(project_path)
    `);
  }

  private generatePlanId(): string {
    return `plan_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private generatePlanTaskId(): string {
    return `plan_task_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private slugifyPlanTitle(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      || "plan";
  }

  private parseJsonArray<T>(value: string | null | undefined): T[] {
    if (!value) return [];

    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  private mapPlanRow(row: {
    id: string;
    project_path: string;
    worktree: string | null;
    session_id: string | null;
    parent_session_id: string | null;
    agent_name: string;
    title: string;
    slug: string;
    status: string;
    source_request: string;
    summary: string | null;
    plan_markdown: string;
    plan_json: string | null;
    created_at: number;
    updated_at: number;
    completed_at: number | null;
    superseded_by: string | null;
  }): PlanRecord {
    return {
      id: row.id,
      project_path: row.project_path,
      worktree: row.worktree || undefined,
      session_id: row.session_id || undefined,
      parent_session_id: row.parent_session_id || undefined,
      agent_name: row.agent_name,
      title: row.title,
      slug: row.slug,
      status: row.status as PlanStatus,
      source_request: row.source_request,
      summary: row.summary || undefined,
      plan_markdown: row.plan_markdown,
      plan_json: row.plan_json || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at || undefined,
      superseded_by: row.superseded_by || undefined,
    };
  }

  private mapPlanTaskRow(row: {
    id: string;
    plan_id: string;
    task_number: string | null;
    title: string;
    status: string;
    wave: string | null;
    depends_on: string | null;
    category: string | null;
    skills_json: string | null;
    references_json: string | null;
    acceptance_criteria_json: string | null;
    qa_scenarios_json: string | null;
    notes: string | null;
    created_at: number;
    updated_at: number;
  }): PlanTaskRecord {
    return {
      id: row.id,
      plan_id: row.plan_id,
      task_number: row.task_number || undefined,
      title: row.title,
      status: row.status as PlanTaskStatus,
      wave: row.wave || undefined,
      depends_on: this.parseJsonArray<string>(row.depends_on),
      category: row.category || undefined,
      skills: this.parseJsonArray<string>(row.skills_json),
      references: this.parseJsonArray(row.references_json),
      acceptance_criteria: this.parseJsonArray<string>(row.acceptance_criteria_json),
      qa_scenarios: this.parseJsonArray(row.qa_scenarios_json),
      notes: row.notes || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async storeTask(task: Omit<Task, "created_at"> & { created_at?: number }): Promise<void> {
    this.ensureInitialized();

    const stmt = this.db.query(`
      INSERT OR REPLACE INTO tasks 
      (id, status, command, output, created_at, completed_at, embedding, agent_name, parent_session_id, context, plan_id, plan_task_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(
        task.id,
        task.status,
        task.command,
        task.output || "",
        task.created_at || Date.now(),
        task.completed_at || null,
        task.embedding || null,
        task.agent_name || null,
        task.parent_session_id || null,
        task.context || null,
        task.plan_id || null,
        task.plan_task_id || null,
      );
    } catch (error) {
      throw new SQLiteClientError(
        `Failed to store task: ${error instanceof Error ? error.message : String(error)}`,
        "STORE_TASK_ERROR"
      );
    } finally {
      stmt.finalize();
    }
  }

  async getTask(id: string): Promise<Task | null> {
    this.ensureInitialized();

    const stmt = this.db.query(`
      SELECT id, status, command, output, created_at, completed_at, embedding, agent_name, parent_session_id, context, plan_id, plan_task_id
      FROM tasks
      WHERE id = ?
    `);

    try {
      const row = stmt.get(id) as
        | {
            id: string;
            status: string;
            command: string;
            output: string;
            created_at: number;
            completed_at: number | null;
            embedding: Buffer | null;
            agent_name: string | null;
            parent_session_id: string | null;
            context: string | null;
            plan_id: string | null;
            plan_task_id: string | null;
          }
        | undefined;

      if (!row) {
        return null;
      }

      return {
        id: row.id,
        status: row.status as Task["status"],
        command: row.command,
        output: row.output,
        created_at: row.created_at,
        completed_at: row.completed_at || undefined,
        embedding: row.embedding
          ? new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4)
          : undefined,
        agent_name: row.agent_name || undefined,
        parent_session_id: row.parent_session_id || undefined,
        context: row.context || undefined,
        plan_id: row.plan_id || undefined,
        plan_task_id: row.plan_task_id || undefined,
      };
    } catch (error) {
      throw new SQLiteClientError(
        `Failed to get task: ${error instanceof Error ? error.message : String(error)}`,
        "GET_TASK_ERROR"
      );
    } finally {
      stmt.finalize();
    }
  }

  async getTasksByStatus(status: Task["status"]): Promise<Task[]> {
    this.ensureInitialized();

    const stmt = this.db.query(`
      SELECT id, status, command, output, created_at, completed_at, embedding, agent_name, parent_session_id, context, plan_id, plan_task_id
      FROM tasks
      WHERE status = ?
      ORDER BY created_at DESC
    `);

    try {
      const rows = stmt.all(status) as Array<{
        id: string;
        status: string;
        command: string;
        output: string;
        created_at: number;
        completed_at: number | null;
        embedding: Buffer | null;
        agent_name: string | null;
        parent_session_id: string | null;
        context: string | null;
        plan_id: string | null;
        plan_task_id: string | null;
      }>;

      return rows.map((row) => ({
        id: row.id,
        status: row.status as Task["status"],
        command: row.command,
        output: row.output,
        created_at: row.created_at,
        completed_at: row.completed_at || undefined,
        embedding: row.embedding
          ? new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4)
          : undefined,
        agent_name: row.agent_name || undefined,
        parent_session_id: row.parent_session_id || undefined,
        context: row.context || undefined,
        plan_id: row.plan_id || undefined,
        plan_task_id: row.plan_task_id || undefined,
      }));
    } catch (error) {
      throw new SQLiteClientError(
        `Failed to get tasks by status: ${error instanceof Error ? error.message : String(error)}`,
        "GET_TASKS_ERROR"
      );
    } finally {
      stmt.finalize();
    }
  }

  async storeMemory(
    embedding: Float32Array,
    content: string,
    metadata: Record<string, unknown> = {}
  ): Promise<number> {
    this.ensureInitialized();

    if (embedding.length !== 1536) {
      throw new SQLiteClientError(
        `Embedding must have 1536 dimensions, got ${embedding.length}`,
        "INVALID_EMBEDDING"
      );
    }

    if (this.vssEnabled) {
      return this.storeMemoryVss(embedding, content, metadata);
    }
    return this.storeMemoryFallback(embedding, content, metadata);
  }

  private storeMemoryVss(
    embedding: Float32Array,
    content: string,
    metadata: Record<string, unknown>
  ): number {
    const stmt = this.db.query(`
      INSERT INTO memory (embedding, content, metadata, created_at)
      VALUES (?, ?, ?, ?)
    `);

    try {
      const embeddingJson = JSON.stringify(Array.from(embedding));
      const metadataJson = JSON.stringify(metadata);
      const createdAt = Date.now();

      const result = stmt.run(embeddingJson, content, metadataJson, createdAt);
      return Number(result.lastInsertRowid);
    } finally {
      stmt.finalize();
    }
  }

  private storeMemoryFallback(
    embedding: Float32Array,
    content: string,
    metadata: Record<string, unknown>
  ): number {
    const stmt = this.db.query(`
      INSERT INTO memory (embedding, content, metadata, created_at)
      VALUES (?, ?, ?, ?)
    `);

    try {
      const metadataJson = JSON.stringify(metadata);
      const createdAt = Date.now();

      const result = stmt.run(embedding as any, content, metadataJson, createdAt);
      return Number(result.lastInsertRowid);
    } finally {
      stmt.finalize();
    }
  }

  async searchSimilar(
    embedding: Float32Array,
    limit: number = 5
  ): Promise<SearchResult[]> {
    this.ensureInitialized();

    if (embedding.length !== 1536) {
      throw new SQLiteClientError(
        `Query embedding must have 1536 dimensions, got ${embedding.length}`,
        "INVALID_EMBEDDING"
      );
    }

    if (limit < 1 || limit > 100) {
      throw new SQLiteClientError(
        `Limit must be between 1 and 100, got ${limit}`,
        "INVALID_LIMIT"
      );
    }

    if (this.vssEnabled) {
      return this.searchSimilarVss(embedding, limit);
    }
    return this.searchSimilarFallback(embedding, limit);
  }

  private searchSimilarVss(embedding: Float32Array, limit: number): SearchResult[] {
    const stmt = this.db.query(`
      SELECT rowid, content, metadata, created_at, distance
      FROM memory
      WHERE vss_search(embedding, ?)
      LIMIT ?
    `);

    try {
      const embeddingJson = JSON.stringify(Array.from(embedding));
      const rows = stmt.all(embeddingJson, limit) as Array<{
        rowid: number;
        content: string;
        metadata: string;
        created_at: number;
        distance: number;
      }>;

      return rows.map((row) => ({
        id: row.rowid,
        content: row.content,
        metadata: row.metadata,
        created_at: Number(row.created_at),
        distance: row.distance,
      }));
    } finally {
      stmt.finalize();
    }
  }

  private searchSimilarFallback(_embedding: Float32Array, limit: number): SearchResult[] {
    const stmt = this.db.query(`
      SELECT rowid, content, metadata, created_at
      FROM memory
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?
    `);

    try {
      const rows = stmt.all(limit) as Array<{
        rowid: number;
        content: string;
        metadata: string;
        created_at: number;
      }>;

      return rows.map((row) => ({
        id: row.rowid,
        content: row.content,
        metadata: row.metadata,
        created_at: Number(row.created_at),
        distance: 0,
      }));
    } finally {
      stmt.finalize();
    }
  }

  async deleteTask(id: string): Promise<boolean> {
    this.ensureInitialized();

    const stmt = this.db.query(`DELETE FROM tasks WHERE id = ?`);

    try {
      const result = stmt.run(id);
      return result.changes > 0;
    } catch (error) {
      throw new SQLiteClientError(
        `Failed to delete task: ${error instanceof Error ? error.message : String(error)}`,
        "DELETE_TASK_ERROR"
      );
    } finally {
      stmt.finalize();
    }
  }

  async deleteMemory(id: number): Promise<boolean> {
    this.ensureInitialized();

    const stmt = this.db.query(`DELETE FROM memory WHERE rowid = ?`);

    try {
      const result = stmt.run(id);
      return result.changes > 0;
    } catch (error) {
      throw new SQLiteClientError(
        `Failed to delete memory: ${error instanceof Error ? error.message : String(error)}`,
        "DELETE_MEMORY_ERROR"
      );
    } finally {
      stmt.finalize();
    }
  }

  async updateTaskStatus(
    id: string,
    status: Task["status"],
    output?: string,
    completedAt?: number
  ): Promise<void> {
    this.ensureInitialized();

    const stmt = this.db.query(`
      UPDATE tasks 
      SET status = ?, output = COALESCE(?, output), completed_at = ?
      WHERE id = ?
    `);

    try {
      stmt.run(status, output || null, completedAt || null, id);
    } catch (error) {
      throw new SQLiteClientError(
        `Failed to update task status: ${error instanceof Error ? error.message : String(error)}`,
        "UPDATE_TASK_ERROR"
      );
    } finally {
      stmt.finalize();
    }
  }

  async savePlan(input: SavePlanInput): Promise<PlanRecord> {
    this.ensureInitialized();

    const now = Date.now();
    const id = input.id ?? this.generatePlanId();
    const slug = input.slug?.trim() || this.slugifyPlanTitle(input.title);
    const status = input.status ?? "draft";
    const createdAt = input.id ? (await this.getPlanById(id))?.created_at ?? now : now;

    const stmt = this.db.query(`
      INSERT OR REPLACE INTO plans (
        id, project_path, worktree, session_id, parent_session_id, agent_name, title, slug, status,
        source_request, summary, plan_markdown, plan_json, created_at, updated_at, completed_at, superseded_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(
        id,
        input.project_path,
        input.worktree || null,
        input.session_id || null,
        input.parent_session_id || null,
        input.agent_name,
        input.title,
        slug,
        status,
        input.source_request,
        input.summary || null,
        input.plan_markdown,
        input.plan_json || null,
        createdAt,
        now,
        input.completed_at || null,
        input.superseded_by || null,
      );
    } catch (error) {
      throw new SQLiteClientError(
        `Failed to save plan: ${error instanceof Error ? error.message : String(error)}`,
        "SAVE_PLAN_ERROR"
      );
    } finally {
      stmt.finalize();
    }

    const saved = await this.getPlanById(id);
    if (!saved) {
      throw new SQLiteClientError("Plan was not found after save", "SAVE_PLAN_ERROR");
    }

    return saved;
  }

  async getPlanById(id: string): Promise<PlanRecord | null> {
    this.ensureInitialized();

    const stmt = this.db.query(`
      SELECT id, project_path, worktree, session_id, parent_session_id, agent_name, title, slug, status,
             source_request, summary, plan_markdown, plan_json, created_at, updated_at, completed_at, superseded_by
      FROM plans
      WHERE id = ?
    `);

    try {
      const row = stmt.get(id) as Parameters<SQLiteClient["mapPlanRow"]>[0] | undefined;
      return row ? this.mapPlanRow(row) : null;
    } catch (error) {
      throw new SQLiteClientError(
        `Failed to get plan: ${error instanceof Error ? error.message : String(error)}`,
        "GET_PLAN_ERROR"
      );
    } finally {
      stmt.finalize();
    }
  }

  async getPlanBySlug(projectPath: string, slugOrTitle: string): Promise<PlanRecord | null> {
    this.ensureInitialized();

    const normalizedSlug = this.slugifyPlanTitle(slugOrTitle);
    const stmt = this.db.query(`
      SELECT id, project_path, worktree, session_id, parent_session_id, agent_name, title, slug, status,
             source_request, summary, plan_markdown, plan_json, created_at, updated_at, completed_at, superseded_by
      FROM plans
      WHERE project_path = ? AND (slug = ? OR title = ?)
      ORDER BY created_at DESC
      LIMIT 1
    `);

    try {
      const row = stmt.get(projectPath, normalizedSlug, slugOrTitle) as Parameters<SQLiteClient["mapPlanRow"]>[0] | undefined;
      return row ? this.mapPlanRow(row) : null;
    } catch (error) {
      throw new SQLiteClientError(
        `Failed to get plan by slug: ${error instanceof Error ? error.message : String(error)}`,
        "GET_PLAN_ERROR"
      );
    } finally {
      stmt.finalize();
    }
  }

  async getLatestPlanForProject(projectPath: string, status?: PlanStatus): Promise<PlanRecord | null> {
    this.ensureInitialized();

    const stmt = status
      ? this.db.query(`
          SELECT id, project_path, worktree, session_id, parent_session_id, agent_name, title, slug, status,
                 source_request, summary, plan_markdown, plan_json, created_at, updated_at, completed_at, superseded_by
          FROM plans
          WHERE project_path = ? AND status = ?
          ORDER BY created_at DESC
          LIMIT 1
        `)
      : this.db.query(`
          SELECT id, project_path, worktree, session_id, parent_session_id, agent_name, title, slug, status,
                 source_request, summary, plan_markdown, plan_json, created_at, updated_at, completed_at, superseded_by
          FROM plans
          WHERE project_path = ?
          ORDER BY created_at DESC
          LIMIT 1
        `);

    try {
      const row = status
        ? (stmt.get(projectPath, status) as Parameters<SQLiteClient["mapPlanRow"]>[0] | undefined)
        : (stmt.get(projectPath) as Parameters<SQLiteClient["mapPlanRow"]>[0] | undefined);
      return row ? this.mapPlanRow(row) : null;
    } catch (error) {
      throw new SQLiteClientError(
        `Failed to get latest plan: ${error instanceof Error ? error.message : String(error)}`,
        "GET_PLAN_ERROR"
      );
    } finally {
      stmt.finalize();
    }
  }

  async listPlans(filters: PlanListFilters = {}): Promise<PlanRecord[]> {
    this.ensureInitialized();

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.project_path) {
      conditions.push("project_path = ?");
      params.push(filters.project_path);
    }
    if (filters.session_id) {
      conditions.push("session_id = ?");
      params.push(filters.session_id);
    }
    if (filters.status) {
      conditions.push("status = ?");
      params.push(filters.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(filters.limit ?? 25, 200));
    const stmt = this.db.query(`
      SELECT id, project_path, worktree, session_id, parent_session_id, agent_name, title, slug, status,
             source_request, summary, plan_markdown, plan_json, created_at, updated_at, completed_at, superseded_by
      FROM plans
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `);

    try {
      const rows = stmt.all(...params, limit) as Array<Parameters<SQLiteClient["mapPlanRow"]>[0]>;
      return rows.map((row) => this.mapPlanRow(row));
    } catch (error) {
      throw new SQLiteClientError(
        `Failed to list plans: ${error instanceof Error ? error.message : String(error)}`,
        "LIST_PLANS_ERROR"
      );
    } finally {
      stmt.finalize();
    }
  }

  async replacePlanTasks(planId: string, tasks: SavePlanTaskInput[]): Promise<PlanTaskRecord[]> {
    this.ensureInitialized();

    const deleteStmt = this.db.query(`DELETE FROM plan_tasks WHERE plan_id = ?`);
    const insertStmt = this.db.query(`
      INSERT INTO plan_tasks (
        id, plan_id, task_number, title, status, wave, depends_on, category,
        skills_json, references_json, acceptance_criteria_json, qa_scenarios_json,
        notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();

    try {
      deleteStmt.run(planId);

      for (const task of tasks) {
        insertStmt.run(
          task.id ?? this.generatePlanTaskId(),
          planId,
          task.task_number || null,
          task.title,
          task.status ?? "pending",
          task.wave || null,
          JSON.stringify(task.depends_on ?? []),
          task.category || null,
          JSON.stringify(task.skills ?? []),
          JSON.stringify(task.references ?? []),
          JSON.stringify(task.acceptance_criteria ?? []),
          JSON.stringify(task.qa_scenarios ?? []),
          task.notes || null,
          now,
          now,
        );
      }
    } catch (error) {
      throw new SQLiteClientError(
        `Failed to replace plan tasks: ${error instanceof Error ? error.message : String(error)}`,
        "SAVE_PLAN_TASKS_ERROR"
      );
    } finally {
      deleteStmt.finalize();
      insertStmt.finalize();
    }

    return this.getPlanTasks(planId);
  }

  async getPlanTasks(planId: string): Promise<PlanTaskRecord[]> {
    this.ensureInitialized();

    const stmt = this.db.query(`
      SELECT id, plan_id, task_number, title, status, wave, depends_on, category,
             skills_json, references_json, acceptance_criteria_json, qa_scenarios_json,
             notes, created_at, updated_at
      FROM plan_tasks
      WHERE plan_id = ?
      ORDER BY created_at ASC
    `);

    try {
      const rows = stmt.all(planId) as Array<Parameters<SQLiteClient["mapPlanTaskRow"]>[0]>;
      return rows.map((row) => this.mapPlanTaskRow(row));
    } catch (error) {
      throw new SQLiteClientError(
        `Failed to get plan tasks: ${error instanceof Error ? error.message : String(error)}`,
        "GET_PLAN_TASKS_ERROR"
      );
    } finally {
      stmt.finalize();
    }
  }

  async updatePlanTask(input: UpdatePlanTaskInput): Promise<PlanTaskRecord | null> {
    this.ensureInitialized();

    if (!input.task_id && !input.task_number) {
      throw new SQLiteClientError("task_id or task_number is required", "UPDATE_PLAN_TASK_ERROR");
    }

    const fields: string[] = [];
    const params: unknown[] = [];

    if (input.status) {
      fields.push("status = ?");
      params.push(input.status);
    }
    if (input.wave !== undefined) {
      fields.push("wave = ?");
      params.push(input.wave || null);
    }
    if (input.notes !== undefined) {
      fields.push("notes = ?");
      params.push(input.notes || null);
    }

    fields.push("updated_at = ?");
    params.push(Date.now());

    const whereClause = input.task_id ? "plan_id = ? AND id = ?" : "plan_id = ? AND task_number = ?";
    params.push(input.plan_id, input.task_id ?? input.task_number ?? "");

    const stmt = this.db.query(`UPDATE plan_tasks SET ${fields.join(", ")} WHERE ${whereClause}`);

    try {
      stmt.run(...params);
    } catch (error) {
      throw new SQLiteClientError(
        `Failed to update plan task: ${error instanceof Error ? error.message : String(error)}`,
        "UPDATE_PLAN_TASK_ERROR"
      );
    } finally {
      stmt.finalize();
    }

    const lookupStmt = this.db.query(`
      SELECT id, plan_id, task_number, title, status, wave, depends_on, category,
             skills_json, references_json, acceptance_criteria_json, qa_scenarios_json,
             notes, created_at, updated_at
      FROM plan_tasks
      WHERE ${whereClause}
      LIMIT 1
    `);

    try {
      const row = lookupStmt.get(input.plan_id, input.task_id ?? input.task_number ?? "") as Parameters<SQLiteClient["mapPlanTaskRow"]>[0] | undefined;
      return row ? this.mapPlanTaskRow(row) : null;
    } finally {
      lookupStmt.finalize();
    }
  }

  async appendPlanEvent(planId: string, eventType: string, payload?: Record<string, unknown>): Promise<PlanEventRecord> {
    this.ensureInitialized();

    const stmt = this.db.query(`
      INSERT INTO plan_events (plan_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?)
    `);

    const createdAt = Date.now();

    try {
      const result = stmt.run(planId, eventType, payload ? JSON.stringify(payload) : null, createdAt);
      return {
        id: Number(result.lastInsertRowid),
        plan_id: planId,
        event_type: eventType,
        payload_json: payload ? JSON.stringify(payload) : undefined,
        created_at: createdAt,
      };
    } catch (error) {
      throw new SQLiteClientError(
        `Failed to append plan event: ${error instanceof Error ? error.message : String(error)}`,
        "PLAN_EVENT_ERROR"
      );
    } finally {
      stmt.finalize();
    }
  }

  async getPlanEvents(planId: string): Promise<PlanEventRecord[]> {
    this.ensureInitialized();

    const stmt = this.db.query(`
      SELECT id, plan_id, event_type, payload_json, created_at
      FROM plan_events
      WHERE plan_id = ?
      ORDER BY created_at ASC, id ASC
    `);

    try {
      const rows = stmt.all(planId) as Array<{
        id: number;
        plan_id: string;
        event_type: string;
        payload_json: string | null;
        created_at: number;
      }>;

      return rows.map((row) => ({
        id: row.id,
        plan_id: row.plan_id,
        event_type: row.event_type,
        payload_json: row.payload_json || undefined,
        created_at: row.created_at,
      }));
    } catch (error) {
      throw new SQLiteClientError(
        `Failed to get plan events: ${error instanceof Error ? error.message : String(error)}`,
        "GET_PLAN_EVENTS_ERROR"
      );
    } finally {
      stmt.finalize();
    }
  }

  async getNextRunnablePlanTask(projectPath: string, sessionId?: string): Promise<NextPlanTaskSelection | null> {
    this.ensureInitialized();

    const activePlans = await this.listPlans({
      project_path: projectPath,
      ...(sessionId ? { session_id: sessionId } : {}),
      status: "active",
      limit: 50,
    });

    const plan = activePlans[0];
    if (!plan) return null;

    const tasks = await this.getPlanTasks(plan.id);
    if (tasks.some((task) => task.status === "in_progress")) {
      return null;
    }

    const taskByNumber = new Map(tasks.filter((task) => task.task_number).map((task) => [task.task_number as string, task]));
    const runnable = tasks.find((task) => {
      if (task.status !== "pending") return false;
      return task.depends_on.every((dependency) => taskByNumber.get(dependency)?.status === "completed");
    });

    if (runnable) {
      return { plan, task: runnable };
    }

    return null;
  }

  async finalizePlanStatus(planId: string): Promise<PlanRecord | null> {
    this.ensureInitialized();

    const plan = await this.getPlanById(planId);
    if (!plan) return null;

    const tasks = await this.getPlanTasks(planId);
    if (tasks.length === 0) return plan;

    if (tasks.every((task) => task.status === "completed" || task.status === "cancelled")) {
      const completedPlan = await this.savePlan({
        id: plan.id,
        project_path: plan.project_path,
        worktree: plan.worktree,
        session_id: plan.session_id,
        parent_session_id: plan.parent_session_id,
        agent_name: plan.agent_name,
        title: plan.title,
        slug: plan.slug,
        status: "completed",
        source_request: plan.source_request,
        summary: plan.summary,
        plan_markdown: plan.plan_markdown,
        plan_json: plan.plan_json,
        completed_at: Date.now(),
        superseded_by: plan.superseded_by,
      });
      await this.appendPlanEvent(planId, "plan.completed", {
        completedTaskCount: tasks.filter((task) => task.status === "completed").length,
        cancelledTaskCount: tasks.filter((task) => task.status === "cancelled").length,
      });
      return completedPlan;
    }

    return plan;
  }

  resolveProjectId(projectPath: string): string {
    this.ensureInitialized();

    const normalized = resolve(projectPath);
    const existing = this.db.query(
      'SELECT id FROM projects WHERE project_path = ?'
    ).get(normalized) as { id: string } | undefined;

    if (existing) return existing.id;

    const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.db.run(
      'INSERT INTO projects (id, project_path, created_at) VALUES (?, ?, ?)',
      [id, normalized, Date.now()]
    );
    return id;
  }

  getProjectId(projectPath: string): string | null {
    this.ensureInitialized();

    const normalized = resolve(projectPath);
    const row = this.db.query(
      'SELECT id FROM projects WHERE project_path = ?'
    ).get(normalized) as { id: string } | undefined;
    return row?.id ?? null;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.initialized = false;
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new SQLiteClientError(
        "Database not initialized. Call initialize() first.",
        "NOT_INITIALIZED"
      );
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  isVssEnabled(): boolean {
    return this.vssEnabled;
  }
}

export function createSQLiteClient(dbPath?: string): SQLiteClient {
  return new SQLiteClient(dbPath);
}

export default SQLiteClient;
