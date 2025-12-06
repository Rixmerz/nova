/**
 * Claude CLI Plugin for Nova
 *
 * Provides Claude CLI integration via node-pty with streaming JSON I/O.
 * Supports haiku, sonnet, and opus models.
 */
import { StreamingPTYSession, } from './pty-session.js';
/**
 * Claude CLI Plugin
 *
 * Implements INovaPlugin for Claude CLI integration with streaming JSON I/O.
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
        console.log('[ClaudeCLI] Initializing plugin (streaming mode)...');
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
     * Invoke an agent and create a new streaming session
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
        // Convert legacy bypassMode to permissionMode
        let permissionMode = options.permissionMode || 'bypassPermissions';
        if (options.bypassMode === false) {
            permissionMode = 'default';
        }
        console.log(`[ClaudeCLI] Permission mode: ${permissionMode}`);
        console.log(`[ClaudeCLI] Resume session: ${options.resume || 'none'}`);
        const session = new StreamingPTYSession({
            projectPath: options.projectPath,
            agentId,
            permissionMode,
            resumeSessionId: options.resume,
            tools: options.tools,
            disallowedTools: options.disallowedTools,
        });
        // Store session before starting
        this.sessions.set(session.id, session);
        // Start the session with the initial prompt
        await session.start(options.prompt);
        console.log(`[ClaudeCLI] Session created: ${session.id}`);
        console.log(`[ClaudeCLI] Claude session ID: ${session.claudeSessionId}`);
        return {
            id: session.id,
            agentId: session.agentId,
            pluginId: session.pluginId,
            status: session.status,
            createdAt: session.createdAt,
            projectPath: session.projectPath,
            resumeSessionId: session.resumeSessionId,
            claudeSessionId: session.claudeSessionId,
        };
    }
    /**
     * Send a message to a running session
     */
    async message(sessionId, message) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return { success: false, error: `Session '${sessionId}' not found` };
        }
        console.log(`[ClaudeCLI] Sending message to session ${sessionId}: ${message.substring(0, 50)}...`);
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
        const session = this.sessions.get(sessionId);
        if (!session)
            return undefined;
        return {
            id: session.id,
            agentId: session.agentId,
            pluginId: session.pluginId,
            status: session.status,
            createdAt: session.createdAt,
            projectPath: session.projectPath,
            resumeSessionId: session.resumeSessionId,
            claudeSessionId: session.claudeSessionId,
        };
    }
    /**
     * Get all active sessions
     */
    getSessions() {
        return Array.from(this.sessions.values()).map((session) => ({
            id: session.id,
            agentId: session.agentId,
            pluginId: session.pluginId,
            status: session.status,
            createdAt: session.createdAt,
            projectPath: session.projectPath,
            resumeSessionId: session.resumeSessionId,
            claudeSessionId: session.claudeSessionId,
        }));
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