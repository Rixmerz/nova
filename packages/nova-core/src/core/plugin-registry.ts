/**
 * Plugin Registry
 *
 * Central registry for all loaded plugins.
 * Provides lookup and management of plugin instances.
 */

import { EventEmitter } from 'events';
import type { INovaPlugin, IAgent, ISession, InvokeOptions, StreamCallback, MessageResult } from '../interfaces/index.js';

/**
 * Registry events
 */
export interface RegistryEvents {
  'plugin:registered': (pluginName: string) => void;
  'plugin:unregistered': (pluginName: string) => void;
  'session:created': (sessionId: string, pluginName: string, agentId: string) => void;
  'session:ended': (sessionId: string) => void;
}

/**
 * Plugin Registry
 *
 * Manages all loaded plugins and provides a unified API for:
 * - Plugin registration and lookup
 * - Agent discovery across plugins
 * - Session management
 */
export class PluginRegistry {
  private plugins = new Map<string, INovaPlugin>();
  private sessionToPlugin = new Map<string, string>();
  public readonly emitter = new EventEmitter();

  /**
   * Register a plugin
   * @param plugin Plugin instance to register
   */
  register(plugin: INovaPlugin): void {
    if (this.plugins.has(plugin.name)) {
      console.warn(`[Registry] Plugin '${plugin.name}' already registered, replacing`);
    }

    this.plugins.set(plugin.name, plugin);
    console.log(`[Registry] Registered plugin: ${plugin.name}`);
    this.emitter.emit('plugin:registered', plugin.name);
  }

  /**
   * Unregister a plugin
   * @param pluginName Plugin name to unregister
   */
  async unregister(pluginName: string): Promise<void> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      return;
    }

    // Shutdown the plugin
    try {
      await plugin.shutdown();
    } catch (error) {
      console.error(`[Registry] Error shutting down plugin '${pluginName}':`, error);
    }

    // Remove session mappings
    for (const [sessionId, pName] of this.sessionToPlugin) {
      if (pName === pluginName) {
        this.sessionToPlugin.delete(sessionId);
      }
    }

    this.plugins.delete(pluginName);
    console.log(`[Registry] Unregistered plugin: ${pluginName}`);
    this.emitter.emit('plugin:unregistered', pluginName);
  }

  /**
   * Get a plugin by name
   */
  getPlugin(name: string): INovaPlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get all registered plugins
   */
  getPlugins(): INovaPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get all available agents across all plugins
   */
  getAgents(): Array<{ plugin: string; agent: IAgent }> {
    const agents: Array<{ plugin: string; agent: IAgent }> = [];

    for (const plugin of this.plugins.values()) {
      for (const agent of plugin.agents) {
        if (agent.enabled) {
          agents.push({ plugin: plugin.name, agent });
        }
      }
    }

    return agents;
  }

  /**
   * Get a specific agent
   * @param pluginName Plugin containing the agent
   * @param agentId Agent identifier
   */
  getAgent(pluginName: string, agentId: string): IAgent | undefined {
    const plugin = this.plugins.get(pluginName);
    return plugin?.getAgent(agentId);
  }

  /**
   * Invoke an agent
   * @param pluginName Plugin to use
   * @param agentId Agent to invoke
   * @param options Invocation options
   */
  async invoke(
    pluginName: string,
    agentId: string,
    options: InvokeOptions
  ): Promise<ISession> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      throw new Error(`Plugin '${pluginName}' not found`);
    }

    const agent = plugin.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent '${agentId}' not found in plugin '${pluginName}'`);
    }

    if (!agent.enabled) {
      throw new Error(`Agent '${agentId}' is disabled`);
    }

    const session = await plugin.invoke(agentId, options);
    this.sessionToPlugin.set(session.id, pluginName);
    this.emitter.emit('session:created', session.id, pluginName, agentId);

    return session;
  }

  /**
   * Send a message to a session
   * @param sessionId Session to send to
   * @param message Message content
   */
  async message(sessionId: string, message: string): Promise<MessageResult> {
    const plugin = this.getPluginForSession(sessionId);
    if (!plugin) {
      return { success: false, error: `Session '${sessionId}' not found` };
    }

    return plugin.message(sessionId, message);
  }

  /**
   * Subscribe to session events
   * @param sessionId Session to subscribe to
   * @param callback Event handler
   */
  stream(sessionId: string, callback: StreamCallback): () => void {
    const plugin = this.getPluginForSession(sessionId);
    if (!plugin) {
      console.error(`[Registry] Session '${sessionId}' not found for streaming`);
      return () => {};
    }

    return plugin.stream(sessionId, callback);
  }

  /**
   * Stop a session
   * @param sessionId Session to stop
   */
  async stop(sessionId: string): Promise<void> {
    const plugin = this.getPluginForSession(sessionId);
    if (!plugin) {
      console.warn(`[Registry] Session '${sessionId}' not found for stopping`);
      return;
    }

    await plugin.stop(sessionId);
    this.sessionToPlugin.delete(sessionId);
    this.emitter.emit('session:ended', sessionId);
  }

  /**
   * Get the plugin that owns a session
   */
  private getPluginForSession(sessionId: string): INovaPlugin | undefined {
    const pluginName = this.sessionToPlugin.get(sessionId);
    if (!pluginName) {
      return undefined;
    }
    return this.plugins.get(pluginName);
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): ISession | undefined {
    const plugin = this.getPluginForSession(sessionId);
    return plugin?.getSession(sessionId);
  }

  /**
   * Get all active sessions
   */
  getSessions(): ISession[] {
    const sessions: ISession[] = [];
    for (const plugin of this.plugins.values()) {
      sessions.push(...plugin.getSessions());
    }
    return sessions;
  }

  /**
   * Number of registered plugins
   */
  get size(): number {
    return this.plugins.size;
  }

  /**
   * Shutdown all plugins
   */
  async shutdown(): Promise<void> {
    console.log('[Registry] Shutting down all plugins...');

    const promises = Array.from(this.plugins.values()).map(async (plugin) => {
      try {
        await plugin.shutdown();
        console.log(`[Registry] Shut down plugin: ${plugin.name}`);
      } catch (error) {
        console.error(`[Registry] Error shutting down ${plugin.name}:`, error);
      }
    });

    await Promise.all(promises);
    this.plugins.clear();
    this.sessionToPlugin.clear();

    console.log('[Registry] All plugins shut down');
  }
}

// Singleton instance
let registryInstance: PluginRegistry | null = null;

/**
 * Get the global plugin registry instance
 */
export function getPluginRegistry(): PluginRegistry {
  if (!registryInstance) {
    registryInstance = new PluginRegistry();
  }
  return registryInstance;
}

/**
 * Reset the registry (for testing)
 */
export function resetPluginRegistry(): void {
  registryInstance = null;
}
