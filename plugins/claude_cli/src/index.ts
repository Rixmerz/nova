/**
 * Claude CLI Plugin for Nova
 *
 * Provides Claude CLI integration via node-pty.
 * Supports haiku, sonnet, and opus models.
 */

// Types imported from nova-core (inline for plugin isolation)
type AgentCapability = 'chat' | 'tools' | 'plan' | 'code' | 'realtime' | 'vision';
type SessionStatus = 'starting' | 'running' | 'completed' | 'error' | 'stopped';

interface IAgent {
  id: string;
  name: string;
  capabilities: AgentCapability[];
  enabled: boolean;
  description?: string;
}

interface ISession {
  id: string;
  agentId: string;
  pluginId: string;
  status: SessionStatus;
  createdAt: Date;
  projectPath: string;
  resumeSessionId?: string;
}

interface InvokeOptions {
  projectPath: string;
  prompt: string;
  resume?: string;
}

interface MessageResult {
  success: boolean;
  error?: string;
}

interface SessionEvent {
  sessionId: string;
  type: 'output' | 'error' | 'complete' | 'status';
  data: {
    message?: Record<string, unknown>;
    raw?: string;
    error?: string;
    exitCode?: number | null;
  };
  timestamp: string;
}

type StreamCallback = (event: SessionEvent) => void;

interface PluginManifest {
  name: string;
  version: string;
  type: 'llm';
  source: 'cli' | 'api' | 'adk' | 'local' | 'grpc';
  supports: AgentCapability[];
  entry: string;
  agents: Array<{
    id: string;
    name: string;
    capabilities?: AgentCapability[];
    description?: string;
  }>;
}

interface INovaPlugin {
  readonly name: string;
  readonly type: 'llm';
  readonly source: 'cli' | 'api' | 'adk' | 'local' | 'grpc';
  readonly supports: AgentCapability[];
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  readonly agents: IAgent[];
  getAgent(agentId: string): IAgent | undefined;
  invoke(agentId: string, options: InvokeOptions): Promise<ISession>;
  message(sessionId: string, message: string): Promise<MessageResult>;
  stream(sessionId: string, callback: StreamCallback): () => void;
  stop(sessionId: string): Promise<void>;
  getSession(sessionId: string): ISession | undefined;
  getSessions(): ISession[];
}

interface ConfigLoader {
  isAgentEnabled(pluginName: string, agentId: string): boolean;
}
import { PTYSession } from './pty-session.js';

/**
 * Claude CLI Plugin
 *
 * Implements INovaPlugin for Claude CLI integration.
 */
class ClaudeCLIPlugin implements INovaPlugin {
  // Metadata
  readonly name = 'claude_cli';
  readonly type = 'llm' as const;
  readonly source = 'cli' as const;
  readonly supports: AgentCapability[] = ['chat', 'tools', 'plan', 'code'];

  // Internal state
  private _agents: IAgent[] = [];
  private sessions = new Map<string, PTYSession>();
  private configLoader: ConfigLoader;
  private manifest: PluginManifest;
  private initialized = false;

  constructor(manifest: PluginManifest, configLoader: ConfigLoader) {
    this.manifest = manifest;
    this.configLoader = configLoader;
  }

  /**
   * Available agents
   */
  get agents(): IAgent[] {
    return this._agents;
  }

  /**
   * Initialize the plugin
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log('[ClaudeCLI] Initializing plugin...');

    // Build agent list from manifest with config overrides
    this._agents = this.manifest.agents.map((agentDef) => ({
      id: agentDef.id,
      name: agentDef.name,
      capabilities: (agentDef.capabilities || ['chat']) as AgentCapability[],
      enabled: this.configLoader.isAgentEnabled(this.name, agentDef.id),
      description: agentDef.description,
    }));

    console.log(`[ClaudeCLI] Loaded ${this._agents.length} agents:`);
    for (const agent of this._agents) {
      console.log(`  - ${agent.id}: ${agent.enabled ? 'enabled' : 'disabled'}`);
    }

    this.initialized = true;
    console.log('[ClaudeCLI] Plugin initialized');
  }

  /**
   * Shutdown the plugin
   */
  async shutdown(): Promise<void> {
    console.log('[ClaudeCLI] Shutting down...');

    // Stop all active sessions
    const stopPromises = Array.from(this.sessions.keys()).map((sessionId) =>
      this.stop(sessionId)
    );

    await Promise.all(stopPromises);

    this.sessions.clear();
    this.initialized = false;

    console.log('[ClaudeCLI] Plugin shutdown complete');
  }

  /**
   * Get a specific agent by ID
   */
  getAgent(agentId: string): IAgent | undefined {
    return this._agents.find((a) => a.id === agentId);
  }

  /**
   * Invoke an agent and create a new session
   */
  async invoke(agentId: string, options: InvokeOptions): Promise<ISession> {
    const agent = this.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent '${agentId}' not found`);
    }

    if (!agent.enabled) {
      throw new Error(`Agent '${agentId}' is disabled`);
    }

    console.log(`[ClaudeCLI] Invoking agent ${agentId} with prompt: ${options.prompt.substring(0, 50)}...`);

    const session = new PTYSession({
      projectPath: options.projectPath,
      prompt: options.prompt,
      agentId,
      resume: options.resume,
    });

    // Start the session
    await session.start(options.prompt);

    // Store session
    this.sessions.set(session.id, session);

    console.log(`[ClaudeCLI] Session created: ${session.id}`);

    return session;
  }

  /**
   * Send a message to a running session
   */
  async message(sessionId: string, message: string): Promise<MessageResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, error: `Session '${sessionId}' not found` };
    }

    return session.sendMessage(message);
  }

  /**
   * Subscribe to session events
   */
  stream(sessionId: string, callback: StreamCallback): () => void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.error(`[ClaudeCLI] Session '${sessionId}' not found for streaming`);
      return () => {};
    }

    return session.subscribe(callback);
  }

  /**
   * Stop a running session
   */
  async stop(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    await session.stop();
    this.sessions.delete(sessionId);

    console.log(`[ClaudeCLI] Session stopped: ${sessionId}`);
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): ISession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all active sessions
   */
  getSessions(): ISession[] {
    return Array.from(this.sessions.values());
  }
}

/**
 * Plugin factory function
 * This is the default export that the plugin loader calls
 */
export default function createPlugin(
  manifest: PluginManifest,
  configLoader: ConfigLoader
): INovaPlugin {
  return new ClaudeCLIPlugin(manifest, configLoader);
}

// Also export as named function
export { createPlugin };
