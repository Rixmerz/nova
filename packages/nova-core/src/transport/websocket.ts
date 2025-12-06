/**
 * WebSocket Transport for Nova Core
 *
 * Provides a WebSocket server for frontend communication.
 * Uses JSON-RPC 2.0 for request/response and notifications.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, Server } from 'http';
import { getPluginRegistry, PluginRegistry } from '../core/plugin-registry.js';
import { getPluginLoader, PluginLoader } from '../core/plugin-loader.js';
import { getConfigLoader, ConfigLoader } from '../core/config.js';
import type { SessionEvent, StreamCallback } from '../interfaces/index.js';
import * as projectService from '../services/projects.js';
import * as sessionService from '../services/sessions.js';

const DEFAULT_PORT = 8080;
const WS_PATH = '/nova';

/**
 * JSON-RPC Request
 */
interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * JSON-RPC Response
 */
interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * JSON-RPC Notification (no id, no response expected)
 */
interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

/**
 * Error codes
 */
const ErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Custom errors
  PLUGIN_NOT_FOUND: -32001,
  AGENT_NOT_FOUND: -32002,
  SESSION_NOT_FOUND: -32003,
};

/**
 * WebSocket Nova Server
 *
 * Handles WebSocket connections and routes JSON-RPC requests to plugins.
 */
export class WebSocketNovaServer {
  private httpServer: Server;
  private wss: WebSocketServer;
  private connections = new Set<WebSocket>();
  private sessionSubscriptions = new Map<string, Set<WebSocket>>();
  private port: number;
  private registry: PluginRegistry;
  private loader: PluginLoader;
  private configLoader: ConfigLoader;

  constructor(options: { port?: number; basePath?: string } = {}) {
    this.port = options.port ?? DEFAULT_PORT;

    // Initialize core components
    this.configLoader = getConfigLoader(options.basePath);
    this.registry = getPluginRegistry();
    this.loader = getPluginLoader({
      basePath: options.basePath,
      registry: this.registry,
      configLoader: this.configLoader,
    });

    // Create HTTP server
    this.httpServer = createServer((req, res) => {
      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
      }

      // Add CORS headers to all responses
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };

      if (req.url === '/health') {
        res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            plugins: this.registry.size,
            sessions: this.registry.getSessions().length,
            connections: this.connections.size,
          })
        );
        return;
      }

      if (req.url === '/plugins') {
        res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            plugins: this.registry.getPlugins().map((p) => ({
              name: p.name,
              type: p.type,
              source: p.source,
              agents: p.agents.filter((a) => a.enabled).map((a) => a.id),
            })),
          })
        );
        return;
      }

      res.writeHead(200, { ...headers, 'Content-Type': 'text/plain' });
      res.end(`Nova Core Server - Connect via WebSocket at ${WS_PATH}`);
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
    this.wss.on('connection', (ws, req) => {
      console.log(`[WS] New connection from ${req.socket.remoteAddress}`);
      this.connections.add(ws);

      // Handle messages
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleRequest(ws, message);
        } catch (error) {
          this.sendError(ws, null, ErrorCodes.PARSE_ERROR, 'Parse error');
        }
      });

      // Handle close
      ws.on('close', () => {
        this.connections.delete(ws);
        // Remove from all session subscriptions
        for (const [sessionId, sockets] of this.sessionSubscriptions) {
          sockets.delete(ws);
          if (sockets.size === 0) {
            this.sessionSubscriptions.delete(sessionId);
          }
        }
        console.log(`[WS] Connection closed. Active: ${this.connections.size}`);
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error('[WS] Error:', error);
      });
    });

    this.wss.on('error', (error) => {
      console.error('[WS] Server error:', error);
    });
  }

  /**
   * Handle incoming JSON-RPC request
   */
  private async handleRequest(ws: WebSocket, request: JSONRPCRequest): Promise<void> {
    const { id, method, params = {} } = request;

    console.log(`[WS] Request: ${method}`);

    try {
      let result: unknown;

      switch (method) {
        // Plugin operations
        case 'plugin.list':
          result = this.handlePluginList();
          break;

        case 'agent.list':
          result = this.handleAgentList();
          break;

        // Session operations
        case 'agent.invoke':
          result = await this.handleAgentInvoke(ws, params as {
            plugin: string;
            agent: string;
            prompt: string;
            projectPath: string;
            resume?: string;
            bypassMode?: boolean;
          });
          break;

        case 'session.message':
          result = await this.handleSessionMessage(params as {
            sessionId: string;
            message: string;
          });
          break;

        case 'session.stop':
          result = await this.handleSessionStop(params as { sessionId: string });
          break;

        case 'session.list':
          result = this.handleSessionList();
          break;

        case 'session.get':
          result = this.handleSessionGet(params as { sessionId: string });
          break;

        case 'session.subscribe':
          result = this.handleSessionSubscribe(ws, params as { sessionId: string });
          break;

        case 'session.unsubscribe':
          result = this.handleSessionUnsubscribe(ws, params as { sessionId: string });
          break;

        // Project operations
        case 'project.list':
          result = await this.handleProjectList();
          break;

        case 'project.sessions':
          result = await this.handleProjectSessions(params as { projectId: string });
          break;

        // Session history operations
        case 'session.history':
          result = await this.handleSessionHistory(params as {
            sessionId: string;
            projectId: string;
          });
          break;

        case 'session.delete':
          result = await this.handleSessionDelete(params as {
            sessionId: string;
            projectId: string;
          });
          break;

        case 'session.deleteBulk':
          result = await this.handleSessionDeleteBulk(params as {
            sessionIds: string[];
            projectId: string;
          });
          break;

        // Utility operations
        case 'system.homeDirectory':
          result = { homeDirectory: projectService.getHomeDirectory() };
          break;

        default:
          this.sendError(ws, id, ErrorCodes.METHOD_NOT_FOUND, `Method not found: ${method}`);
          return;
      }

      this.sendResult(ws, id, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal error';
      console.error(`[WS] Error handling ${method}:`, error);
      this.sendError(ws, id, ErrorCodes.INTERNAL_ERROR, message);
    }
  }

  /**
   * List all plugins
   */
  private handlePluginList(): unknown {
    return {
      plugins: this.registry.getPlugins().map((p) => ({
        name: p.name,
        type: p.type,
        source: p.source,
        supports: p.supports,
        agents: p.agents
          .filter((a) => a.enabled)
          .map((a) => ({
            id: a.id,
            name: a.name,
            capabilities: a.capabilities,
          })),
      })),
    };
  }

  /**
   * List all agents
   */
  private handleAgentList(): unknown {
    return {
      agents: this.registry.getAgents().map(({ plugin, agent }) => ({
        plugin,
        id: agent.id,
        name: agent.name,
        capabilities: agent.capabilities,
      })),
    };
  }

  /**
   * Invoke an agent
   */
  private async handleAgentInvoke(
    ws: WebSocket,
    params: {
      plugin: string;
      agent: string;
      prompt: string;
      projectPath: string;
      resume?: string;
      bypassMode?: boolean;
    }
  ): Promise<unknown> {
    const { plugin, agent, prompt, projectPath, resume, bypassMode } = params;

    const session = await this.registry.invoke(plugin, agent, {
      projectPath,
      prompt,
      resume,
      bypassMode,
    });

    // Auto-subscribe this connection to the session
    this.subscribeToSession(ws, session.id);

    return {
      sessionId: session.id,
      claudeSessionId: session.claudeSessionId,
      status: session.status,
      agentId: session.agentId,
      pluginId: session.pluginId,
    };
  }

  /**
   * Send a message to a session
   */
  private async handleSessionMessage(params: {
    sessionId: string;
    message: string;
  }): Promise<unknown> {
    const { sessionId, message } = params;
    return this.registry.message(sessionId, message);
  }

  /**
   * Stop a session
   */
  private async handleSessionStop(params: { sessionId: string }): Promise<unknown> {
    const { sessionId } = params;
    await this.registry.stop(sessionId);
    return { success: true };
  }

  /**
   * List all sessions
   */
  private handleSessionList(): unknown {
    return {
      sessions: this.registry.getSessions().map((s) => ({
        id: s.id,
        agentId: s.agentId,
        pluginId: s.pluginId,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Get a specific session
   */
  private handleSessionGet(params: { sessionId: string }): unknown {
    const session = this.registry.getSession(params.sessionId);
    if (!session) {
      throw new Error(`Session '${params.sessionId}' not found`);
    }

    return {
      id: session.id,
      agentId: session.agentId,
      pluginId: session.pluginId,
      status: session.status,
      createdAt: session.createdAt.toISOString(),
      projectPath: session.projectPath,
    };
  }

  /**
   * Subscribe to session events
   */
  private handleSessionSubscribe(ws: WebSocket, params: { sessionId: string }): unknown {
    this.subscribeToSession(ws, params.sessionId);
    return { subscribed: true, sessionId: params.sessionId };
  }

  /**
   * Unsubscribe from session events
   */
  private handleSessionUnsubscribe(ws: WebSocket, params: { sessionId: string }): unknown {
    const sockets = this.sessionSubscriptions.get(params.sessionId);
    if (sockets) {
      sockets.delete(ws);
      if (sockets.size === 0) {
        this.sessionSubscriptions.delete(params.sessionId);
      }
    }
    return { unsubscribed: true, sessionId: params.sessionId };
  }

  // ===== PROJECT HANDLERS =====

  /**
   * List all projects
   */
  private async handleProjectList(): Promise<unknown> {
    const projects = await projectService.listProjects();
    return { projects };
  }

  /**
   * Get sessions for a project
   */
  private async handleProjectSessions(params: { projectId: string }): Promise<unknown> {
    const sessions = await projectService.getProjectSessions(params.projectId);
    return { sessions };
  }

  // ===== SESSION HISTORY HANDLERS =====

  /**
   * Load session history
   */
  private async handleSessionHistory(params: {
    sessionId: string;
    projectId: string;
  }): Promise<unknown> {
    const messages = await sessionService.loadSessionHistory(
      params.sessionId,
      params.projectId
    );
    return { messages };
  }

  /**
   * Delete a session
   */
  private async handleSessionDelete(params: {
    sessionId: string;
    projectId: string;
  }): Promise<unknown> {
    await sessionService.deleteSession(params.sessionId, params.projectId);
    return { success: true };
  }

  /**
   * Delete multiple sessions
   */
  private async handleSessionDeleteBulk(params: {
    sessionIds: string[];
    projectId: string;
  }): Promise<unknown> {
    const result = await sessionService.deleteSessions(params.sessionIds, params.projectId);
    return result;
  }

  /**
   * Subscribe a WebSocket to session events
   */
  private subscribeToSession(ws: WebSocket, sessionId: string): void {
    let sockets = this.sessionSubscriptions.get(sessionId);
    if (!sockets) {
      sockets = new Set();
      this.sessionSubscriptions.set(sessionId, sockets);

      // Set up stream callback for this session
      const unsubscribe = this.registry.stream(sessionId, (event: SessionEvent) => {
        this.broadcastSessionEvent(sessionId, event);
      });

      // Clean up when all clients unsubscribe
      // (handled implicitly when session ends)
    }
    sockets.add(ws);
  }

  /**
   * Broadcast a session event to subscribed clients
   */
  private broadcastSessionEvent(sessionId: string, event: SessionEvent): void {
    const sockets = this.sessionSubscriptions.get(sessionId);
    console.log(`[WS] Broadcasting event to ${sockets?.size ?? 0} clients: type=${event.type}`);
    if (!sockets) return;

    const notification: JSONRPCNotification = {
      jsonrpc: '2.0',
      method: 'session.event',
      params: event,
    };

    const data = JSON.stringify(notification);
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  /**
   * Send a successful response
   */
  private sendResult(ws: WebSocket, id: number | string | null, result: unknown): void {
    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id,
      result,
    };
    ws.send(JSON.stringify(response));
  }

  /**
   * Send an error response
   */
  private sendError(
    ws: WebSocket,
    id: number | string | null,
    code: number,
    message: string,
    data?: unknown
  ): void {
    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id,
      error: { code, message, data },
    };
    ws.send(JSON.stringify(response));
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    // Load plugins first
    console.log('[WS] Loading plugins...');
    await this.loader.discover();

    // Start HTTP server
    return new Promise((resolve, reject) => {
      this.httpServer.listen(this.port, () => {
        console.log(`[WS] Nova Server listening on http://localhost:${this.port}`);
        console.log(`[WS] WebSocket endpoint: ws://localhost:${this.port}${WS_PATH}`);
        console.log(`[WS] Loaded plugins: ${this.loader.getLoadedPlugins().join(', ') || 'none'}`);
        resolve();
      });

      this.httpServer.on('error', (error) => {
        console.error('[WS] Server error:', error);
        reject(error);
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    console.log('[WS] Stopping server...');

    // Close all connections
    for (const ws of this.connections) {
      ws.close();
    }
    this.connections.clear();
    this.sessionSubscriptions.clear();

    // Shutdown plugins
    await this.registry.shutdown();

    // Close servers
    this.wss.close();
    this.httpServer.close();

    console.log('[WS] Server stopped');
  }
}

/**
 * Start the WebSocket Nova server
 */
export async function startNovaServer(options?: {
  port?: number;
  basePath?: string;
}): Promise<WebSocketNovaServer> {
  const server = new WebSocketNovaServer(options);
  await server.start();

  // Graceful shutdown handlers
  process.on('SIGINT', async () => {
    console.log('\n[WS] Received SIGINT, shutting down...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('[WS] Received SIGTERM, shutting down...');
    await server.stop();
    process.exit(0);
  });

  return server;
}
