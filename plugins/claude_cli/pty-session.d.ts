/**
 * Streaming PTY Session for Claude CLI
 *
 * Uses bidirectional JSON streaming for persistent sessions:
 * - Input: --input-format stream-json (send messages via stdin)
 * - Output: --output-format stream-json (receive structured responses)
 * - Permission modes: default, plan, acceptEdits, bypassPermissions, dontAsk
 */
/**
 * Permission modes available in Claude CLI
 */
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk' | 'plan';
/**
 * Session lifecycle states
 */
export type SessionState = 'initializing' | 'ready' | 'processing' | 'idle' | 'error' | 'stopped';
/**
 * Session status for external consumers
 */
export type SessionStatus = 'starting' | 'running' | 'completed' | 'error' | 'stopped' | 'waiting-for-input';
/**
 * Options for creating a streaming PTY session
 */
export interface StreamingPTYSessionOptions {
    projectPath: string;
    agentId: string;
    permissionMode?: PermissionMode;
    sessionId?: string;
    resumeSessionId?: string;
    forkSession?: boolean;
    tools?: string[];
    disallowedTools?: string[];
}
/**
 * Session event payload
 */
export interface SessionEvent {
    sessionId: string;
    type: 'output' | 'error' | 'complete' | 'status' | 'init';
    data: {
        message?: Record<string, unknown>;
        raw?: string;
        error?: string;
        exitCode?: number | null;
        claudeSessionId?: string;
    };
    timestamp: string;
}
type StreamCallback = (event: SessionEvent) => void;
/**
 * Session interface for Nova compatibility
 */
export interface ISession {
    id: string;
    agentId: string;
    pluginId: string;
    status: SessionStatus;
    createdAt: Date;
    projectPath: string;
    resumeSessionId?: string;
}
/**
 * Streaming PTY Session
 *
 * Manages a persistent Claude CLI session via PTY with bidirectional JSON streaming.
 * Supports multiple messages in the same session and proper session UUID handling.
 */
export declare class StreamingPTYSession implements ISession {
    readonly id: string;
    readonly agentId: string;
    readonly pluginId = "claude_cli";
    readonly createdAt: Date;
    readonly projectPath: string;
    readonly resumeSessionId?: string;
    private _claudeSessionId;
    private _state;
    private ptyProcess;
    private lineBuffer;
    private readonly emitter;
    private readonly callbacks;
    private readonly options;
    private messageCount;
    private lastActivityTime;
    private exitCode;
    constructor(options: StreamingPTYSessionOptions);
    /**
     * Get the session state
     */
    get state(): SessionState;
    /**
     * Get status for ISession interface
     */
    get status(): SessionStatus;
    /**
     * Get Claude CLI's actual session UUID
     * Use this for --resume operations
     */
    get claudeSessionId(): string;
    /**
     * Start the PTY process in hybrid mode (-p + stream-json output)
     *
     * The prompt is passed via -p flag, so it's required for this method.
     * The process starts immediately and begins processing the prompt.
     */
    start(initialPrompt: string): Promise<void>;
    /**
     * Build CLI arguments for hybrid mode (-p + stream-json output)
     *
     * Uses -p to pass the prompt as argument (reliable with PTY spawn)
     * and --output-format stream-json for structured JSON output.
     */
    private buildArgs;
    /**
     * Handle raw data from PTY
     */
    private handleData;
    /**
     * Process a complete JSON line
     */
    private processLine;
    /**
     * Handle a parsed Claude message
     */
    private handleMessage;
    /**
     * Handle init message
     */
    private handleInit;
    /**
     * Handle result message (task complete)
     *
     * In hybrid mode (-p), the result message contains the session_id
     * that we need for future --resume operations.
     */
    private handleResult;
    /**
     * Emit an output event
     */
    private emitOutput;
    /**
     * Handle PTY exit
     */
    private handleExit;
    /**
     * Emit an event to all subscribers
     */
    private emitEvent;
    /**
     * Send a follow-up message
     *
     * In hybrid mode (-p), each message creates a new process.
     * For follow-up messages, create a new session with resumeSessionId set.
     */
    sendMessage(_content: string): Promise<{
        success: boolean;
        error?: string;
    }>;
    /**
     * Subscribe to session events
     */
    subscribe(callback: StreamCallback): () => void;
    /**
     * Stop the session gracefully
     */
    stop(): Promise<void>;
    /**
     * Get session info
     */
    getInfo(): {
        id: string;
        claudeSessionId: string;
        state: SessionState;
        messageCount: number;
        lastActivity: Date;
    };
}
export { StreamingPTYSession as PTYSession };
export interface PTYSessionOptions {
    projectPath: string;
    prompt: string;
    agentId: string;
    resume?: string;
    bypassMode?: boolean;
}
