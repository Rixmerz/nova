/**
 * Session Interface
 *
 * Represents an active session with an agent.
 * Sessions are created when invoking an agent and track the interaction lifecycle.
 */

/**
 * Session status
 */
export type SessionStatus = 'starting' | 'running' | 'completed' | 'error' | 'stopped' | 'waiting-for-input';

/**
 * Session event types
 */
export type SessionEventType = 'output' | 'error' | 'complete' | 'status' | 'interactive-prompt';

/**
 * Interactive prompt from agent (e.g., bypass confirmation, tool approval)
 */
export interface InteractivePrompt {
  type: 'bypass-confirm' | 'tool-approval' | 'file-edit' | 'selection';
  title: string;
  description?: string;
  options: Array<{
    key: string;
    label: string;
    isDefault?: boolean;
  }>;
}

/**
 * Session event payload
 */
export interface SessionEvent {
  /** Session ID this event belongs to */
  sessionId: string;

  /** Event type */
  type: SessionEventType;

  /** Event data */
  data: {
    /** Parsed message from agent (for output events) */
    message?: Record<string, unknown>;

    /** Raw output (if not parseable as JSON) */
    raw?: string;

    /** Error message (for error events) */
    error?: string;

    /** Exit code (for complete events) */
    exitCode?: number | null;

    /** New status (for status events) */
    status?: SessionStatus;

    /** Interactive prompt (for interactive-prompt events) */
    prompt?: InteractivePrompt;
  };

  /** ISO timestamp of the event */
  timestamp: string;
}

/**
 * Stream callback for receiving session events
 */
export type StreamCallback = (event: SessionEvent) => void;

/**
 * Session instance
 */
export interface ISession {
  /** Unique session identifier (Nova's internal ID) */
  id: string;

  /** Agent ID being used */
  agentId: string;

  /** Plugin ID that created this session */
  pluginId: string;

  /** Current session status */
  status: SessionStatus;

  /** When the session was created */
  createdAt: Date;

  /** Project path for this session */
  projectPath: string;

  /** Optional session to resume from */
  resumeSessionId?: string;

  /** Claude CLI session UUID (used for resume operations) */
  claudeSessionId?: string;
}

/**
 * Options for invoking an agent
 */
export interface InvokeOptions {
  /** Absolute path to the project directory */
  projectPath: string;

  /** Initial prompt or message */
  prompt: string;

  /** Session ID to resume (optional) */
  resume?: string;

  /** Bypass mode - auto-accept interactive prompts */
  bypassMode?: boolean;

  /** Additional options for the agent */
  options?: Record<string, unknown>;
}

/**
 * Result from sending a message to a session
 */
export interface MessageResult {
  /** Whether the message was sent successfully */
  success: boolean;

  /** Error message if failed */
  error?: string;
}
