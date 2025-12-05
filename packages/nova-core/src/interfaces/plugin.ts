/**
 * Plugin Interface
 *
 * The core interface that all Nova plugins must implement.
 * This provides a unified API for different LLM integrations:
 * - CLI tools (claude, gemini-cli, etc.)
 * - REST APIs (OpenAI, Anthropic API, etc.)
 * - ADKs/SDKs (Claude Agent SDK, etc.)
 * - Local models (Ollama, llama.cpp, etc.)
 * - gRPC services
 */

import { IAgent, AgentCapability } from './agent.js';
import { ISession, InvokeOptions, StreamCallback, MessageResult } from './session.js';

/**
 * Plugin source types - how the plugin connects to the LLM
 */
export type PluginSource = 'cli' | 'api' | 'adk' | 'local' | 'grpc';

/**
 * Plugin manifest as defined in plugin.json
 */
export interface PluginManifest {
  /** Plugin identifier (e.g., "claude_cli") */
  name: string;

  /** Semantic version */
  version: string;

  /** Plugin type (currently only 'llm') */
  type: 'llm';

  /** How this plugin connects to the model */
  source: PluginSource;

  /** Capabilities this plugin supports */
  supports: AgentCapability[];

  /** Entry point file (relative to plugin directory) */
  entry: string;

  /** Agents provided by this plugin */
  agents: Array<{
    id: string;
    name: string;
    capabilities?: AgentCapability[];
    description?: string;
  }>;

  /** Optional configuration schema */
  configSchema?: Record<string, unknown>;
}

/**
 * The main plugin interface
 *
 * All LLM plugins must implement this interface to be compatible with Nova.
 */
export interface INovaPlugin {
  // ─────────────────────────────────────────────────────────────
  // Metadata
  // ─────────────────────────────────────────────────────────────

  /** Unique plugin identifier (e.g., "claude_cli", "openai_api") */
  readonly name: string;

  /** Plugin type - currently only 'llm' is supported */
  readonly type: 'llm';

  /** How this plugin connects to the model */
  readonly source: PluginSource;

  /** Capabilities this plugin supports */
  readonly supports: AgentCapability[];

  // ─────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────

  /**
   * Initialize the plugin
   * Called once when the plugin is loaded
   */
  initialize(): Promise<void>;

  /**
   * Shutdown the plugin
   * Called when the plugin is being unloaded or Nova is shutting down
   * Should clean up all resources and stop all sessions
   */
  shutdown(): Promise<void>;

  // ─────────────────────────────────────────────────────────────
  // Agents
  // ─────────────────────────────────────────────────────────────

  /** Available agents within this plugin */
  readonly agents: IAgent[];

  /**
   * Get a specific agent by ID
   * @param agentId Agent identifier
   * @returns The agent or undefined if not found
   */
  getAgent(agentId: string): IAgent | undefined;

  // ─────────────────────────────────────────────────────────────
  // Session Management
  // ─────────────────────────────────────────────────────────────

  /**
   * Invoke an agent and create a new session
   * @param agentId Agent to invoke (e.g., "sonnet")
   * @param options Invocation options
   * @returns The created session
   */
  invoke(agentId: string, options: InvokeOptions): Promise<ISession>;

  /**
   * Send a message to a running session
   * @param sessionId Session to send to
   * @param message Message content
   * @returns Result of the operation
   */
  message(sessionId: string, message: string): Promise<MessageResult>;

  /**
   * Subscribe to session events
   * @param sessionId Session to subscribe to
   * @param callback Event handler
   * @returns Unsubscribe function
   */
  stream(sessionId: string, callback: StreamCallback): () => void;

  /**
   * Stop a running session
   * @param sessionId Session to stop
   */
  stop(sessionId: string): Promise<void>;

  /**
   * Get a session by ID
   * @param sessionId Session identifier
   * @returns The session or undefined if not found
   */
  getSession(sessionId: string): ISession | undefined;

  /**
   * Get all active sessions
   * @returns Array of active sessions
   */
  getSessions(): ISession[];
}

/**
 * Plugin factory function type
 * Plugins export a default function that creates the plugin instance
 */
export type PluginFactory = () => INovaPlugin;
