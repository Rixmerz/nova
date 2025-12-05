/**
 * Nova Core Interfaces
 *
 * This module exports all the interfaces for the Nova plugin system.
 */

// Agent interfaces
export type { AgentCapability, AgentManifest } from './agent.js';
export type { IAgent } from './agent.js';

// Session interfaces
export type {
  SessionStatus,
  SessionEventType,
  SessionEvent,
  StreamCallback,
  InvokeOptions,
  MessageResult,
} from './session.js';
export type { ISession } from './session.js';

// Plugin interfaces
export type {
  PluginSource,
  PluginManifest,
  PluginFactory,
} from './plugin.js';
export type { INovaPlugin } from './plugin.js';
