/**
 * Agent Interface
 *
 * Represents a specific model/agent available within a plugin.
 * Each plugin can expose multiple agents (e.g., haiku, sonnet, opus for Claude).
 */

/**
 * Capabilities that an agent can support
 */
export type AgentCapability = 'chat' | 'tools' | 'plan' | 'code' | 'realtime' | 'vision';

/**
 * Agent definition within a plugin
 */
export interface IAgent {
  /** Unique identifier within the plugin (e.g., "haiku", "sonnet", "opus") */
  id: string;

  /** Human-readable display name (e.g., "Claude Haiku") */
  name: string;

  /** Capabilities this agent supports */
  capabilities: AgentCapability[];

  /** Whether this agent is currently enabled (configurable via nova.config.json) */
  enabled: boolean;

  /** Optional description of the agent */
  description?: string;

  /** Optional metadata for the agent */
  metadata?: Record<string, unknown>;
}

/**
 * Agent manifest as defined in plugin.json
 */
export interface AgentManifest {
  /** Agent identifier */
  id: string;

  /** Display name */
  name: string;

  /** Capabilities list */
  capabilities?: AgentCapability[];

  /** Description */
  description?: string;
}
