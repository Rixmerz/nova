/**
 * MCP Client for Nova UI
 *
 * This client connects to the Opcode MCP Server via WebSocket
 * and provides a high-level API for:
 *
 * - Starting agent sessions (agent.start)
 * - Sending messages to agents (agent.message)
 * - Receiving agent output via notifications (agent.event)
 *
 * The client handles:
 * - WebSocket connection management
 * - JSON-RPC message framing
 * - Request/response correlation
 * - Event subscription per session
 */

// Types for MCP communication
interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: { content: Array<{ type: string; text: string }> };
  error?: { code: number; message: string; data?: unknown };
}

interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

// Agent event payload from MCP server
export interface AgentEvent {
  sessionId: string;
  type: 'output' | 'error' | 'complete';
  data: {
    message?: Record<string, unknown>;
    raw?: string;
    error?: string;
    exitCode?: number | null;
  };
  timestamp: string;
}

// Options for starting an agent
export interface StartAgentOptions {
  projectPath: string;
  prompt: string;
  model?: 'haiku' | 'sonnet' | 'opus';
  resume?: string;
}

// Result from agent.start
export interface StartAgentResult {
  sessionId: string;
  status: 'started' | 'error';
  error?: string;
}

// Event handler type
type AgentEventHandler = (event: AgentEvent) => void;

/**
 * MCP Client for connecting to the Opcode MCP Server
 */
class MCPClient {
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
  private eventHandlers = new Map<string, Set<AgentEventHandler>>();
  private globalEventHandlers = new Set<AgentEventHandler>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private isConnected = false;

  /**
   * Connect to the MCP server
   * @param url WebSocket URL (e.g., ws://localhost:8080/mcp)
   */
  async connect(url: string = 'ws://localhost:8080/mcp'): Promise<void> {
    this.url = url;

    return new Promise((resolve, reject) => {
      console.log(`[MCPClient] Connecting to ${url}`);

      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('[MCPClient] Connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        resolve();
      };

      this.ws.onclose = () => {
        console.log('[MCPClient] Disconnected');
        this.isConnected = false;
        this.handleDisconnect();
      };

      this.ws.onerror = (event) => {
        console.error('[MCPClient] WebSocket error:', event);
        if (!this.isConnected) {
          reject(new Error('Failed to connect to MCP server'));
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

        if (notification.method === 'agent.event' && notification.params) {
          const event = notification.params as unknown as AgentEvent;
          this.dispatchEvent(event);
        }
      }
    } catch (error) {
      console.error('[MCPClient] Failed to parse message:', error);
    }
  }

  /**
   * Dispatch an agent event to handlers
   */
  private dispatchEvent(event: AgentEvent): void {
    // Session-specific handlers
    const handlers = this.eventHandlers.get(event.sessionId);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (error) {
          console.error('[MCPClient] Event handler error:', error);
        }
      }
    }

    // Global handlers
    for (const handler of this.globalEventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[MCPClient] Global event handler error:', error);
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
        `[MCPClient] Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`
      );

      setTimeout(() => {
        this.connect(this.url).catch((error) => {
          console.error('[MCPClient] Reconnect failed:', error);
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
      throw new Error('Not connected to MCP server');
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

  /**
   * Call an MCP tool
   */
  private async callTool<T>(
    name: string,
    args: Record<string, unknown>
  ): Promise<T> {
    const result = (await this.sendRequest<{
      content: Array<{ type: string; text: string }>;
    }>('tools/call', { name, arguments: args })) as {
      content: Array<{ type: string; text: string }>;
    };

    // Parse the JSON response from the tool
    const textContent = result.content?.find((c) => c.type === 'text');
    if (textContent) {
      return JSON.parse(textContent.text) as T;
    }

    throw new Error('Invalid tool response');
  }

  /**
   * Start a new agent session
   * @param options Agent configuration
   * @returns Session ID and status
   */
  async startAgent(options: StartAgentOptions): Promise<StartAgentResult> {
    console.log('[MCPClient] Starting agent:', options);

    return this.callTool<StartAgentResult>('agent.start', {
      projectPath: options.projectPath,
      prompt: options.prompt,
      model: options.model || 'haiku',
      resume: options.resume,
    });
  }

  /**
   * Send a message to a running agent
   * @param sessionId Session to send to
   * @param message Message content
   */
  async sendMessage(
    sessionId: string,
    message: string
  ): Promise<{ success: boolean; error?: string }> {
    console.log(`[MCPClient] Sending message to ${sessionId}`);

    return this.callTool<{ success: boolean; error?: string }>(
      'agent.message',
      {
        sessionId,
        message,
      }
    );
  }

  /**
   * Subscribe to agent events for a specific session
   * @param sessionId Session to subscribe to
   * @param handler Event handler function
   * @returns Unsubscribe function
   */
  onAgentEvent(sessionId: string, handler: AgentEventHandler): () => void {
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
   * Subscribe to all agent events
   * @param handler Event handler function
   * @returns Unsubscribe function
   */
  onAllAgentEvents(handler: AgentEventHandler): () => void {
    this.globalEventHandlers.add(handler);

    return () => {
      this.globalEventHandlers.delete(handler);
    };
  }

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
    console.log('[MCPClient] Disconnected');
  }
}

// Singleton instance
export const mcpClient = new MCPClient();

// Export class for custom instances
export { MCPClient };
