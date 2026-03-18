import { spawn, SpawnOptions, execSync } from "child_process";
import { promisify } from "util";
import { exec } from "child_process";
import { InteractiveSession, IInteractiveManager } from "../types/index.js";

const execAsync = promisify(exec);

export class InteractiveManagerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly sessionId?: string
  ) {
    super(message);
    this.name = "InteractiveManagerError";
  }
}

interface SessionInfo extends InteractiveSession {
  process?: ReturnType<typeof spawn>;
}

export class InteractiveManager implements IInteractiveManager {
  private sessions: Map<string, SessionInfo> = new Map();
  private _isAvailable: boolean;
  private sessionCounter = 0;

  constructor() {
    this._isAvailable = this.checkTmuxAvailable();
  }

  private checkTmuxAvailable(): boolean {
    try {
      execSync("which tmux", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  isAvailable(): boolean {
    return this._isAvailable;
  }

  async createSession(command: string, cwd?: string): Promise<InteractiveSession> {
    if (!this._isAvailable) {
      throw new InteractiveManagerError(
        "tmux is not available. Please install tmux to use interactive sessions.",
        "TMUX_NOT_AVAILABLE"
      );
    }

    this.sessionCounter++;
    const sessionId = `monkey-${Date.now()}-${this.sessionCounter}`;

    const session: SessionInfo = {
      id: sessionId,
      command,
      cwd,
      createdAt: Date.now(),
      isActive: false,
    };

    try {
      const spawnOptions: SpawnOptions = {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      };

      if (cwd) {
        spawnOptions.cwd = cwd;
      }

      const tmuxProcess = spawn(
        "tmux",
        [
          "new-session",
          "-d",
          "-s",
          sessionId,
          "-n",
          "monkey-code",
          command,
        ],
        spawnOptions
      );

      session.process = tmuxProcess;

      await new Promise<void>((resolve, reject) => {
        let errorOutput = "";

        tmuxProcess.stderr?.on("data", (data: Buffer) => {
          errorOutput += data.toString();
        });

        tmuxProcess.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(
              new InteractiveManagerError(
                `Failed to create tmux session: ${errorOutput || `Exit code ${code}`}`,
                "SESSION_CREATE_FAILED",
                sessionId
              )
            );
          }
        });

        tmuxProcess.on("error", (err) => {
          reject(
            new InteractiveManagerError(
              `Failed to spawn tmux: ${err.message}`,
              "SESSION_CREATE_ERROR",
              sessionId
            )
          );
        });

        setTimeout(() => {
          if (tmuxProcess.exitCode === null) {
            resolve();
          }
        }, 1000);
      });

      session.isActive = true;
      this.sessions.set(sessionId, session);

      return {
        id: session.id,
        command: session.command,
        cwd: session.cwd,
        createdAt: session.createdAt,
        isActive: session.isActive,
      };
    } catch (error) {
      this.cleanupSession(sessionId);
      throw error;
    }
  }

  async sendKeys(sessionId: string, keys: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new InteractiveManagerError(
        `Session ${sessionId} not found`,
        "SESSION_NOT_FOUND",
        sessionId
      );
    }

    if (!session.isActive) {
      throw new InteractiveManagerError(
        `Session ${sessionId} is not active`,
        "SESSION_NOT_ACTIVE",
        sessionId
      );
    }

    try {
      await execAsync(`tmux send-keys -t ${sessionId} ${this.escapeKeys(keys)}`);
    } catch (error) {
      throw new InteractiveManagerError(
        `Failed to send keys to session: ${error instanceof Error ? error.message : String(error)}`,
        "SEND_KEYS_FAILED",
        sessionId
      );
    }
  }

  async captureOutput(sessionId: string, lines: number = 100): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new InteractiveManagerError(
        `Session ${sessionId} not found`,
        "SESSION_NOT_FOUND",
        sessionId
      );
    }

    try {
      const { stdout } = await execAsync(
        `tmux capture-pane -t ${sessionId} -p -S -${lines}`
      );
      
      session.lastOutput = stdout;
      return stdout;
    } catch (error) {
      throw new InteractiveManagerError(
        `Failed to capture output: ${error instanceof Error ? error.message : String(error)}`,
        "CAPTURE_FAILED",
        sessionId
      );
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      await execAsync(`tmux kill-session -t ${sessionId} 2>/dev/null || true`);
    } catch {
    }

    this.cleanupSession(sessionId);
  }

  private cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.process) {
      try {
        session.process.kill("SIGTERM");
      } catch {
      }
    }
    this.sessions.delete(sessionId);
  }

  async listSessions(): Promise<InteractiveSession[]> {
    const sessions: InteractiveSession[] = [];
    
    for (const session of this.sessions.values()) {
      sessions.push({
        id: session.id,
        command: session.command,
        cwd: session.cwd,
        createdAt: session.createdAt,
        isActive: session.isActive,
        lastOutput: session.lastOutput,
      });
    }
    
    return sessions.sort((a, b) => b.createdAt - a.createdAt);
  }

  async cleanup(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    
    for (const sessionId of sessionIds) {
      await this.closeSession(sessionId);
    }
    
    this.sessions.clear();
  }

  private escapeKeys(keys: string): string {
    return keys
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/'/g, "\\'")
      .replace(/ /g, " ");
  }
}

export function createInteractiveManager(): InteractiveManager {
  return new InteractiveManager();
}

export default InteractiveManager;
