/**
 * WebSocket Transport for MCP Server
 *
 * This module provides a WebSocket-based transport layer that allows
 * browser clients to connect to the MCP server.
 *
 * The transport:
 * - Runs an HTTP server with WebSocket upgrade on /mcp path
 * - Wraps each WebSocket connection as an MCP transport
 * - Forwards MCP messages bidirectionally
 * - Handles multiple concurrent connections
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, Server } from 'http';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer, setNotificationBroadcaster } from '../server.js';
import { sessionRegistry } from '../registry/session.js';

const DEFAULT_PORT = 8080;
const WS_PATH = '/mcp';

/**
 * WebSocket transport adapter for MCP
 *
 * Implements the MCP Transport interface over a WebSocket connection.
 */
class WebSocketTransport implements Transport {
  private ws: WebSocket;
  private _onMessage?: (message: JSONRPCMessage) => void;
  private _onClose?: () => void;
  private _onError?: (error: Error) => void;

  constructor(ws: WebSocket) {
    this.ws = ws;

    // Handle incoming messages
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as JSONRPCMessage;
        console.log('[WS Transport] Received:', JSON.stringify(message).substring(0, 100));
        this._onMessage?.(message);
      } catch (error) {
        console.error('[WS Transport] Failed to parse message:', error);
      }
    });

    // Handle connection close
    ws.on('close', () => {
      console.log('[WS Transport] Connection closed');
      this._onClose?.();
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error('[WS Transport] Error:', error);
      this._onError?.(error);
    });
  }

  /**
   * Start the transport (no-op for WebSocket, already connected)
   */
  async start(): Promise<void> {
    console.log('[WS Transport] Transport started');
  }

  /**
   * Send a message through the WebSocket
   */
  async send(message: JSONRPCMessage): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) {
      const data = JSON.stringify(message);
      console.log('[WS Transport] Sending:', data.substring(0, 100));
      this.ws.send(data);
    } else {
      console.warn('[WS Transport] Cannot send, WebSocket not open');
    }
  }

  /**
   * Close the transport
   */
  async close(): Promise<void> {
    this.ws.close();
    console.log('[WS Transport] Transport closed');
  }

  /**
   * Set message handler
   */
  set onmessage(handler: ((message: JSONRPCMessage) => void) | undefined) {
    this._onMessage = handler;
  }

  /**
   * Set close handler
   */
  set onclose(handler: (() => void) | undefined) {
    this._onClose = handler;
  }

  /**
   * Set error handler
   */
  set onerror(handler: ((error: Error) => void) | undefined) {
    this._onError = handler;
  }
}

/**
 * WebSocket MCP Server
 *
 * Manages the HTTP/WebSocket server and MCP connections.
 */
export class WebSocketMcpServer {
  private httpServer: Server;
  private wss: WebSocketServer;
  private connections = new Set<WebSocket>();
  private port: number;

  constructor(port: number = DEFAULT_PORT) {
    this.port = port;

    // Create HTTP server
    this.httpServer = createServer((req, res) => {
      // Health check endpoint
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          sessions: sessionRegistry.size,
          connections: this.connections.size,
        }));
        return;
      }

      // Default response
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Opcode MCP Server - Connect via WebSocket at /mcp');
    });

    // Create WebSocket server
    this.wss = new WebSocketServer({
      server: this.httpServer,
      path: WS_PATH,
    });

    this.setupWebSocketServer();
  }

  /**
   * Set up WebSocket server event handlers
   */
  private setupWebSocketServer(): void {
    // Set up notification broadcaster to send to all connected clients
    setNotificationBroadcaster((method: string, params: unknown) => {
      this.broadcast({
        jsonrpc: '2.0',
        method,
        params,
      } as JSONRPCMessage);
    });

    this.wss.on('connection', (ws, req) => {
      console.log(`[WS Server] New connection from ${req.socket.remoteAddress}`);
      this.connections.add(ws);

      // Create MCP server and transport for this connection
      const server = createMcpServer();
      const transport = new WebSocketTransport(ws);

      // Connect MCP server to this transport
      server.connect(transport).catch((error) => {
        console.error('[WS Server] Failed to connect MCP server:', error);
        ws.close();
      });

      // Handle disconnection
      ws.on('close', () => {
        this.connections.delete(ws);
        console.log(`[WS Server] Connection closed. Active: ${this.connections.size}`);
      });
    });

    this.wss.on('error', (error) => {
      console.error('[WS Server] WebSocket server error:', error);
    });
  }

  /**
   * Start the WebSocket MCP server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer.listen(this.port, () => {
        console.log(`[WS Server] MCP Server listening on http://localhost:${this.port}`);
        console.log(`[WS Server] WebSocket endpoint: ws://localhost:${this.port}${WS_PATH}`);
        resolve();
      });

      this.httpServer.on('error', (error) => {
        console.error('[WS Server] HTTP server error:', error);
        reject(error);
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    console.log('[WS Server] Stopping server...');

    // Close all WebSocket connections
    for (const ws of this.connections) {
      ws.close();
    }
    this.connections.clear();

    // Clean up sessions
    await sessionRegistry.cleanup();

    // Close servers
    this.wss.close();
    this.httpServer.close();

    console.log('[WS Server] Server stopped');
  }

  /**
   * Broadcast a message to all connected clients
   */
  broadcast(message: JSONRPCMessage): void {
    const data = JSON.stringify(message);
    for (const ws of this.connections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }
}

/**
 * Start the WebSocket MCP server
 */
export async function startWebSocketServer(
  port: number = DEFAULT_PORT
): Promise<WebSocketMcpServer> {
  const server = new WebSocketMcpServer(port);
  await server.start();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[WS Server] Received SIGINT, shutting down...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('[WS Server] Received SIGTERM, shutting down...');
    await server.stop();
    process.exit(0);
  });

  return server;
}
