/**
 * Streaming PTY Session for Claude CLI
 *
 * Uses bidirectional JSON streaming for persistent sessions:
 * - Input: --input-format stream-json (send messages via stdin)
 * - Output: --output-format stream-json (receive structured responses)
 * - Permission modes: default, plan, acceptEdits, bypassPermissions, dontAsk
 */
import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
// ─────────────────────────────────────────────────────────────────────────────
// Claude Binary Discovery
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Find the Claude binary on the system
 */
function findClaudeBinary() {
    // Common paths
    const paths = [
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude',
        join(homedir(), '.npm-global/bin/claude'),
        join(homedir(), '.yarn/bin/claude'),
        join(homedir(), '.local/bin/claude'),
        join(homedir(), '.nvm/versions/node/v22.16.0/bin/claude'),
    ];
    for (const p of paths) {
        if (existsSync(p)) {
            return p;
        }
    }
    // Fall back to PATH
    try {
        const claudePath = execSync('which claude', { encoding: 'utf-8' }).trim();
        if (claudePath && existsSync(claudePath)) {
            return claudePath;
        }
    }
    catch {
        // Ignore
    }
    throw new Error('Claude binary not found. Install with: npm install -g @anthropic-ai/claude-code');
}
// ─────────────────────────────────────────────────────────────────────────────
// Streaming PTY Session
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Streaming PTY Session
 *
 * Manages a persistent Claude CLI session via PTY with bidirectional JSON streaming.
 * Supports multiple messages in the same session and proper session UUID handling.
 */
export class StreamingPTYSession {
    // Public identifiers
    id;
    agentId;
    pluginId = 'claude_cli';
    createdAt;
    projectPath;
    resumeSessionId;
    // Claude's actual session UUID (captured from init or specified)
    _claudeSessionId;
    // State management
    _state = 'initializing';
    ptyProcess = null;
    // Buffers
    lineBuffer = '';
    // Note: pendingMessages no longer needed in hybrid mode (-p passes prompt directly)
    // Event emission
    emitter = new EventEmitter();
    callbacks = new Set();
    // Configuration
    options;
    // Metrics
    messageCount = 0;
    lastActivityTime;
    exitCode = null;
    constructor(options) {
        this.id = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        this.agentId = options.agentId;
        this.projectPath = options.projectPath;
        this.resumeSessionId = options.resumeSessionId;
        this.options = options;
        this.createdAt = new Date();
        this.lastActivityTime = new Date();
        // Store provided session UUID if any; otherwise it will be captured from init message
        // Note: We no longer pre-generate a UUID because Claude CLI may reject reused UUIDs
        this._claudeSessionId = options.sessionId || '';
    }
    /**
     * Get the session state
     */
    get state() {
        return this._state;
    }
    /**
     * Get status for ISession interface
     */
    get status() {
        switch (this._state) {
            case 'initializing':
                return 'starting';
            case 'ready':
            case 'processing':
            case 'idle':
                return 'running';
            case 'error':
                return 'error';
            case 'stopped':
                return 'stopped';
            default:
                return 'running';
        }
    }
    /**
     * Get Claude CLI's actual session UUID
     * Use this for --resume operations
     */
    get claudeSessionId() {
        return this._claudeSessionId;
    }
    /**
     * Start the PTY process in hybrid mode (-p + stream-json output)
     *
     * The prompt is passed via -p flag, so it's required for this method.
     * The process starts immediately and begins processing the prompt.
     */
    async start(initialPrompt) {
        if (!initialPrompt) {
            this._state = 'error';
            this.emitEvent({
                sessionId: this.id,
                type: 'error',
                data: { error: 'Initial prompt is required for hybrid mode' },
                timestamp: new Date().toISOString(),
            });
            return;
        }
        const claudePath = findClaudeBinary();
        let effectiveProjectPath = this.projectPath;
        console.log(`[HybridPTY] Using project path: ${effectiveProjectPath}`);
        console.log(`[HybridPTY] Permission mode: ${this.options.permissionMode || 'bypassPermissions'}`);
        console.log(`[HybridPTY] Resume session: ${this.options.resumeSessionId || 'none'}`);
        if (!existsSync(effectiveProjectPath)) {
            console.error(`[HybridPTY] Project path does not exist: ${effectiveProjectPath}`);
            // Try to fix common path issues
            const fixedPath = effectiveProjectPath.replace(/\/my\/projects\//, '/my_projects/');
            if (existsSync(fixedPath)) {
                console.log(`[HybridPTY] Found corrected path: ${fixedPath}`);
                effectiveProjectPath = fixedPath;
            }
            else {
                this._state = 'error';
                this.emitEvent({
                    sessionId: this.id,
                    type: 'error',
                    data: { error: `Project path does not exist: ${effectiveProjectPath}` },
                    timestamp: new Date().toISOString(),
                });
                return;
            }
        }
        // Build args with the prompt passed via -p flag
        const args = this.buildArgs(initialPrompt);
        console.log(`[HybridPTY] Spawning: ${claudePath} -p "..." ${args.slice(2).join(' ')}`);
        console.log(`[HybridPTY] CWD: ${effectiveProjectPath}`);
        this.ptyProcess = pty.spawn(claudePath, args, {
            name: 'xterm-256color',
            cols: 200,
            rows: 50,
            cwd: effectiveProjectPath,
            env: {
                ...process.env,
                TERM: 'xterm-256color',
                NO_COLOR: '1',
                FORCE_COLOR: '0',
            },
        });
        // Set state to processing immediately - the prompt is being processed
        this._state = 'processing';
        this.messageCount++;
        // Handle output - process starts immediately with -p mode
        this.ptyProcess.onData((data) => {
            this.handleData(data);
        });
        // Handle exit
        this.ptyProcess.onExit(({ exitCode }) => {
            this.handleExit(exitCode);
        });
        // No need to wait for init or send messages separately
        // The -p flag passes the prompt directly and Claude processes it immediately
        console.log(`[HybridPTY] Process started, state: ${this._state}`);
    }
    /**
     * Build CLI arguments for hybrid mode (-p + stream-json output)
     *
     * Uses -p to pass the prompt as argument (reliable with PTY spawn)
     * and --output-format stream-json for structured JSON output.
     */
    buildArgs(prompt) {
        const args = [];
        // Use -p flag to pass the prompt (works reliably with PTY)
        args.push('-p', prompt);
        // Output format: structured JSON (no ANSI parsing needed)
        args.push('--output-format', 'stream-json');
        args.push('--verbose');
        // Include partial messages for real-time streaming
        args.push('--include-partial-messages');
        // Model
        args.push('--model', this.agentId);
        // Permission mode - default to bypassPermissions for automated use
        const permissionMode = this.options.permissionMode || 'bypassPermissions';
        args.push('--permission-mode', permissionMode);
        // Resume: for follow-up messages in the same conversation
        if (this.options.resumeSessionId) {
            args.push('--resume', this.options.resumeSessionId);
            if (this.options.forkSession) {
                args.push('--fork-session');
            }
        }
        // Tool control
        if (this.options.tools?.length) {
            args.push('--tools', ...this.options.tools);
        }
        if (this.options.disallowedTools?.length) {
            args.push('--disallowed-tools', ...this.options.disallowedTools);
        }
        return args;
    }
    // NOTE: waitForInit() is no longer needed in hybrid mode (-p)
    // The process starts immediately with the prompt passed via -p flag
    /**
     * Handle raw data from PTY
     */
    handleData(data) {
        this.lastActivityTime = new Date();
        this.lineBuffer += data;
        // Process complete lines (JSON is newline-delimited)
        const lines = this.lineBuffer.split('\n');
        this.lineBuffer = lines.pop() || ''; // Keep incomplete line
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            this.processLine(trimmed);
        }
    }
    /**
     * Process a complete JSON line
     */
    processLine(line) {
        // Log for debugging
        console.log(`[HybridPTY] Line: ${line.substring(0, 150)}${line.length > 150 ? '...' : ''}`);
        try {
            const message = JSON.parse(line);
            this.handleMessage(message);
        }
        catch {
            // Not valid JSON, emit as raw output
            console.log(`[HybridPTY] Non-JSON line: ${line.substring(0, 100)}`);
            this.emitEvent({
                sessionId: this.id,
                type: 'output',
                data: { raw: line },
                timestamp: new Date().toISOString(),
            });
        }
    }
    /**
     * Handle a parsed Claude message
     */
    handleMessage(message) {
        const type = message.type;
        const subtype = message.subtype;
        switch (type) {
            case 'system':
                if (subtype === 'init') {
                    this.handleInit(message);
                }
                else {
                    this.emitOutput(message);
                }
                break;
            case 'assistant':
                this._state = 'processing';
                this.emitOutput(message);
                break;
            case 'result':
                this.handleResult(message);
                break;
            case 'user':
                // User message echoed back (from --replay-user-messages if enabled)
                this.emitOutput(message);
                break;
            default:
                // Forward unknown types as output
                this.emitOutput(message);
        }
    }
    /**
     * Handle init message
     */
    handleInit(message) {
        console.log(`[HybridPTY] Received init message`);
        // Capture the actual session ID from Claude if different
        const sessionId = message.session_id;
        if (sessionId) {
            this._claudeSessionId = sessionId;
            console.log(`[HybridPTY] Captured Claude session ID: ${sessionId}`);
        }
        this._state = 'ready';
        // Emit init event with the Claude session ID
        this.emitEvent({
            sessionId: this.id,
            type: 'init',
            data: {
                message,
                claudeSessionId: this._claudeSessionId,
            },
            timestamp: new Date().toISOString(),
        });
        // Also emit as output for UI
        this.emitOutput(message);
    }
    /**
     * Handle result message (task complete)
     *
     * In hybrid mode (-p), the result message contains the session_id
     * that we need for future --resume operations.
     */
    handleResult(message) {
        const isError = message.is_error;
        const resultSubtype = message.subtype;
        console.log(`[HybridPTY] Result: ${resultSubtype}, isError: ${isError}`);
        // Capture the session_id for future resume operations
        const sessionId = message.session_id;
        if (sessionId && !this._claudeSessionId) {
            this._claudeSessionId = sessionId;
            console.log(`[HybridPTY] Captured Claude session ID: ${sessionId}`);
        }
        // Update state to completed (not idle, since in hybrid mode process will exit)
        this._state = 'idle';
        // Emit as output
        this.emitOutput(message);
        // In hybrid mode, after result the process will exit
        // Complete event will be emitted in handleExit()
    }
    /**
     * Emit an output event
     */
    emitOutput(message) {
        this.emitEvent({
            sessionId: this.id,
            type: 'output',
            data: { message },
            timestamp: new Date().toISOString(),
        });
    }
    /**
     * Handle PTY exit
     */
    handleExit(exitCode) {
        this.exitCode = exitCode;
        this._state = exitCode === 0 ? 'stopped' : 'error';
        console.log(`[HybridPTY] Process exited with code: ${exitCode}`);
        // Include claudeSessionId in the complete event for resume functionality
        this.emitEvent({
            sessionId: this.id,
            type: 'complete',
            data: {
                exitCode,
                claudeSessionId: this._claudeSessionId,
            },
            timestamp: new Date().toISOString(),
        });
        this.ptyProcess = null;
    }
    /**
     * Emit an event to all subscribers
     */
    emitEvent(event) {
        console.log(`[HybridPTY] Emitting event: type=${event.type}, callbacks=${this.callbacks.size}`);
        this.emitter.emit('event', event);
        for (const callback of this.callbacks) {
            try {
                callback(event);
            }
            catch (error) {
                console.error('[HybridPTY] Callback error:', error);
            }
        }
    }
    /**
     * Send a follow-up message
     *
     * In hybrid mode (-p), each message creates a new process.
     * For follow-up messages, create a new session with resumeSessionId set.
     */
    async sendMessage(_content) {
        // In hybrid mode, we don't send messages to the running session
        // Instead, the caller should create a new session with --resume
        console.log(`[HybridPTY] sendMessage called - in hybrid mode, use a new session with resume`);
        return {
            success: false,
            error: 'In hybrid mode, create a new session with resumeSessionId for follow-up messages',
        };
    }
    /**
     * Subscribe to session events
     */
    subscribe(callback) {
        this.callbacks.add(callback);
        return () => {
            this.callbacks.delete(callback);
        };
    }
    /**
     * Stop the session gracefully
     */
    async stop() {
        if (!this.ptyProcess) {
            return;
        }
        console.log(`[HybridPTY] Stopping session ${this.id}`);
        this._state = 'stopped';
        // Send SIGTERM first
        try {
            this.ptyProcess.kill('SIGTERM');
        }
        catch {
            this.ptyProcess = null;
            return;
        }
        // Wait for exit or force kill after 5 seconds
        await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                if (this.ptyProcess) {
                    console.log(`[HybridPTY] Force killing session ${this.id}`);
                    try {
                        this.ptyProcess.kill('SIGKILL');
                    }
                    catch {
                        // Ignore
                    }
                }
                resolve();
            }, 5000);
            this.emitter.once('exit', () => {
                clearTimeout(timeout);
                resolve();
            });
        });
        this.ptyProcess = null;
        this.callbacks.clear();
    }
    /**
     * Get session info
     */
    getInfo() {
        return {
            id: this.id,
            claudeSessionId: this._claudeSessionId,
            state: this._state,
            messageCount: this.messageCount,
            lastActivity: this.lastActivityTime,
        };
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Legacy Exports (for backwards compatibility)
// ─────────────────────────────────────────────────────────────────────────────
// Re-export as PTYSession for backwards compatibility with existing code
export { StreamingPTYSession as PTYSession };
//# sourceMappingURL=pty-session.js.map