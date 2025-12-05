/**
 * Claude CLI Plugin for Nova
 *
 * Provides Claude CLI integration via node-pty.
 * Supports haiku, sonnet, and opus models.
 */
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
/**
 * Plugin factory function
 * This is the default export that the plugin loader calls
 */
export default function createPlugin(manifest: PluginManifest, configLoader: ConfigLoader): INovaPlugin;
export { createPlugin };
