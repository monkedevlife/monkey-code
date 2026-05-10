import { readFileSync } from "fs";
import { dirname } from "path";
import { spawn, type ChildProcess } from "node:child_process";
import yaml from "js-yaml";
import type {
  McpServerConfig,
  SkillDefinition,
  ISkillMcpManager,
} from "../types/index.js";
import type { McpsConfig } from "../config.js";

export interface McpServerProcess {
  id: string;
  config: McpServerConfig;
  process?: ChildProcess;
  startedAt: number;
  lastUsedAt: number;
  sessionId?: string;
  connected: boolean;
}

export interface SkillMcpManagerOptions {
  builtinConfig?: McpsConfig;
  sessionId?: string;
}

export class SkillMcpManagerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly serverId?: string
  ) {
    super(message);
    this.name = "SkillMcpManagerError";
  }
}

export class SkillMcpManager implements ISkillMcpManager {
  private servers: Map<string, McpServerProcess> = new Map();
  private builtinConfig?: McpsConfig;
  private sessionId?: string;
  private cleanupHandlers: Array<() => Promise<void>> = [];

  constructor(options: SkillMcpManagerOptions = {}) {
    this.builtinConfig = options.builtinConfig;
    this.sessionId = options.sessionId;
    this.registerCleanupHandlers();
  }

  private registerCleanupHandlers(): void {
    const cleanup = async (): Promise<void> => {
      await this.cleanup();
    };

    const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGUSR2"];
    for (const signal of signals) {
      process.once(signal, () => void cleanup());
    }

    process.once("beforeExit", () => void cleanup());
    process.once("exit", () => void cleanup());
  }

  async initializeBuiltinMcps(config?: McpsConfig): Promise<void> {
    const mcpsConfig = config ?? this.builtinConfig;
    if (!mcpsConfig) {
      return;
    }

    if (mcpsConfig.context7?.enabled) {
      await this.initializeContext7(mcpsConfig.context7);
    }

    if (mcpsConfig.grepApp?.enabled) {
      await this.initializeGrepApp(mcpsConfig.grepApp);
    }
  }

  private async initializeContext7(
    config: McpsConfig["context7"]
  ): Promise<void> {
    if (!config) return;
  }

  private async initializeGrepApp(
    config: McpsConfig["grepApp"]
  ): Promise<void> {
    if (!config) return;
  }

  async loadSkill(skillPath: string): Promise<SkillDefinition> {
    const content = readFileSync(skillPath, "utf-8");
    const { data, body } = this.parseFrontmatter(content);

    const skillDir = dirname(skillPath);
    const skillName = String(data.name || "") || this.inferSkillName(skillPath);

    let mcpServers: McpServerConfig[] | undefined;

    if (data.mcp_servers && Array.isArray(data.mcp_servers)) {
      mcpServers = data.mcp_servers.map((mcp: Record<string, unknown>) => {
        const config: McpServerConfig = {
          type: "stdio",
          command: String(mcp.command || ""),
        };
        if (Array.isArray(mcp.args)) {
          config.args = mcp.args.map(String);
        }
        if (mcp.env && typeof mcp.env === "object") {
          config.env = mcp.env as Record<string, string>;
        }
        return config;
      });
    }

    return {
      name: skillName,
      description: data.description ? String(data.description) : undefined,
      mcpServers,
      content: body.trim(),
      path: skillPath,
      skillDir,
    };
  }

  private parseFrontmatter(
    content: string
  ): { data: Record<string, unknown>; body: string } {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n?---\r?\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return { data: {}, body: content };
    }

    const yamlContent = match[1] ?? "";
    const body = match[2] ?? "";

    try {
      const parsed = yaml.load(yamlContent, { schema: yaml.JSON_SCHEMA });
      const data = (parsed ?? {}) as Record<string, unknown>;
      return { data, body };
    } catch {
      return { data: {}, body };
    }
  }

  private inferSkillName(skillPath: string): string {
    const parts = skillPath.split("/");
    const filename = parts[parts.length - 1] || "";
    return filename.replace(/\.md$/i, "");
  }

   async startMcp(
     serverConfig: McpServerConfig,
     serverId?: string
   ): Promise<string> {
     if (serverConfig.type !== "stdio") {
       throw new SkillMcpManagerError(
         `Unsupported MCP server type: ${serverConfig.type}. Only 'stdio' is supported.`,
         "UNSUPPORTED_TYPE"
       );
     }

     const id = serverId || `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

     if (this.servers.has(id)) {
       await this.stopMcp(id);
     }

     const fullEnv = { ...process.env, ...serverConfig.env };

      const proc = spawn(serverConfig.command, serverConfig.args || [], {
        env: fullEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const server: McpServerProcess = {
        id,
        config: serverConfig,
        process: proc,
        startedAt: Date.now(),
        lastUsedAt: Date.now(),
        sessionId: this.sessionId,
        connected: true,
      };

     this.servers.set(id, server);

     await this.waitForServerReady(server);

     return id;
   }

   private async waitForServerReady(_server: McpServerProcess): Promise<void> {
     await new Promise<void>((resolve) => {
       setTimeout(() => {
         resolve();
       }, 100);
     });
   }

  async stopMcp(serverId: string): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) {
      return;
    }

    if (server.process) {
      try {
        server.process.kill("SIGTERM");

        await Promise.race([
          new Promise<void>((resolve) => server.process!.on("exit", () => resolve())),
          new Promise<void>((resolve) => setTimeout(resolve, 2000)),
        ]);

        if (server.process.pid && !server.process.killed) {
          server.process.kill("SIGKILL");
        }
      } catch {
      }
    }

    server.connected = false;
    this.servers.delete(serverId);
  }

  getClient(serverId: string): McpServerProcess | undefined {
    const server = this.servers.get(serverId);
    if (server) {
      server.lastUsedAt = Date.now();
    }
    return server;
  }

  getAllServers(): McpServerProcess[] {
    return Array.from(this.servers.values());
  }

  getServersBySession(sessionId: string): McpServerProcess[] {
    return this.getAllServers().filter((s) => s.sessionId === sessionId);
  }

  async stopSessionMcps(sessionId: string): Promise<void> {
    const servers = this.getServersBySession(sessionId);
    await Promise.all(servers.map((s) => this.stopMcp(s.id)));
  }

  async cleanup(): Promise<void> {
    for (const handler of this.cleanupHandlers) {
      try {
        await handler();
      } catch {
      }
    }

    const serverIds = Array.from(this.servers.keys());
    await Promise.all(serverIds.map((id) => this.stopMcp(id)));

    this.servers.clear();
  }

  isRunning(serverId: string): boolean {
    const server = this.servers.get(serverId);
    if (!server?.process) return false;
    return !server.process.killed;
  }

  isConnected(serverId: string): boolean {
    const server = this.servers.get(serverId);
    return server ? server.connected : false;
  }

  async sendJsonRpc(serverId: string, method: string, params?: unknown): Promise<unknown> {
    const server = this.servers.get(serverId);
    if (!server || !server.connected) {
      throw new SkillMcpManagerError(
        `MCP server ${serverId} is not connected`,
        "NOT_CONNECTED"
      );
    }

    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const request = { jsonrpc: "2.0", id: requestId, method, params };

    const stdin = server.process?.stdin as any;
    if (stdin?.write) {
      stdin.write(JSON.stringify(request) + "\n");
    }
    server.lastUsedAt = Date.now();

    return { sent: true, requestId };
  }

  getServerCount(): number {
    return this.servers.size;
  }
}

export function createSkillMcpManager(
  options?: SkillMcpManagerOptions
): SkillMcpManager {
  return new SkillMcpManager(options);
}
