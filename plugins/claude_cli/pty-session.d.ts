/**
 * PTY Session for Claude CLI
 *
 * Wraps a node-pty process for Claude CLI interaction.
 * Based on patterns from ptyclaude project.
 */
type SessionStatus = 'starting' | 'running' | 'completed' | 'error' | 'stopped';
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
interface ISession {
    id: string;
    agentId: string;
    pluginId: string;
    status: SessionStatus;
    createdAt: Date;
    projectPath: string;
    resumeSessionId?: string;
}
/**
 * Options for creating a PTY session
 */
export interface PTYSessionOptions {
    projectPath: string;
    prompt: string;
    agentId: string;
    resume?: string;
}
/**
 * PTY Session
 *
 * Manages a single Claude CLI session via PTY.
 */
export declare class PTYSession implements ISession {
    readonly id: string;
    readonly agentId: string;
    readonly pluginId = "claude_cli";
    readonly createdAt: Date;
    readonly projectPath: string;
    readonly resumeSessionId?: string;
    private ptyProcess;
    private _status;
    private outputBuffer;
    private emitter;
    private callbacks;
    private exitCode;
    constructor(options: PTYSessionOptions);
    get status(): SessionStatus;
    /**
     * Start the PTY session
     */
    start(prompt: string): Promise<void>;
    /**
     * Build CLI arguments for Claude
     */
    private buildArgs;
    /**
     * Wait for initial output from Claude
     */
    private waitForInit;
    /**
     * Handle output from the PTY process
     */
    private handleOutput;
    /**
     * Emit an event to all subscribers
     */
    private emitEvent;
    /**
     * Send a message to the running session
     */
    sendMessage(message: string): Promise<{
        success: boolean;
        error?: string;
    }>;
    /**
     * Subscribe to session events
     */
    subscribe(callback: StreamCallback): () => void;
    /**
     * Stop the session
     * Uses two-phase kill: SIGTERM first, then SIGKILL after timeout
     */
    stop(): Promise<void>;
}
export {};
