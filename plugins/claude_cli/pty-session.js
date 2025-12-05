/**
 * PTY Session for Claude CLI
 *
 * Wraps a node-pty process for Claude CLI interaction.
 * Based on patterns from ptyclaude project.
 */
import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
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
/**
 * PTY Session
 *
 * Manages a single Claude CLI session via PTY.
 */
export class PTYSession {
    id;
    agentId;
    pluginId = 'claude_cli';
    createdAt;
    projectPath;
    resumeSessionId;
    ptyProcess = null;
    _status = 'starting';
    outputBuffer = '';
    emitter = new EventEmitter();
    callbacks = new Set();
    exitCode = null;
    constructor(options) {
        this.id = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        this.agentId = options.agentId;
        this.projectPath = options.projectPath;
        this.resumeSessionId = options.resume;
        this.createdAt = new Date();
    }
    get status() {
        return this._status;
    }
    /**
     * Start the PTY session
     */
    async start(prompt) {
        const claudePath = findClaudeBinary();
        const args = this.buildArgs(prompt);
        console.log(`[PTYSession] Spawning: ${claudePath} ${args.join(' ')}`);
        this.ptyProcess = pty.spawn(claudePath, args, {
            name: 'xterm-color',
            cols: 120,
            rows: 40,
            cwd: this.projectPath,
            env: {
                ...process.env,
                TERM: 'xterm-256color',
                NO_COLOR: '1',
                FORCE_COLOR: '0',
            },
        });
        this._status = 'running';
        // Handle output
        this.ptyProcess.onData((data) => {
            this.handleOutput(data);
        });
        // Handle exit
        this.ptyProcess.onExit(({ exitCode }) => {
            this.exitCode = exitCode;
            this._status = exitCode === 0 ? 'completed' : 'error';
            this.emitEvent({
                sessionId: this.id,
                type: 'complete',
                data: { exitCode },
                timestamp: new Date().toISOString(),
            });
            console.log(`[PTYSession] Process exited with code: ${exitCode}`);
        });
        // Wait briefly for initialization
        await this.waitForInit();
    }
    /**
     * Build CLI arguments for Claude
     */
    buildArgs(prompt) {
        const args = [];
        // Resume or new session
        if (this.resumeSessionId) {
            args.push('--resume', this.resumeSessionId);
        }
        // Prompt
        args.push('-p', prompt);
        // Model
        args.push('--model', this.agentId);
        // Output format
        args.push('--output-format', 'stream-json');
        // Verbose output
        args.push('--verbose');
        // Skip permission prompts (required for non-interactive)
        args.push('--dangerously-skip-permissions');
        return args;
    }
    /**
     * Wait for initial output from Claude
     */
    waitForInit() {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve();
            }, 3000);
            // Resolve early if we get output
            const handler = () => {
                clearTimeout(timeout);
                this.emitter.off('output', handler);
                resolve();
            };
            this.emitter.once('output', handler);
        });
    }
    /**
     * Handle output from the PTY process
     */
    handleOutput(data) {
        this.outputBuffer += data;
        // Process complete lines
        const lines = this.outputBuffer.split('\n');
        this.outputBuffer = lines.pop() || '';
        for (const line of lines) {
            if (!line.trim())
                continue;
            // Try to parse as JSON
            let event;
            try {
                const parsed = JSON.parse(line);
                // Extract session ID from init message if present
                if (parsed.type === 'system' && parsed.subtype === 'init' && parsed.session_id) {
                    // Update our session ID to match Claude's
                    this.id = parsed.session_id;
                }
                event = {
                    sessionId: this.id,
                    type: 'output',
                    data: { message: parsed },
                    timestamp: new Date().toISOString(),
                };
            }
            catch {
                // Not JSON, emit as raw
                event = {
                    sessionId: this.id,
                    type: 'output',
                    data: { raw: line },
                    timestamp: new Date().toISOString(),
                };
            }
            this.emitEvent(event);
        }
    }
    /**
     * Emit an event to all subscribers
     */
    emitEvent(event) {
        this.emitter.emit('output', event);
        for (const callback of this.callbacks) {
            try {
                callback(event);
            }
            catch (error) {
                console.error('[PTYSession] Callback error:', error);
            }
        }
    }
    /**
     * Send a message to the running session
     */
    async sendMessage(message) {
        if (!this.ptyProcess || this._status !== 'running') {
            return { success: false, error: 'Session not running' };
        }
        try {
            // Write message followed by newline
            this.ptyProcess.write(message + '\n');
            return { success: true };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return { success: false, error: errorMsg };
        }
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
     * Stop the session
     * Uses two-phase kill: SIGTERM first, then SIGKILL after timeout
     */
    async stop() {
        if (!this.ptyProcess) {
            return;
        }
        console.log(`[PTYSession] Stopping session ${this.id}`);
        this._status = 'stopped';
        // Phase 1: SIGTERM
        try {
            this.ptyProcess.kill('SIGTERM');
        }
        catch {
            // Already dead
            this.ptyProcess = null;
            return;
        }
        // Phase 2: SIGKILL after 5 seconds if still running
        await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                if (this.ptyProcess) {
                    console.log(`[PTYSession] Force killing session ${this.id}`);
                    try {
                        this.ptyProcess.kill('SIGKILL');
                    }
                    catch {
                        // Ignore
                    }
                }
                resolve();
            }, 5000);
            // Resolve early if process exits
            const checkExit = () => {
                if (!this.ptyProcess) {
                    clearTimeout(timeout);
                    resolve();
                }
            };
            this.emitter.once('exit', () => {
                clearTimeout(timeout);
                resolve();
            });
            // Also check periodically
            const interval = setInterval(() => {
                checkExit();
                if (!this.ptyProcess) {
                    clearInterval(interval);
                }
            }, 100);
            setTimeout(() => clearInterval(interval), 6000);
        });
        this.ptyProcess = null;
        this.callbacks.clear();
    }
}
//# sourceMappingURL=pty-session.js.map