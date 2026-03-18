import { Database } from "bun:sqlite";
import * as sqliteVss from "sqlite-vss";

export interface Task {
  id: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  command: string;
  output: string;
  created_at: number;
  completed_at?: number;
  embedding?: Float32Array;
}

export interface MemoryEntry {
  id: number;
  embedding: Float32Array;
  content: string;
  metadata: string;
  created_at: number;
  distance?: number;
}

export interface SearchResult {
  id: number;
  content: string;
  metadata: string;
  created_at: number;
  distance: number;
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

  constructor(dbPath: string = ":memory:") {
    this.db = new Database(dbPath);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Load sqlite-vss extensions
      sqliteVss.loadVector(this.db);
      sqliteVss.loadVss(this.db);

      // Verify sqlite-vss is loaded
      const version = this.db
        .query("SELECT vss_version()")
        .get() as { "vss_version()": string };
      if (!version || !version["vss_version()"]) {
        throw new SQLiteClientError(
          "Failed to load sqlite-vss extension",
          "VSS_LOAD_ERROR"
        );
      }

      // Create tasks table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          command TEXT NOT NULL,
          output TEXT,
          created_at INTEGER NOT NULL,
          completed_at INTEGER,
          embedding BLOB
        )
      `);

      // Create index on status for faster queries
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)
      `);

      // Create memory virtual table for vector search
      // Using 1536 dimensions (standard for OpenAI embeddings)
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory USING vss0(
          embedding(1536),
          content TEXT,
          metadata TEXT,
          created_at INTEGER
        )
      `);

      this.initialized = true;
    } catch (error) {
      throw new SQLiteClientError(
        `Failed to initialize database: ${error instanceof Error ? error.message : String(error)}`,
        "INIT_ERROR"
      );
    }
  }

  async storeTask(task: Omit<Task, "created_at"> & { created_at?: number }): Promise<void> {
    this.ensureInitialized();

    const stmt = this.db.query(`
      INSERT OR REPLACE INTO tasks 
      (id, status, command, output, created_at, completed_at, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(
        task.id,
        task.status,
        task.command,
        task.output || "",
        task.created_at || Date.now(),
        task.completed_at || null,
        task.embedding || null
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
      SELECT id, status, command, output, created_at, completed_at, embedding
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
      SELECT id, status, command, output, created_at, completed_at, embedding
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

    const stmt = this.db.query(`
      INSERT INTO memory (embedding, content, metadata, created_at)
      VALUES (?, ?, ?, ?)
    `);

    try {
      // Convert Float32Array to JSON array string for sqlite-vss
      const embeddingJson = JSON.stringify(Array.from(embedding));
      const metadataJson = JSON.stringify(metadata);
      const createdAt = Date.now();

      const result = stmt.run(embeddingJson, content, metadataJson, createdAt);
      return Number(result.lastInsertRowid);
    } catch (error) {
      throw new SQLiteClientError(
        `Failed to store memory: ${error instanceof Error ? error.message : String(error)}`,
        "STORE_MEMORY_ERROR"
      );
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
        created_at: row.created_at,
        distance: row.distance,
      }));
    } catch (error) {
      throw new SQLiteClientError(
        `Failed to search similar memories: ${error instanceof Error ? error.message : String(error)}`,
        "SEARCH_ERROR"
      );
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
}

export function createSQLiteClient(dbPath?: string): SQLiteClient {
  return new SQLiteClient(dbPath);
}

export default SQLiteClient;
