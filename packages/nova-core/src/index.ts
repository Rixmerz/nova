/**
 * Nova Core
 *
 * Model-agnostic plugin architecture for LLM orchestration.
 *
 * @module @nova/core
 */

// Interfaces
export type {
  // Agent
  AgentCapability,
  AgentManifest,
  IAgent,
  // Session
  SessionStatus,
  SessionEventType,
  SessionEvent,
  StreamCallback,
  InvokeOptions,
  MessageResult,
  ISession,
  // Plugin
  PluginSource,
  PluginManifest,
  PluginFactory,
  INovaPlugin,
} from './interfaces/index.js';

// Core
export {
  ConfigLoader,
  getConfigLoader,
  resetConfigLoader,
  PluginRegistry,
  getPluginRegistry,
  resetPluginRegistry,
  PluginLoader,
  getPluginLoader,
  resetPluginLoader,
} from './core/index.js';

export type { NovaConfig, PluginConfig, AgentConfig, PluginLoaderOptions } from './core/index.js';

// Transport
export { WebSocketNovaServer, startNovaServer } from './transport/websocket.js';
