/**
 * Claude CLI Plugin for Nova
 *
 * Provides Claude CLI integration via node-pty.
 * Supports haiku, sonnet, and opus models.
 */
import { PTYSession } from './pty-session.js';
/**
 * Claude CLI Plugin
 *
 * Implements INovaPlugin for Claude CLI integration.
 */
class ClaudeCLIPlugin {
    // Metadata
    name = 'claude_cli';
    type = 'llm';
    source = 'cli';
    supports = ['chat', 'tools', 'plan', 'code'];
    // Internal state
    _agents = [];
    sessions = new Map();
    configLoader;
    manifest;
    initialized = false;
    constructor(manifest, configLoader) {
        this.manifest = manifest;
        this.configLoader = configLoader;
    }
    /**
     * Available agents
     */
    get agents() {
        return this._agents;
    }
    /**
     * Initialize the plugin
     */
    async initialize() {
        if (this.initialized) {
            return;
        }
        console.log('[ClaudeCLI] Initializing plugin...');
        // Build agent list from manifest with config overrides
        this._agents = this.manifest.agents.map((agentDef) => ({
            id: agentDef.id,
            name: agentDef.name,
            capabilities: (agentDef.capabilities || ['chat']),
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
    async shutdown() {
        console.log('[ClaudeCLI] Shutting down...');
        // Stop all active sessions
        const stopPromises = Array.from(this.sessions.keys()).map((sessionId) => this.stop(sessionId));
        await Promise.all(stopPromises);
        this.sessions.clear();
        this.initialized = false;
        console.log('[ClaudeCLI] Plugin shutdown complete');
    }
    /**
     * Get a specific agent by ID
     */
    getAgent(agentId) {
        return this._agents.find((a) => a.id === agentId);
    }
    /**
     * Invoke an agent and create a new session
     */
    async invoke(agentId, options) {
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
    async message(sessionId, message) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return { success: false, error: `Session '${sessionId}' not found` };
        }
        return session.sendMessage(message);
    }
    /**
     * Subscribe to session events
     */
    stream(sessionId, callback) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            console.error(`[ClaudeCLI] Session '${sessionId}' not found for streaming`);
            return () => { };
        }
        return session.subscribe(callback);
    }
    /**
     * Stop a running session
     */
    async stop(sessionId) {
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
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }
    /**
     * Get all active sessions
     */
    getSessions() {
        return Array.from(this.sessions.values());
    }
}
/**
 * Plugin factory function
 * This is the default export that the plugin loader calls
 */
export default function createPlugin(manifest, configLoader) {
    return new ClaudeCLIPlugin(manifest, configLoader);
}
// Also export as named function
export { createPlugin };
//# sourceMappingURL=index.js.map