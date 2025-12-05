/**
 * Claude Spawner - Handles spawning Claude Code processes
 *
 * This module is responsible for:
 * - Finding the Claude binary on the system
 * - Building the correct CLI arguments
 * - Spawning the process with proper environment
 * - Setting up stdout/stderr handlers for output streaming
 */

import { spawn, ChildProcess } from 'child_process';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { join } from 'path';
import { sessionRegistry, ProcessHandle } from '../registry/session.js';

/**
 * Options for spawning a Claude process
 */
export interface SpawnOptions {
  /** Absolute path to the project directory */
  projectPath: string;
  /** The prompt or message to send to Claude */
  prompt: string;
  /** Model to use: haiku, sonnet, or opus (default: haiku) */
  model?: string;
  /** Session ID to resume (optional) */
  resume?: string;
}

/**
 * Result of spawning a Claude process
 */
export interface SpawnResult {
  /** The session ID (extracted from Claude's init message) */
  sessionId: string;
  /** The spawned child process */
  process: ChildProcess;
}

/**
 * Common paths where Claude binary might be installed
 */
const CLAUDE_BINARY_PATHS = [
  // Homebrew on Apple Silicon
  '/opt/homebrew/bin/claude',
  // Homebrew on Intel
  '/usr/local/bin/claude',
  // npm global install
  join(homedir(), '.npm-global/bin/claude'),
  // yarn global
  join(homedir(), '.yarn/bin/claude'),
  // pnpm global
  join(homedir(), '.local/share/pnpm/claude'),
  // Direct local install
  join(homedir(), '.local/bin/claude'),
  // Claude's own location
  join(homedir(), '.claude/local/claude'),
];

/**
 * Find the Claude binary path
 * @returns Path to the Claude binary
 * @throws Error if Claude is not found
 */
export function findClaudeBinary(): string {
  // Check common paths first
  for (const path of CLAUDE_BINARY_PATHS) {
    if (existsSync(path)) {
      console.log(`[Spawner] Found Claude at: ${path}`);
      return path;
    }
  }

  // Check NVM installations
  const nvmDir = join(homedir(), '.nvm/versions/node');
  if (existsSync(nvmDir)) {
    try {
      const { execSync } = require('child_process');
      const nodePath = execSync('which node', { encoding: 'utf-8' }).trim();
      const binDir = join(nodePath, '..', 'claude');
      if (existsSync(binDir)) {
        console.log(`[Spawner] Found Claude via NVM at: ${binDir}`);
        return binDir;
      }
    } catch {
      // Ignore errors
    }
  }

  // Fall back to PATH lookup
  try {
    const { execSync } = require('child_process');
    const claudePath = execSync('which claude', { encoding: 'utf-8' }).trim();
    if (claudePath && existsSync(claudePath)) {
      console.log(`[Spawner] Found Claude in PATH: ${claudePath}`);
      return claudePath;
    }
  } catch {
    // which failed
  }

  throw new Error(
    'Claude binary not found. Please install Claude Code: npm install -g @anthropic-ai/claude-code'
  );
}

/**
 * Build CLI arguments for Claude
 */
function buildClaudeArgs(options: SpawnOptions): string[] {
  const args: string[] = [];

  // Resume mode or new session
  if (options.resume) {
    args.push('--resume', options.resume);
  }

  // Add prompt
  args.push('-p', options.prompt);

  // Model selection (default: haiku)
  args.push('--model', options.model || 'haiku');

  // Output format: streaming JSON for parsing
  args.push('--output-format', 'stream-json');

  // Verbose for better debugging
  args.push('--verbose');

  // Skip permission prompts (required for non-interactive)
  args.push('--dangerously-skip-permissions');

  return args;
}

/**
 * Parse a JSONL line from Claude output
 */
function parseJSONLine(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * Extract session ID from Claude's init message
 * Claude outputs a system message with type="system" and subtype="init" containing the session_id
 */
function extractSessionId(jsonMessage: Record<string, unknown>): string | null {
  if (
    jsonMessage.type === 'system' &&
    jsonMessage.subtype === 'init' &&
    typeof jsonMessage.session_id === 'string'
  ) {
    return jsonMessage.session_id;
  }
  return null;
}

/**
 * Spawn a Claude Code process
 *
 * @param options - Spawn configuration
 * @returns Promise resolving to SpawnResult with sessionId and process
 */
export function spawnClaude(options: SpawnOptions): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const claudePath = findClaudeBinary();
    const args = buildClaudeArgs(options);

    console.log(`[Spawner] Spawning Claude: ${claudePath} ${args.join(' ')}`);
    console.log(`[Spawner] Working directory: ${options.projectPath}`);

    // Spawn the process
    const childProcess = spawn(claudePath, args, {
      cwd: options.projectPath,
      env: {
        ...process.env,
        // Ensure proper encoding
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        // Force color output off for clean parsing
        NO_COLOR: '1',
        FORCE_COLOR: '0',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let sessionId: string | null = null;
    let resolved = false;
    let outputBuffer = '';

    // Handle stdout - parse JSONL output
    childProcess.stdout?.on('data', (chunk: Buffer) => {
      const data = chunk.toString();
      outputBuffer += data;

      // Process complete lines
      const lines = outputBuffer.split('\n');
      outputBuffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        const parsed = parseJSONLine(line);
        if (!parsed) {
          // Non-JSON output, still emit as raw
          if (sessionId) {
            sessionRegistry.appendOutput(sessionId, line);
          }
          continue;
        }

        // Try to extract session ID from init message
        if (!sessionId) {
          const extractedId = extractSessionId(parsed);
          if (extractedId) {
            sessionId = extractedId;
            console.log(`[Spawner] Session ID extracted: ${sessionId}`);

            // Create process handle and register
            const handle: ProcessHandle = {
              sessionId,
              process: childProcess,
              projectPath: options.projectPath,
              model: options.model || 'haiku',
              startedAt: new Date(),
              outputBuffer: [],
              maxBufferSize: 1000,
            };

            sessionRegistry.register(sessionId, handle);

            // Resolve the promise now that we have session ID
            if (!resolved) {
              resolved = true;
              resolve({ sessionId, process: childProcess });
            }
          }
        }

        // Forward parsed output to registry
        if (sessionId) {
          sessionRegistry.appendOutput(sessionId, JSON.stringify(parsed));
        }
      }
    });

    // Handle stderr
    childProcess.stderr?.on('data', (chunk: Buffer) => {
      const error = chunk.toString();
      console.error(`[Spawner] Claude stderr: ${error}`);
      if (sessionId) {
        sessionRegistry.emitter.emit('session:error', sessionId, error);
      }
    });

    // Handle process exit
    childProcess.on('exit', (code: number | null) => {
      console.log(`[Spawner] Claude process exited with code: ${code}`);
      if (sessionId) {
        sessionRegistry.emitter.emit('session:complete', sessionId, code);
        sessionRegistry.remove(sessionId);
      }
    });

    // Handle spawn errors
    childProcess.on('error', (error: Error) => {
      console.error(`[Spawner] Failed to spawn Claude:`, error);
      if (!resolved) {
        resolved = true;
        reject(new Error(`Failed to spawn Claude: ${error.message}`));
      }
    });

    // Timeout for session ID extraction
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        // If no session ID but process is running, generate one
        if (!sessionId && !childProcess.killed) {
          sessionId = `temp-${Date.now()}`;
          console.warn(`[Spawner] Session ID not found in output, using temporary: ${sessionId}`);

          const handle: ProcessHandle = {
            sessionId,
            process: childProcess,
            projectPath: options.projectPath,
            model: options.model || 'haiku',
            startedAt: new Date(),
            outputBuffer: [],
            maxBufferSize: 1000,
          };

          sessionRegistry.register(sessionId, handle);
          resolve({ sessionId, process: childProcess });
        } else if (!sessionId) {
          reject(new Error('Timeout waiting for Claude session ID'));
        }
      }
    }, 10000); // 10 second timeout
  });
}
