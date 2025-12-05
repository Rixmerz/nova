/**
 * SessionRegistry - Manages running Claude Code processes
 *
 * This registry tracks all active agent sessions, allowing the MCP server to:
 * - Register new processes when agent.start is called
 * - Route messages to the correct process stdin via agent.message
 * - Clean up processes when sessions end or disconnect
 * - Provide session status information
 */

import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

/**
 * Represents a running Claude Code process
 */
export interface ProcessHandle {
  /** Unique session identifier (from Claude's init message) */
  sessionId: string;
  /** The spawned child process */
  process: ChildProcess;
  /** Project directory where Claude is running */
  projectPath: string;
  /** Model being used (haiku, sonnet, opus) */
  model: string;
  /** When the session started */
  startedAt: Date;
  /** Buffered output for late-joining clients */
  outputBuffer: string[];
  /** Maximum lines to keep in buffer */
  maxBufferSize: number;
}

/**
 * Events emitted by the SessionRegistry
 */
export interface SessionRegistryEvents {
  /** Emitted when a new session is registered */
  'session:registered': (sessionId: string, handle: ProcessHandle) => void;
  /** Emitted when a session is removed */
  'session:removed': (sessionId: string) => void;
  /** Emitted when a session outputs data */
  'session:output': (sessionId: string, data: string) => void;
  /** Emitted when a session errors */
  'session:error': (sessionId: string, error: string) => void;
  /** Emitted when a session completes */
  'session:complete': (sessionId: string, exitCode: number | null) => void;
}

/**
 * Type-safe event emitter for SessionRegistry
 */
export class SessionRegistryEmitter extends EventEmitter {
  emit<K extends keyof SessionRegistryEvents>(
    event: K,
    ...args: Parameters<SessionRegistryEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof SessionRegistryEvents>(
    event: K,
    listener: SessionRegistryEvents[K]
  ): this {
    return super.on(event, listener);
  }

  off<K extends keyof SessionRegistryEvents>(
    event: K,
    listener: SessionRegistryEvents[K]
  ): this {
    return super.off(event, listener);
  }
}

/**
 * Registry for managing active Claude Code sessions
 */
export class SessionRegistry {
  private sessions = new Map<string, ProcessHandle>();
  private events = new SessionRegistryEmitter();

  /**
   * Get the event emitter for subscribing to session events
   */
  get emitter(): SessionRegistryEmitter {
    return this.events;
  }

  /**
   * Register a new session with its process handle
   * @param sessionId - Unique session identifier
   * @param handle - Process handle containing the child process
   */
  register(sessionId: string, handle: ProcessHandle): void {
    this.sessions.set(sessionId, handle);
    this.events.emit('session:registered', sessionId, handle);
    console.log(`[Registry] Session registered: ${sessionId}`);
  }

  /**
   * Get a session by its ID
   * @param sessionId - The session ID to look up
   * @returns The process handle or undefined if not found
   */
  get(sessionId: string): ProcessHandle | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Check if a session exists
   * @param sessionId - The session ID to check
   */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Remove a session from the registry
   * @param sessionId - The session ID to remove
   * @returns true if the session was removed
   */
  remove(sessionId: string): boolean {
    const existed = this.sessions.delete(sessionId);
    if (existed) {
      this.events.emit('session:removed', sessionId);
      console.log(`[Registry] Session removed: ${sessionId}`);
    }
    return existed;
  }

  /**
   * Send a message to a running session's stdin
   * @param sessionId - The session to send to
   * @param message - The message content
   * @returns true if the message was sent
   */
  sendMessage(sessionId: string, message: string): boolean {
    const handle = this.sessions.get(sessionId);
    if (!handle || !handle.process.stdin) {
      console.warn(`[Registry] Cannot send message: session ${sessionId} not found or stdin closed`);
      return false;
    }

    try {
      // Write message to stdin followed by newline
      handle.process.stdin.write(message + '\n');
      console.log(`[Registry] Message sent to session ${sessionId}`);
      return true;
    } catch (error) {
      console.error(`[Registry] Error sending message to ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Kill a session's process
   * @param sessionId - The session to kill
   * @returns Promise that resolves when the process is killed
   */
  async killSession(sessionId: string): Promise<boolean> {
    const handle = this.sessions.get(sessionId);
    if (!handle) {
      console.warn(`[Registry] Cannot kill: session ${sessionId} not found`);
      return false;
    }

    return new Promise((resolve) => {
      const process = handle.process;

      // Set up cleanup on exit
      const cleanup = () => {
        this.remove(sessionId);
        resolve(true);
      };

      process.once('exit', cleanup);

      // Try graceful termination first
      process.kill('SIGTERM');

      // Force kill after timeout
      setTimeout(() => {
        if (!process.killed) {
          console.log(`[Registry] Force killing session ${sessionId}`);
          process.kill('SIGKILL');
        }
      }, 5000);
    });
  }

  /**
   * Append output to a session's buffer
   * @param sessionId - The session ID
   * @param output - The output line to append
   */
  appendOutput(sessionId: string, output: string): void {
    const handle = this.sessions.get(sessionId);
    if (!handle) return;

    handle.outputBuffer.push(output);

    // Trim buffer if exceeds max size
    if (handle.outputBuffer.length > handle.maxBufferSize) {
      handle.outputBuffer.shift();
    }

    this.events.emit('session:output', sessionId, output);
  }

  /**
   * Get all active sessions
   * @returns Array of all process handles
   */
  getAllSessions(): ProcessHandle[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get count of active sessions
   */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Clean up all sessions (for shutdown)
   */
  async cleanup(): Promise<void> {
    console.log(`[Registry] Cleaning up ${this.sessions.size} sessions`);
    const killPromises = Array.from(this.sessions.keys()).map(
      (sessionId) => this.killSession(sessionId)
    );
    await Promise.all(killPromises);
  }
}

// Singleton instance for the MCP server
export const sessionRegistry = new SessionRegistry();
