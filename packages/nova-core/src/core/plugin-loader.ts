/**
 * Plugin Loader
 *
 * Handles autodiscovery and loading of plugins from the plugins directory.
 * Scans for plugin.json files, validates them, and loads enabled plugins.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { z } from 'zod';
import type { INovaPlugin, PluginManifest, AgentCapability } from '../interfaces/index.js';
import { getPluginRegistry, PluginRegistry } from './plugin-registry.js';
import { getConfigLoader, ConfigLoader } from './config.js';

/**
 * Plugin manifest schema for validation
 */
const PluginManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  type: z.literal('llm'),
  source: z.enum(['cli', 'api', 'adk', 'local', 'grpc']),
  supports: z.array(z.enum(['chat', 'tools', 'plan', 'code', 'realtime', 'vision'])),
  entry: z.string(),
  agents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      capabilities: z
        .array(z.enum(['chat', 'tools', 'plan', 'code', 'realtime', 'vision']))
        .optional(),
      description: z.string().optional(),
    })
  ),
  configSchema: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Plugin loader configuration
 */
export interface PluginLoaderOptions {
  /** Base path for resolving relative paths (default: process.cwd()) */
  basePath?: string;

  /** Path to plugins directory (default: <basePath>/plugins) */
  pluginsDir?: string;

  /** Plugin registry to use (default: global singleton) */
  registry?: PluginRegistry;

  /** Config loader to use (default: global singleton) */
  configLoader?: ConfigLoader;
}

/**
 * Plugin Loader
 *
 * Discovers and loads plugins from the plugins directory.
 */
export class PluginLoader {
  private basePath: string;
  private pluginsDir: string;
  private registry: PluginRegistry;
  private configLoader: ConfigLoader;
  private loadedPlugins = new Set<string>();

  constructor(options: PluginLoaderOptions = {}) {
    this.basePath = options.basePath ?? process.cwd();
    this.pluginsDir = options.pluginsDir ?? join(this.basePath, 'plugins');
    this.registry = options.registry ?? getPluginRegistry();
    this.configLoader = options.configLoader ?? getConfigLoader(this.basePath);
  }

  /**
   * Discover and load all enabled plugins
   */
  async discover(): Promise<void> {
    console.log(`[PluginLoader] Scanning for plugins in: ${this.pluginsDir}`);

    if (!existsSync(this.pluginsDir)) {
      console.warn(`[PluginLoader] Plugins directory not found: ${this.pluginsDir}`);
      return;
    }

    const entries = readdirSync(this.pluginsDir);
    const pluginDirs = entries.filter((entry) => {
      const fullPath = join(this.pluginsDir, entry);
      return statSync(fullPath).isDirectory();
    });

    console.log(`[PluginLoader] Found ${pluginDirs.length} potential plugin(s)`);

    for (const dir of pluginDirs) {
      try {
        await this.loadPlugin(dir);
      } catch (error) {
        console.error(`[PluginLoader] Failed to load plugin '${dir}':`, error);
      }
    }

    console.log(`[PluginLoader] Loaded ${this.loadedPlugins.size} plugin(s)`);
  }

  /**
   * Load a single plugin by directory name
   */
  private async loadPlugin(dirName: string): Promise<void> {
    const pluginPath = join(this.pluginsDir, dirName);
    const manifestPath = join(pluginPath, 'plugin.json');

    // Check for manifest
    if (!existsSync(manifestPath)) {
      console.log(`[PluginLoader] No plugin.json in ${dirName}, skipping`);
      return;
    }

    // Load and validate manifest
    const manifest = this.loadManifest(manifestPath);
    if (!manifest) {
      return;
    }

    // Check if enabled in config
    if (!this.configLoader.isPluginEnabled(manifest.name)) {
      console.log(`[PluginLoader] Plugin '${manifest.name}' is disabled in config, skipping`);
      return;
    }

    // Load the plugin module
    const entryPath = join(pluginPath, manifest.entry);
    if (!existsSync(entryPath)) {
      // Try with .js extension for compiled TypeScript
      const jsPath = entryPath.replace(/\.ts$/, '.js');
      if (!existsSync(jsPath)) {
        console.error(`[PluginLoader] Entry point not found: ${entryPath}`);
        return;
      }
    }

    console.log(`[PluginLoader] Loading plugin: ${manifest.name}`);

    try {
      // Use file:// URL for ESM import
      const entryUrl = pathToFileURL(
        entryPath.endsWith('.js') ? entryPath : entryPath.replace(/\.ts$/, '.js')
      ).href;

      const module = await import(entryUrl);
      const factory = module.default || module.createPlugin;

      if (typeof factory !== 'function') {
        console.error(`[PluginLoader] Plugin '${manifest.name}' has no default export or createPlugin function`);
        return;
      }

      // Create plugin instance
      const plugin: INovaPlugin = factory(manifest, this.configLoader);

      // Initialize the plugin
      await plugin.initialize();

      // Register with the registry
      this.registry.register(plugin);
      this.loadedPlugins.add(manifest.name);

      console.log(`[PluginLoader] Successfully loaded: ${manifest.name}`);
    } catch (error) {
      console.error(`[PluginLoader] Error loading plugin '${manifest.name}':`, error);
    }
  }

  /**
   * Load and validate a plugin manifest
   */
  private loadManifest(path: string): PluginManifest | null {
    try {
      const raw = readFileSync(path, 'utf-8');
      const parsed = JSON.parse(raw);
      return PluginManifestSchema.parse(parsed);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error(`[PluginLoader] Invalid plugin.json at ${path}:`);
        for (const issue of error.issues) {
          console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
        }
      } else {
        console.error(`[PluginLoader] Failed to parse ${path}:`, error);
      }
      return null;
    }
  }

  /**
   * Reload all plugins
   */
  async reload(): Promise<void> {
    console.log('[PluginLoader] Reloading all plugins...');

    // Shutdown existing plugins
    await this.registry.shutdown();
    this.loadedPlugins.clear();

    // Reload config
    this.configLoader.reload();

    // Rediscover
    await this.discover();
  }

  /**
   * Get list of loaded plugin names
   */
  getLoadedPlugins(): string[] {
    return Array.from(this.loadedPlugins);
  }
}

// Singleton instance
let loaderInstance: PluginLoader | null = null;

/**
 * Get the global plugin loader instance
 */
export function getPluginLoader(options?: PluginLoaderOptions): PluginLoader {
  if (!loaderInstance) {
    loaderInstance = new PluginLoader(options);
  }
  return loaderInstance;
}

/**
 * Reset the plugin loader (for testing)
 */
export function resetPluginLoader(): void {
  loaderInstance = null;
}
