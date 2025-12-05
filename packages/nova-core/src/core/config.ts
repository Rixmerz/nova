/**
 * Nova Configuration Loader
 *
 * Handles loading and parsing of nova.config.json
 * This file controls which plugins and agents are enabled.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

/**
 * Agent configuration within a plugin
 */
const AgentConfigSchema = z.record(z.string(), z.boolean());

/**
 * Plugin configuration
 */
const PluginConfigSchema = z.object({
  enabled: z.boolean().default(true),
  agents: AgentConfigSchema.optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Full Nova configuration schema
 */
const NovaConfigSchema = z.object({
  plugins: z.record(z.string(), PluginConfigSchema).default({}),
  defaults: z
    .object({
      agent: z.string().optional(),
      projectPath: z.string().optional(),
    })
    .optional(),
  server: z
    .object({
      port: z.number().default(8080),
      host: z.string().default('localhost'),
    })
    .optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type PluginConfig = z.infer<typeof PluginConfigSchema>;
export type NovaConfig = z.infer<typeof NovaConfigSchema>;

/**
 * Default configuration when no config file exists
 */
const DEFAULT_CONFIG: NovaConfig = {
  plugins: {
    claude_cli: {
      enabled: true,
      agents: {
        haiku: true,
        sonnet: true,
        opus: true,
      },
    },
  },
  defaults: {
    agent: 'claude_cli:sonnet',
  },
  server: {
    port: 8080,
    host: 'localhost',
  },
};

/**
 * Configuration loader class
 */
export class ConfigLoader {
  private config: NovaConfig | null = null;
  private configPath: string;

  constructor(basePath: string = process.cwd()) {
    this.configPath = join(basePath, 'nova.config.json');
  }

  /**
   * Load configuration from file or use defaults
   */
  load(): NovaConfig {
    if (this.config) {
      return this.config;
    }

    if (!existsSync(this.configPath)) {
      console.log('[Config] No nova.config.json found, using defaults');
      this.config = DEFAULT_CONFIG;
      return this.config;
    }

    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      this.config = NovaConfigSchema.parse(parsed);
      console.log('[Config] Loaded configuration from nova.config.json');
      return this.config;
    } catch (error) {
      console.error('[Config] Failed to load config:', error);
      console.log('[Config] Falling back to defaults');
      this.config = DEFAULT_CONFIG;
      return this.config;
    }
  }

  /**
   * Check if a plugin is enabled
   */
  isPluginEnabled(pluginName: string): boolean {
    const config = this.load();
    const pluginConfig = config.plugins[pluginName];

    // If not configured, assume enabled by default
    if (!pluginConfig) {
      return true;
    }

    return pluginConfig.enabled;
  }

  /**
   * Check if an agent within a plugin is enabled
   */
  isAgentEnabled(pluginName: string, agentId: string): boolean {
    const config = this.load();
    const pluginConfig = config.plugins[pluginName];

    // If plugin not configured, assume all agents enabled
    if (!pluginConfig) {
      return true;
    }

    // If plugin disabled, all agents are disabled
    if (!pluginConfig.enabled) {
      return false;
    }

    // If agents not specified, assume all enabled
    if (!pluginConfig.agents) {
      return true;
    }

    // Check specific agent
    return pluginConfig.agents[agentId] ?? true;
  }

  /**
   * Get plugin-specific options
   */
  getPluginOptions(pluginName: string): Record<string, unknown> {
    const config = this.load();
    return config.plugins[pluginName]?.options ?? {};
  }

  /**
   * Get the default agent (format: "plugin:agent")
   */
  getDefaultAgent(): { plugin: string; agent: string } | null {
    const config = this.load();
    const defaultAgent = config.defaults?.agent;

    if (!defaultAgent) {
      return null;
    }

    const [plugin, agent] = defaultAgent.split(':');
    if (!plugin || !agent) {
      return null;
    }

    return { plugin, agent };
  }

  /**
   * Get server configuration
   */
  getServerConfig(): { port: number; host: string } {
    const config = this.load();
    return {
      port: config.server?.port ?? 8080,
      host: config.server?.host ?? 'localhost',
    };
  }

  /**
   * Reload configuration from disk
   */
  reload(): NovaConfig {
    this.config = null;
    return this.load();
  }
}

// Singleton instance
let configLoaderInstance: ConfigLoader | null = null;

/**
 * Get the global config loader instance
 */
export function getConfigLoader(basePath?: string): ConfigLoader {
  if (!configLoaderInstance) {
    configLoaderInstance = new ConfigLoader(basePath);
  }
  return configLoaderInstance;
}

/**
 * Reset the config loader (for testing)
 */
export function resetConfigLoader(): void {
  configLoaderInstance = null;
}
