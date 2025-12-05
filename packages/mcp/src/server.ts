/**
 * MCP Server Configuration
 *
 * This module sets up the MCP server with:
 * - Tool registration (agent.start, agent.message)
 * - Notification emitters (agent.event)
 * - Session registry event handlers
 *
 * The server never generates content itself - it only routes messages
 * between the UI and Claude Code processes.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  handleAgentStart,
  handleAgentMessage,
  AgentStartInputSchema,
  AgentMessageInputSchema,
} from './tools/agent.js';
import { sessionRegistry } from './registry/session.js';

/**
 * Agent event notification payload
 */
export interface AgentEventPayload {
  /** Session ID this event belongs to */
  sessionId: string;
  /** Event type */
  type: 'output' | 'error' | 'complete';
  /** Event data */
  data: {
    /** Parsed JSONL message from Claude (for output events) */
    message?: Record<string, unknown>;
    /** Raw output line (if not parseable as JSON) */
    raw?: string;
    /** Error message (for error events) */
    error?: string;
    /** Exit code (for complete events) */
    exitCode?: number | null;
  };
  /** ISO timestamp of the event */
  timestamp: string;
}

/**
 * Create and configure the MCP server
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'opcode-agent-server',
    version: '1.0.0',
  });

  // Register agent.start tool
  server.tool(
    'agent.start',
    'Start a new Claude Code agent session or resume an existing one. Returns a sessionId for tracking.',
    AgentStartInputSchema.shape,
    async (args) => {
      const input = AgentStartInputSchema.parse(args);
      const result = await handleAgentStart(input);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
      };
    }
  );

  // Register agent.message tool
  server.tool(
    'agent.message',
    'Send a message to a running Claude Code agent session.',
    AgentMessageInputSchema.shape,
    async (args) => {
      const input = AgentMessageInputSchema.parse(args);
      const result = await handleAgentMessage(input);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
      };
    }
  );

  // Set up notification forwarding from session registry
  setupNotificationForwarding(server);

  return server;
}

/**
 * Set up event forwarding from session registry to MCP notifications
 *
 * This connects the session registry events to MCP's notification system,
 * allowing the UI to receive real-time updates about agent output.
 */
function setupNotificationForwarding(server: McpServer): void {
  const emitter = sessionRegistry.emitter;

  // Forward output events
  emitter.on('session:output', (sessionId, data) => {
    const payload: AgentEventPayload = {
      sessionId,
      type: 'output',
      data: {},
      timestamp: new Date().toISOString(),
    };

    // Try to parse as JSON
    try {
      payload.data.message = JSON.parse(data);
    } catch {
      payload.data.raw = data;
    }

    sendNotification(server, 'agent.event', payload);
  });

  // Forward error events
  emitter.on('session:error', (sessionId, error) => {
    const payload: AgentEventPayload = {
      sessionId,
      type: 'error',
      data: { error },
      timestamp: new Date().toISOString(),
    };

    sendNotification(server, 'agent.event', payload);
  });

  // Forward completion events
  emitter.on('session:complete', (sessionId, exitCode) => {
    const payload: AgentEventPayload = {
      sessionId,
      type: 'complete',
      data: { exitCode },
      timestamp: new Date().toISOString(),
    };

    sendNotification(server, 'agent.event', payload);
  });

  console.log('[Server] Notification forwarding set up');
}

/**
 * Notification broadcaster - stores callback to broadcast notifications
 * This is set by the WebSocket transport when a client connects
 */
let notificationBroadcaster: ((method: string, params: unknown) => void) | null = null;

/**
 * Set the notification broadcaster function
 * Called by WebSocket transport to enable notification sending
 */
export function setNotificationBroadcaster(
  broadcaster: (method: string, params: unknown) => void
): void {
  notificationBroadcaster = broadcaster;
}

/**
 * Send a notification to all connected clients
 */
function sendNotification(
  _server: McpServer,
  method: string,
  params: unknown
): void {
  if (notificationBroadcaster) {
    try {
      notificationBroadcaster(method, params);
    } catch (error) {
      console.error(`[Server] Failed to send notification:`, error);
    }
  } else {
    console.warn(`[Server] No notification broadcaster set, notification dropped:`, method);
  }
}

/**
 * Start the MCP server with stdio transport
 *
 * This is the standard MCP transport for CLI tools.
 * For WebSocket transport, see transport/websocket.ts
 */
export async function startStdioServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  console.log('[Server] Starting MCP server with stdio transport');

  await server.connect(transport);

  console.log('[Server] MCP server connected and ready');

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('[Server] Shutting down...');
    await sessionRegistry.cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('[Server] Shutting down...');
    await sessionRegistry.cleanup();
    process.exit(0);
  });
}
