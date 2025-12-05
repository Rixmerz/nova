/**
 * API Adapter - Compatibility layer for Tauri vs Web vs MCP environments
 *
 * This module detects the runtime environment and provides a unified interface:
 * - Tauri invoke calls (for desktop app)
 * - MCP WebSocket calls (for MCP-enabled mode)
 * - REST API calls (for web/phone browser fallback)
 */

import { invoke } from "@tauri-apps/api/core";
import { mcpClient, type AgentEvent } from "./mcpClient";
import { novaClient, type SessionEvent } from "./novaClient";

// Extend Window interface for Tauri and MCP
declare global {
  interface Window {
    __TAURI__?: any;
    __TAURI_METADATA__?: any;
    __TAURI_INTERNALS__?: any;
    /** Enable MCP mode for agent execution */
    __MCP_ENABLED__?: boolean;
    /** MCP Server URL (default: ws://localhost:8080/mcp) */
    __MCP_SERVER_URL__?: string;
    /** Enable Nova mode for agent execution (new plugin architecture) */
    __NOVA_ENABLED__?: boolean;
    /** Nova Server URL (default: ws://localhost:8080/nova) */
    __NOVA_SERVER_URL__?: string;
  }
}

// Environment detection
let isTauriEnvironment: boolean | null = null;
let isMCPConnected = false;
let isNovaConnected = false;

/**
 * Environment types
 */
type Environment = 'tauri' | 'mcp' | 'nova' | 'web';

/**
 * Check if MCP mode is enabled
 */
function isMCPEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return !!window.__MCP_ENABLED__;
}

/**
 * Get MCP server URL
 */
function getMCPServerURL(): string {
  return window.__MCP_SERVER_URL__ || 'ws://localhost:8080/mcp';
}

/**
 * Check if Nova mode is enabled
 */
function isNovaEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return !!window.__NOVA_ENABLED__;
}

/**
 * Get Nova server URL
 */
function getNovaServerURL(): string {
  return window.__NOVA_SERVER_URL__ || 'ws://localhost:8080/nova';
}

/**
 * Detect if we're running in Tauri environment
 */
function detectEnvironment(): boolean {
  if (isTauriEnvironment !== null) {
    return isTauriEnvironment;
  }

  // Check if we're in a browser environment first
  if (typeof window === 'undefined') {
    isTauriEnvironment = false;
    return false;
  }

  // Check for Tauri-specific indicators
  const isTauri = !!(
    window.__TAURI__ ||
    window.__TAURI_METADATA__ ||
    window.__TAURI_INTERNALS__ ||
    // Check user agent for Tauri
    navigator.userAgent.includes('Tauri')
  );

  console.log('[detectEnvironment] isTauri:', isTauri, 'userAgent:', navigator.userAgent);

  isTauriEnvironment = isTauri;
  return isTauri;
}

/**
 * Get the current environment for routing
 */
function getEnvironment(): Environment {
  // Nova takes precedence (new plugin architecture)
  if (isNovaEnabled()) return 'nova';
  if (isMCPEnabled()) return 'mcp';
  if (detectEnvironment()) return 'tauri';
  return 'web';
}

/**
 * Connect to MCP server if not already connected
 */
async function ensureMCPConnection(): Promise<void> {
  if (isMCPConnected && mcpClient.connected) return;

  const url = getMCPServerURL();
  console.log(`[MCP] Connecting to ${url}...`);
  await mcpClient.connect(url);
  isMCPConnected = true;
  console.log('[MCP] Connected');
}

/**
 * Connect to Nova server if not already connected
 */
async function ensureNovaConnection(): Promise<void> {
  if (isNovaConnected && novaClient.connected) return;

  const url = getNovaServerURL();
  console.log(`[Nova] Connecting to ${url}...`);
  await novaClient.connect(url);
  isNovaConnected = true;
  console.log('[Nova] Connected');
}

/**
 * Handle Claude execution commands via MCP
 */
async function handleMCPStreamingCommand<T>(command: string, params?: any): Promise<T> {
  await ensureMCPConnection();

  const projectPath = params?.projectPath || params?.project_path || '';
  const prompt = params?.prompt || '';
  const model = params?.model || 'haiku';
  const sessionId = params?.sessionId || params?.session_id;

  console.log(`[MCP] Handling command: ${command}`, { projectPath, prompt, model, sessionId });

  // Determine session mode
  let resume: string | undefined;
  if (command === 'resume_claude_code' && sessionId && isValidUUID(sessionId)) {
    resume = sessionId;
  }

  // Start the agent
  const result = await mcpClient.startAgent({
    projectPath,
    prompt,
    model: model as 'haiku' | 'sonnet' | 'opus',
    resume,
  });

  if (result.status === 'error') {
    throw new Error(result.error || 'Failed to start agent');
  }

  console.log(`[MCP] Agent started with sessionId: ${result.sessionId}`);

  // Subscribe to agent events and forward them as DOM events for UI compatibility
  const unsubscribe = mcpClient.onAgentEvent(result.sessionId, (event: AgentEvent) => {
    console.log(`[MCP] Agent event:`, event);

    if (event.type === 'output') {
      // Forward as claude-output event for existing UI compatibility
      const customEvent = new CustomEvent('claude-output', {
        detail: event.data.message || { raw: event.data.raw },
      });
      window.dispatchEvent(customEvent);
    } else if (event.type === 'error') {
      console.error(`[MCP] Agent error:`, event.data.error);
    } else if (event.type === 'complete') {
      // Forward as claude-complete event
      const completeEvent = new CustomEvent('claude-complete', {
        detail: event.data.exitCode === 0,
      });
      window.dispatchEvent(completeEvent);
      unsubscribe();
    }
  });

  // Return session info for the UI
  return { sessionId: result.sessionId } as T;
}

/**
 * Handle Claude execution commands via Nova (new plugin architecture)
 */
async function handleNovaStreamingCommand<T>(command: string, params?: any): Promise<T> {
  await ensureNovaConnection();

  const projectPath = params?.projectPath || params?.project_path || '';
  const prompt = params?.prompt || '';
  const model = params?.model || 'sonnet'; // Nova defaults to sonnet
  const sessionId = params?.sessionId || params?.session_id;

  console.log(`[Nova] Handling command: ${command}`, { projectPath, prompt, model, sessionId });

  // Determine if we're resuming
  let resume: string | undefined;
  if (command === 'resume_claude_code' && sessionId && isValidUUID(sessionId)) {
    resume = sessionId;
  }

  // Invoke the agent via Nova
  const result = await novaClient.invoke({
    plugin: 'claude_cli',
    agent: model as string,
    projectPath,
    prompt,
    resume,
  });

  console.log(`[Nova] Agent invoked with sessionId: ${result.sessionId}`);

  // Subscribe to session events and forward them as DOM events for UI compatibility
  const unsubscribe = novaClient.onSessionEvent(result.sessionId, (event: SessionEvent) => {
    console.log(`[Nova] Session event:`, event);

    if (event.type === 'output') {
      // Forward as claude-output event for existing UI compatibility
      const customEvent = new CustomEvent('claude-output', {
        detail: event.data.message || { raw: event.data.raw },
      });
      window.dispatchEvent(customEvent);
    } else if (event.type === 'error') {
      console.error(`[Nova] Session error:`, event.data.error);
      const errorEvent = new CustomEvent('claude-error', {
        detail: event.data.error,
      });
      window.dispatchEvent(errorEvent);
    } else if (event.type === 'complete') {
      // Forward as claude-complete event
      const completeEvent = new CustomEvent('claude-complete', {
        detail: event.data.exitCode === 0,
      });
      window.dispatchEvent(completeEvent);
      unsubscribe();
    }
  });

  // Return session info for the UI
  return { sessionId: result.sessionId } as T;
}

/**
 * Response wrapper for REST API calls
 */
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Make a REST API call to our web server
 */
async function restApiCall<T>(endpoint: string, method: string, params?: any): Promise<T> {
  // First handle path parameters in the endpoint string
  let processedEndpoint = endpoint;
  console.log(`[REST API] Original endpoint: ${endpoint}, params:`, params);

  if (params) {
    Object.keys(params).forEach(key => {
      // Try different case variations for the placeholder
      const placeholders = [
        `{${key}}`,
        `{${key.charAt(0).toLowerCase() + key.slice(1)}}`,
        `{${key.charAt(0).toUpperCase() + key.slice(1)}}`
      ];

      placeholders.forEach(placeholder => {
        if (processedEndpoint.includes(placeholder)) {
          console.log(`[REST API] Replacing ${placeholder} with ${params[key]}`);
          processedEndpoint = processedEndpoint.replace(placeholder, encodeURIComponent(String(params[key])));
        }
      });
    });
  }

  console.log(`[REST API] Processed endpoint: ${processedEndpoint}`);

  const url = new URL(processedEndpoint, window.location.origin);

  // Add remaining params as query parameters for GET requests (if no placeholders remain)
  if (params && !processedEndpoint.includes('{')) {
    Object.keys(params).forEach(key => {
      // Only add as query param if it wasn't used as a path param
      if (!endpoint.includes(`{${key}}`) &&
        !endpoint.includes(`{${key.charAt(0).toLowerCase() + key.slice(1)}}`) &&
        !endpoint.includes(`{${key.charAt(0).toUpperCase() + key.slice(1)}}`) &&
        params[key] !== undefined &&
        params[key] !== null) {
        url.searchParams.append(key, String(params[key]));
      }
    });
  }

  try {
    // For POST requests, prepare the body
    let body = undefined;
    if (method !== 'GET' && params) {
      // Special handling for delete_sessions - convert to snake_case for backend
      if (processedEndpoint.includes('/delete-batch/')) {
        body = JSON.stringify({
          session_ids: params.sessionIds || params.session_ids,
        });
      } else {
        body = JSON.stringify(params);
      }
    }

    const response = await fetch(url.toString(), {
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result: ApiResponse<T> = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'API call failed');
    }

    return result.data as T;
  } catch (error) {
    console.error(`REST API call failed for ${endpoint}:`, error);
    throw error;
  }
}

/**
 * Check if a string is a valid UUID format
 */
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Transform legacy Claude commands to the new unified execute_claude format
 * Returns null if no transformation is needed
 */
function transformLegacyClaudeCommand(command: string, params?: any): { command: string; params: any } | null {
  // Map legacy streaming commands to execute_claude with ClaudeOptions
  if (command === 'execute_claude_code') {
    return {
      command: 'execute_claude',
      params: {
        projectPath: params?.projectPath || params?.project_path,
        options: {
          prompt: params?.prompt || '',
          sessionMode: 'new',
          model: params?.model,
          print: true,
          outputFormat: 'stream-json',
          verbose: true, // Required: --output-format=stream-json requires --verbose when using --print
        }
      }
    };
  }

  if (command === 'continue_claude_code') {
    return {
      command: 'execute_claude',
      params: {
        projectPath: params?.projectPath || params?.project_path,
        options: {
          prompt: params?.prompt || '',
          sessionMode: 'continue',
          model: params?.model,
          print: true,
          outputFormat: 'stream-json',
          verbose: true, // Required: --output-format=stream-json requires --verbose when using --print
        }
      }
    };
  }

  if (command === 'resume_claude_code') {
    const sessionId = params?.sessionId || params?.session_id;

    // If session ID is not a valid UUID, fallback to continue mode
    // Claude CLI requires proper UUID format for resume operations
    if (!sessionId || !isValidUUID(sessionId)) {
      console.warn(`[Tauri] Invalid session ID "${sessionId}", falling back to continue mode`);
      return {
        command: 'execute_claude',
        params: {
          projectPath: params?.projectPath || params?.project_path,
          options: {
            prompt: params?.prompt || '',
            sessionMode: 'continue', // Fallback to continue mode
            model: params?.model,
            print: true,
            outputFormat: 'stream-json',
            verbose: true,
          }
        }
      };
    }

    // Valid UUID - proceed with resume
    return {
      command: 'execute_claude',
      params: {
        projectPath: params?.projectPath || params?.project_path,
        options: {
          prompt: params?.prompt || '',
          // Serde expects: { "resume": { "session_id": "..." } } for enum variant with data
          // Note: The enum has #[serde(rename_all = "camelCase")] but struct fields inside variants are NOT affected
          sessionMode: { resume: { session_id: sessionId } },
          model: params?.model,
          print: true,
          outputFormat: 'stream-json',
          verbose: true, // Required: --output-format=stream-json requires --verbose when using --print
        }
      }
    };
  }

  return null;
}

/**
 * Commands that Nova can handle directly
 */
const novaHandledCommands = [
  // Streaming
  'execute_claude_code', 'continue_claude_code', 'resume_claude_code',
  // Projects & Sessions
  'list_projects', 'get_project_sessions', 'load_session_history',
  'delete_session', 'delete_sessions', 'create_project',
  // Running sessions (PTY)
  'list_running_sessions', 'list_running_claude_sessions',
  // Utils
  'get_home_directory',
];

/**
 * Handle Nova commands (non-streaming)
 */
async function handleNovaCommand<T>(command: string, params?: any): Promise<T> {
  await ensureNovaConnection();

  switch (command) {
    case 'list_projects': {
      const projects = await novaClient.listProjects();
      // Transform to match expected format from Rust backend
      return projects.map(p => ({
        id: p.id,
        name: p.name,
        path: p.path,
        last_modified: p.lastModified,
        session_count: p.sessionCount,
      })) as T;
    }

    case 'get_project_sessions': {
      const projectId = params?.projectId || params?.project_id;
      const sessions = await novaClient.getProjectSessions(projectId);
      // Transform to match expected format
      return sessions.map(s => ({
        id: s.id,
        project_id: s.projectId,
        name: s.name,
        created_at: s.createdAt,
        updated_at: s.updatedAt,
        message_count: s.messageCount,
      })) as T;
    }

    case 'load_session_history': {
      const sessionId = params?.sessionId || params?.session_id;
      const projectId = params?.projectId || params?.project_id;
      const messages = await novaClient.loadSessionHistory(sessionId, projectId);
      return messages as T;
    }

    case 'delete_session': {
      const sessionId = params?.sessionId || params?.session_id;
      const projectId = params?.projectId || params?.project_id;
      await novaClient.deleteSession(sessionId, projectId);
      return { success: true } as T;
    }

    case 'delete_sessions': {
      const sessionIds = params?.sessionIds || params?.session_ids;
      const projectId = params?.projectId || params?.project_id;
      const result = await novaClient.deleteSessions(sessionIds, projectId);
      return result as T;
    }

    case 'get_home_directory': {
      const homeDir = await novaClient.getHomeDirectory();
      return homeDir as T;
    }

    case 'list_running_sessions':
    case 'list_running_claude_sessions': {
      // Get running PTY sessions from Nova
      const sessions = await novaClient.listSessions();
      // Transform to match expected format from Rust backend
      return sessions.map(s => ({
        id: s.id,
        agent_id: s.agentId,
        plugin_id: s.pluginId,
        status: s.status,
        created_at: s.createdAt,
        project_path: s.projectPath,
      })) as T;
    }

    case 'create_project': {
      // Convert path to project ID (Claude's encoding: /Users/foo/bar → -Users-foo-bar)
      const path = params?.path || '';
      const projectId = path.replace(/\//g, '-');
      const name = path.split('/').filter(Boolean).pop() || path;

      // Return synthetic project info - Claude CLI will create the actual project
      // when a session is started in this directory
      return {
        id: projectId,
        name: name,
        path: path,
        last_modified: new Date().toISOString(),
        session_count: 0,
      } as T;
    }

    default:
      throw new Error(`Unknown Nova command: ${command}`);
  }
}

/**
 * Unified API adapter that works in Tauri, MCP, and web environments
 */
export async function apiCall<T>(command: string, params?: any): Promise<T> {
  const env = getEnvironment();

  // Transform legacy Claude commands for Tauri environment
  const legacyStreamingCommands = ['execute_claude_code', 'continue_claude_code', 'resume_claude_code'];

  // Nova mode - route supported commands to Nova server
  if (env === 'nova' && novaHandledCommands.includes(command)) {
    // Streaming commands
    if (legacyStreamingCommands.includes(command)) {
      console.log(`[Nova] Routing streaming command: ${command}`);
      return handleNovaStreamingCommand<T>(command, params);
    }
    // Non-streaming commands
    console.log(`[Nova] Routing command: ${command}`);
    return handleNovaCommand<T>(command, params);
  }

  // Nova mode - route streaming commands to Nova server (new plugin architecture)
  if (env === 'nova' && legacyStreamingCommands.includes(command)) {
    console.log(`[Nova] Routing streaming command: ${command}`);
    return handleNovaStreamingCommand<T>(command, params);
  }

  // MCP mode - route streaming commands to MCP server (legacy)
  if (env === 'mcp' && legacyStreamingCommands.includes(command)) {
    console.log(`[MCP] Routing streaming command: ${command}`);
    return handleMCPStreamingCommand<T>(command, params);
  }

  if (env === 'tauri') {
    // Tauri environment - try invoke
    let actualCommand = command;
    let actualParams = params;

    // Transform legacy commands to execute_claude
    const transformed = transformLegacyClaudeCommand(command, params);
    if (transformed) {
      actualCommand = transformed.command;
      actualParams = transformed.params;
      console.log(`[Tauri] Transformed ${command} -> ${actualCommand}`, actualParams);
    } else {
      console.log(`[Tauri] Calling: ${command}`, params);
    }

    try {
      return await invoke<T>(actualCommand, actualParams);
    } catch (error) {
      console.warn(`[Tauri] invoke failed, falling back to web mode:`, error);
      // Fall through to web mode
    }
  }

  // Web environment - use REST API
  console.log(`[Web] Calling: ${command}`, params);

  // Special handling for commands that use streaming/events
  if (legacyStreamingCommands.includes(command)) {
    return handleStreamingCommand<T>(command, params);
  }

  // Map Tauri commands to REST endpoints
  const endpoint = mapCommandToEndpoint(command, params);

  // Determine HTTP method
  let method = 'GET';
  if (command === 'delete_sessions') {
    method = 'POST';
  } else if (command.startsWith('create_') || command.startsWith('save_') || command.startsWith('update_') || command.startsWith('mcp_add') || command === 'open_new_session') {
    method = 'POST';
  }

  return await restApiCall<T>(endpoint, method, params);
}

/**
 * Map Tauri command names to REST API endpoints
 */
function mapCommandToEndpoint(command: string, _params?: any): string {
  const commandToEndpoint: Record<string, string> = {
    // Project and session commands
    'list_projects': '/api/projects',
    'get_project_sessions': '/api/projects/{projectId}/sessions',

    // Agent commands
    'list_agents': '/api/agents',
    'fetch_github_agents': '/api/agents/github',
    'fetch_github_agent_content': '/api/agents/github/content',
    'import_agent_from_github': '/api/agents/import/github',
    'create_agent': '/api/agents',
    'update_agent': '/api/agents/{id}',
    'delete_agent': '/api/agents/{id}',
    'get_agent': '/api/agents/{id}',
    'export_agent': '/api/agents/{id}/export',
    'import_agent': '/api/agents/import',
    'import_agent_from_file': '/api/agents/import/file',
    'execute_agent': '/api/agents/{agentId}/execute',
    'list_agent_runs': '/api/agents/runs',
    'get_agent_run': '/api/agents/runs/{id}',
    'get_agent_run_with_real_time_metrics': '/api/agents/runs/{id}/metrics',
    'list_running_sessions': '/api/sessions/running',
    'kill_agent_session': '/api/agents/sessions/{runId}/kill',
    'get_session_status': '/api/agents/sessions/{runId}/status',
    'cleanup_finished_processes': '/api/agents/sessions/cleanup',
    'get_session_output': '/api/agents/sessions/{runId}/output',
    'get_live_session_output': '/api/agents/sessions/{runId}/output/live',
    'stream_session_output': '/api/agents/sessions/{runId}/output/stream',
    'load_agent_session_history': '/api/agents/sessions/{sessionId}/history',

    // Usage commands
    'get_usage_stats': '/api/usage',
    'get_usage_by_date_range': '/api/usage/range',
    'get_session_stats': '/api/usage/sessions',
    'get_usage_details': '/api/usage/details',

    // Settings and configuration
    'get_claude_settings': '/api/settings/claude',
    'save_claude_settings': '/api/settings/claude',
    'get_system_prompt': '/api/settings/system-prompt',
    'save_system_prompt': '/api/settings/system-prompt',
    'check_claude_version': '/api/settings/claude/version',
    'find_claude_md_files': '/api/claude-md',
    'read_claude_md_file': '/api/claude-md/read',
    'save_claude_md_file': '/api/claude-md/save',

    // Session management
    'open_new_session': '/api/sessions/new',
    'delete_session': '/api/sessions/{sessionId}/delete/{projectId}',
    'delete_sessions': '/api/sessions/delete-batch/{projectId}',
    'load_session_history': '/api/sessions/{sessionId}/history/{projectId}',
    'list_running_claude_sessions': '/api/sessions/running',
    'execute_claude_code': '/api/sessions/execute',
    'continue_claude_code': '/api/sessions/continue',
    'resume_claude_code': '/api/sessions/resume',
    'cancel_claude_execution': '/api/sessions/{sessionId}/cancel',
    'get_claude_session_output': '/api/sessions/{sessionId}/output',

    // MCP commands
    'mcp_add': '/api/mcp/servers',
    'mcp_list': '/api/mcp/servers',
    'mcp_get': '/api/mcp/servers/{name}',
    'mcp_remove': '/api/mcp/servers/{name}',
    'mcp_add_json': '/api/mcp/servers/json',
    'mcp_add_from_claude_desktop': '/api/mcp/import/claude-desktop',
    'mcp_serve': '/api/mcp/serve',
    'mcp_test_connection': '/api/mcp/servers/{name}/test',
    'mcp_reset_project_choices': '/api/mcp/reset-choices',
    'mcp_get_server_status': '/api/mcp/status',
    'mcp_read_project_config': '/api/mcp/project-config',
    'mcp_save_project_config': '/api/mcp/project-config',

    // Binary and installation management
    'get_claude_binary_path': '/api/settings/claude/binary-path',
    'set_claude_binary_path': '/api/settings/claude/binary-path',
    'list_claude_installations': '/api/settings/claude/installations',

    // Storage commands
    'storage_list_tables': '/api/storage/tables',
    'storage_read_table': '/api/storage/tables/{tableName}',
    'storage_update_row': '/api/storage/tables/{tableName}/rows/{id}',
    'storage_delete_row': '/api/storage/tables/{tableName}/rows/{id}',
    'storage_insert_row': '/api/storage/tables/{tableName}/rows',
    'storage_execute_sql': '/api/storage/sql',
    'storage_reset_database': '/api/storage/reset',

    // Hooks configuration
    'get_hooks_config': '/api/hooks/config',
    'update_hooks_config': '/api/hooks/config',
    'validate_hook_command': '/api/hooks/validate',

    // Slash commands
    'slash_commands_list': '/api/slash-commands',
    'slash_command_get': '/api/slash-commands/{commandId}',
    'slash_command_save': '/api/slash-commands',
    'slash_command_delete': '/api/slash-commands/{commandId}',
  };

  const endpoint = commandToEndpoint[command];
  if (!endpoint) {
    console.warn(`Unknown command: ${command}, falling back to generic endpoint`);
    return `/api/unknown/${command}`;
  }

  return endpoint;
}

/**
 * Get environment info for debugging
 */
export function getEnvironmentInfo() {
  return {
    environment: getEnvironment(),
    isTauri: detectEnvironment(),
    isMCPEnabled: isMCPEnabled(),
    isMCPConnected: mcpClient.connected,
    mcpServerURL: getMCPServerURL(),
    isNovaEnabled: isNovaEnabled(),
    isNovaConnected: novaClient.connected,
    novaServerURL: getNovaServerURL(),
    userAgent: navigator.userAgent,
    location: window.location.href,
  };
}

/**
 * Enable MCP mode for agent execution
 * @param serverUrl - Optional MCP server URL (default: ws://localhost:8080/mcp)
 */
export function enableMCP(serverUrl?: string): void {
  window.__MCP_ENABLED__ = true;
  if (serverUrl) {
    window.__MCP_SERVER_URL__ = serverUrl;
  }
  console.log('[MCP] Mode enabled. Server:', getMCPServerURL());
}

/**
 * Disable MCP mode
 */
export function disableMCP(): void {
  window.__MCP_ENABLED__ = false;
  mcpClient.disconnect();
  isMCPConnected = false;
  console.log('[MCP] Mode disabled');
}

/**
 * Check if MCP is currently enabled and connected
 */
export function getMCPStatus(): { enabled: boolean; connected: boolean; url: string } {
  return {
    enabled: isMCPEnabled(),
    connected: mcpClient.connected,
    url: getMCPServerURL(),
  };
}

/**
 * Enable Nova mode for agent execution (new plugin architecture)
 * @param serverUrl - Optional Nova server URL (default: ws://localhost:8080/nova)
 */
export function enableNova(serverUrl?: string): void {
  // Disable MCP if it was enabled (Nova takes precedence)
  if (isMCPEnabled()) {
    disableMCP();
  }
  window.__NOVA_ENABLED__ = true;
  if (serverUrl) {
    window.__NOVA_SERVER_URL__ = serverUrl;
  }
  console.log('[Nova] Mode enabled. Server:', getNovaServerURL());
}

/**
 * Disable Nova mode
 */
export function disableNova(): void {
  window.__NOVA_ENABLED__ = false;
  novaClient.disconnect();
  isNovaConnected = false;
  console.log('[Nova] Mode disabled');
}

/**
 * Check if Nova is currently enabled and connected
 */
export function getNovaStatus(): { enabled: boolean; connected: boolean; url: string } {
  return {
    enabled: isNovaEnabled(),
    connected: novaClient.connected,
    url: getNovaServerURL(),
  };
}

/**
 * Handle streaming commands via WebSocket in web mode
 */
async function handleStreamingCommand<T>(command: string, params?: any): Promise<T> {
  return new Promise((resolve, reject) => {
    // Use wss:// for HTTPS connections (e.g., ngrok), ws:// for HTTP (localhost)
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/claude`;
    console.log(`[TRACE] handleStreamingCommand called:`);
    console.log(`[TRACE]   command: ${command}`);
    console.log(`[TRACE]   params:`, params);
    console.log(`[TRACE]   WebSocket URL: ${wsUrl}`);

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log(`[TRACE] WebSocket opened successfully`);

      // Send execution request
      const request = {
        command_type: command.replace('_claude_code', ''), // execute, continue, resume
        project_path: params?.projectPath || '',
        prompt: params?.prompt || '',
        model: params?.model || 'claude-3-5-sonnet-20241022',
        session_id: params?.sessionId,
      };

      console.log(`[TRACE] Sending WebSocket request:`, request);
      console.log(`[TRACE] Request JSON:`, JSON.stringify(request));

      ws.send(JSON.stringify(request));
      console.log(`[TRACE] WebSocket request sent`);
    };

    ws.onmessage = (event) => {
      console.log(`[TRACE] WebSocket message received:`, event.data);
      try {
        const message = JSON.parse(event.data);
        console.log(`[TRACE] Parsed WebSocket message:`, message);

        if (message.type === 'start') {
          console.log(`[TRACE] Start message: ${message.message}`);
        } else if (message.type === 'output') {
          console.log(`[TRACE] Output message, content length: ${message.content?.length || 0}`);
          console.log(`[TRACE] Raw content:`, message.content);

          // The backend sends Claude output as a JSON string in the content field
          // We need to parse this to get the actual Claude message
          try {
            const claudeMessage = typeof message.content === 'string'
              ? JSON.parse(message.content)
              : message.content;
            console.log(`[TRACE] Parsed Claude message:`, claudeMessage);

            // Simulate Tauri event for compatibility with existing UI
            const customEvent = new CustomEvent('claude-output', {
              detail: claudeMessage
            });
            console.log(`[TRACE] Dispatching claude-output event:`, customEvent.detail);
            console.log(`[TRACE] Event type:`, customEvent.type);
            window.dispatchEvent(customEvent);
          } catch (e) {
            console.error(`[TRACE] Failed to parse Claude output content:`, e);
            console.error(`[TRACE] Content that failed to parse:`, message.content);
          }
        } else if (message.type === 'completion') {
          console.log(`[TRACE] Completion message:`, message);

          // Dispatch claude-complete event for UI state management
          const completeEvent = new CustomEvent('claude-complete', {
            detail: message.status === 'success'
          });
          console.log(`[TRACE] Dispatching claude-complete event:`, completeEvent.detail);
          window.dispatchEvent(completeEvent);

          ws.close();
          if (message.status === 'success') {
            console.log(`[TRACE] Resolving promise with success`);
            resolve({} as T); // Return empty object for now
          } else {
            console.log(`[TRACE] Rejecting promise with error: ${message.error}`);
            reject(new Error(message.error || 'Execution failed'));
          }
        } else if (message.type === 'error') {
          console.log(`[TRACE] Error message:`, message);

          // Dispatch claude-error event for UI error handling
          const errorEvent = new CustomEvent('claude-error', {
            detail: message.message || 'Unknown error'
          });
          console.log(`[TRACE] Dispatching claude-error event:`, errorEvent.detail);
          window.dispatchEvent(errorEvent);

          reject(new Error(message.message || 'Unknown error'));
        } else {
          console.log(`[TRACE] Unknown message type: ${message.type}`);
        }
      } catch (e) {
        console.error('[TRACE] Failed to parse WebSocket message:', e);
        console.error('[TRACE] Raw message:', event.data);
      }
    };

    ws.onerror = (error) => {
      console.error('[TRACE] WebSocket error:', error);

      // Dispatch claude-error event for connection errors
      const errorEvent = new CustomEvent('claude-error', {
        detail: 'WebSocket connection failed'
      });
      console.log(`[TRACE] Dispatching claude-error event for WebSocket error`);
      window.dispatchEvent(errorEvent);

      reject(new Error('WebSocket connection failed'));
    };

    ws.onclose = (event) => {
      console.log(`[TRACE] WebSocket closed - code: ${event.code}, reason: ${event.reason}`);

      // If connection closed unexpectedly (not a normal close), dispatch cancelled event
      if (event.code !== 1000 && event.code !== 1001) {
        const cancelEvent = new CustomEvent('claude-complete', {
          detail: false // false indicates cancellation/failure
        });
        console.log(`[TRACE] Dispatching claude-complete event for unexpected close`);
        window.dispatchEvent(cancelEvent);
      }
    };
  });
}

/**
 * Initialize web mode compatibility
 * Sets up mocks for Tauri APIs when running in web mode
 */
export function initializeWebMode() {
  if (!detectEnvironment()) {
    // Mock Tauri event system for web mode
    if (!window.__TAURI__) {
      window.__TAURI__ = {
        event: {
          listen: (eventName: string, callback: (event: any) => void) => {
            // Listen for custom events that simulate Tauri events
            const handler = (e: any) => callback({ payload: e.detail });
            window.addEventListener(`${eventName}`, handler);
            return Promise.resolve(() => {
              window.removeEventListener(`${eventName}`, handler);
            });
          },
          emit: () => Promise.resolve(),
        },
        invoke: () => Promise.reject(new Error('Tauri invoke not available in web mode')),
        // Mock the core module that includes transformCallback
        core: {
          invoke: () => Promise.reject(new Error('Tauri invoke not available in web mode')),
          transformCallback: () => {
            throw new Error('Tauri transformCallback not available in web mode');
          }
        }
      };
    }
  }
}

/**
 * Auto-detect and connect to Nova server if available
 * This checks if Nova is running and automatically enables Nova mode
 */
export async function autoDetectNova(serverUrl?: string): Promise<boolean> {
  const url = serverUrl || 'http://localhost:8080';

  try {
    console.log(`[Nova] Checking for Nova server at ${url}...`);

    // Try to fetch the health endpoint
    const response = await fetch(`${url}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000), // 2 second timeout
    });

    if (response.ok) {
      const health = await response.json();
      if (health.status === 'ok') {
        console.log(`[Nova] Server detected! Plugins: ${health.plugins}, Sessions: ${health.sessions}`);

        // Enable Nova mode
        enableNova(url.replace('http', 'ws') + '/nova');

        return true;
      }
    }
  } catch (error) {
    // Server not available - this is expected if Nova isn't running
    console.log('[Nova] Server not available, using Tauri backend');
  }

  return false;
}

/**
 * Initialize the application with automatic backend detection
 * Priority: Nova > Tauri > Web
 */
export async function initializeApp(): Promise<'nova' | 'tauri' | 'web'> {
  // First, set up web mode compatibility
  initializeWebMode();

  // If we're in Tauri, check if Nova is also available (for hybrid mode)
  // If Nova is available, prefer it over Tauri backend
  const novaAvailable = await autoDetectNova();

  if (novaAvailable) {
    console.log('[App] Initialized with Nova backend');
    return 'nova';
  }

  if (detectEnvironment()) {
    console.log('[App] Initialized with Tauri backend');
    return 'tauri';
  }

  console.log('[App] Initialized in web mode');
  return 'web';
}