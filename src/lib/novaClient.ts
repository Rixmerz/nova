/**
 * Nova Client for Nova UI
 *
 * This client connects to the Nova Core Server via WebSocket
 * and provides a high-level API for:
 *
 * - Listing available plugins and agents
 * - Starting agent sessions (agent.invoke)
 * - Sending messages to agents (session.message)
 * - Receiving agent output via notifications (session.event)
 *
 * The client handles:
 * - WebSocket connection management
 * - JSON-RPC message framing
 * - Request/response correlation
 * - Event subscription per session
 */

// Types for Nova communication
interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

// Agent event payload from Nova server
export interface SessionEvent {
  sessionId: string;
  type: 'output' | 'error' | 'complete' | 'status';
  data: {
    message?: Record<string, unknown>;
    raw?: string;
    error?: string;
    exitCode?: number | null;
    status?: string;
  };
  timestamp: string;
}

// Plugin information
export interface PluginInfo {
  name: string;
  type: string;
  source: string;
  supports: string[];
  agents: AgentInfo[];
}

// Agent information
export interface AgentInfo {
  id: string;
  name: string;
  capabilities: string[];
  plugin?: string;
}

// Session information
export interface SessionInfo {
  id: string;
  agentId: string;
  pluginId: string;
  status: string;
  createdAt: string;
  projectPath?: string;
}

// Options for invoking an agent
export interface InvokeOptions {
  plugin: string;
  agent: string;
  projectPath: string;
  prompt: string;
  resume?: string;
}

// Result from agent.invoke
export interface InvokeResult {
  sessionId: string;
  status: string;
  agentId: string;
  pluginId: string;
}

// Event handler type
type SessionEventHandler = (event: SessionEvent) => void;

/**
 * Nova Client for connecting to the Nova Core Server
 */
class NovaClient {
  private ws: WebSocket | null = null;
  private url: string = '';
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private eventHandlers = new Map<string, Set<SessionEventHandler>>();
  private globalEventHandlers = new Set<SessionEventHandler>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private isConnected = false;

  /**
   * Connect to the Nova server
   * @param url WebSocket URL (e.g., ws://localhost:8080/nova)
   */
  async connect(url: string = 'ws://localhost:8080/nova'): Promise<void> {
    this.url = url;

    return new Promise((resolve, reject) => {
      console.log(`[NovaClient] Connecting to ${url}`);

      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('[NovaClient] Connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        resolve();
      };

      this.ws.onclose = () => {
        console.log('[NovaClient] Disconnected');
        this.isConnected = false;
        this.handleDisconnect();
      };

      this.ws.onerror = (event) => {
        console.error('[NovaClient] WebSocket error:', event);
        if (!this.isConnected) {
          reject(new Error('Failed to connect to Nova server'));
        }
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // Check if it's a response to a request
      if ('id' in message && message.id !== undefined) {
        const response = message as JSONRPCResponse;
        const pending = this.pendingRequests.get(response.id);

        if (pending) {
          this.pendingRequests.delete(response.id);

          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
        return;
      }

      // Check if it's a notification
      if ('method' in message) {
        const notification = message as JSONRPCNotification;

        if (notification.method === 'session.event' && notification.params) {
          const event = notification.params as unknown as SessionEvent;
          this.dispatchEvent(event);
        }
      }
    } catch (error) {
      console.error('[NovaClient] Failed to parse message:', error);
    }
  }

  /**
   * Dispatch a session event to handlers
   */
  private dispatchEvent(event: SessionEvent): void {
    // Session-specific handlers
    const handlers = this.eventHandlers.get(event.sessionId);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (error) {
          console.error('[NovaClient] Event handler error:', error);
        }
      }
    }

    // Global handlers
    for (const handler of this.globalEventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[NovaClient] Global event handler error:', error);
      }
    }
  }

  /**
   * Handle disconnection with optional reconnect
   */
  private handleDisconnect(): void {
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error('Connection closed'));
      this.pendingRequests.delete(id);
    }

    // Attempt reconnect
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * this.reconnectAttempts;
      console.log(
        `[NovaClient] Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`
      );

      setTimeout(() => {
        this.connect(this.url).catch((error) => {
          console.error('[NovaClient] Reconnect failed:', error);
        });
      }, delay);
    }
  }

  /**
   * Send a JSON-RPC request and wait for response
   */
  private async sendRequest<T>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to Nova server');
    }

    const id = ++this.requestId;

    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      this.ws!.send(JSON.stringify(request));

      // Request timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000); // 30 second timeout
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Plugin & Agent Operations
  // ─────────────────────────────────────────────────────────────

  /**
   * List all available plugins
   */
  async listPlugins(): Promise<PluginInfo[]> {
    const result = await this.sendRequest<{ plugins: PluginInfo[] }>('plugin.list');
    return result.plugins;
  }

  /**
   * List all available agents
   */
  async listAgents(): Promise<AgentInfo[]> {
    const result = await this.sendRequest<{ agents: AgentInfo[] }>('agent.list');
    return result.agents;
  }

  // ─────────────────────────────────────────────────────────────
  // Session Operations
  // ─────────────────────────────────────────────────────────────

  /**
   * Invoke an agent and create a new session
   * @param options Agent invocation options
   * @returns Session ID and status
   */
  async invoke(options: InvokeOptions): Promise<InvokeResult> {
    console.log('[NovaClient] Invoking agent:', options);

    return this.sendRequest<InvokeResult>('agent.invoke', {
      plugin: options.plugin,
      agent: options.agent,
      projectPath: options.projectPath,
      prompt: options.prompt,
      resume: options.resume,
    });
  }

  /**
   * Send a message to a running session
   * @param sessionId Session to send to
   * @param message Message content
   */
  async sendMessage(
    sessionId: string,
    message: string
  ): Promise<{ success: boolean; error?: string }> {
    console.log(`[NovaClient] Sending message to ${sessionId}`);

    return this.sendRequest<{ success: boolean; error?: string }>(
      'session.message',
      {
        sessionId,
        message,
      }
    );
  }

  /**
   * Stop a running session
   * @param sessionId Session to stop
   */
  async stopSession(sessionId: string): Promise<{ success: boolean }> {
    console.log(`[NovaClient] Stopping session ${sessionId}`);

    return this.sendRequest<{ success: boolean }>('session.stop', {
      sessionId,
    });
  }

  /**
   * List all active sessions
   */
  async listSessions(): Promise<SessionInfo[]> {
    const result = await this.sendRequest<{ sessions: SessionInfo[] }>('session.list');
    return result.sessions;
  }

  /**
   * Get a specific session
   * @param sessionId Session identifier
   */
  async getSession(sessionId: string): Promise<SessionInfo> {
    return this.sendRequest<SessionInfo>('session.get', { sessionId });
  }

  // ─────────────────────────────────────────────────────────────
  // Event Subscriptions
  // ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to session events for a specific session
   * @param sessionId Session to subscribe to
   * @param handler Event handler function
   * @returns Unsubscribe function
   */
  onSessionEvent(sessionId: string, handler: SessionEventHandler): () => void {
    let handlers = this.eventHandlers.get(sessionId);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(sessionId, handlers);
    }
    handlers.add(handler);

    // Return unsubscribe function
    return () => {
      handlers!.delete(handler);
      if (handlers!.size === 0) {
        this.eventHandlers.delete(sessionId);
      }
    };
  }

  /**
   * Subscribe to all session events
   * @param handler Event handler function
   * @returns Unsubscribe function
   */
  onAllSessionEvents(handler: SessionEventHandler): () => void {
    this.globalEventHandlers.add(handler);

    return () => {
      this.globalEventHandlers.delete(handler);
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Connection Management
  // ─────────────────────────────────────────────────────────────

  /**
   * Check if connected to the server
   */
  get connected(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Disconnect from the server
   */
  async disconnect(): Promise<void> {
    if (this.ws) {
      this.maxReconnectAttempts = 0; // Prevent reconnect
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    console.log('[NovaClient] Disconnected');
  }
}

// Singleton instance
export const novaClient = new NovaClient();

// Export class for custom instances
export { NovaClient };
