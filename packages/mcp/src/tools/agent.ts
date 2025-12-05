/**
 * MCP Tools for Agent Management
 *
 * This module defines the MCP tools that the frontend uses to control Claude agents:
 *
 * - agent.start: Spawns a new Claude Code process or resumes an existing session
 * - agent.message: Sends a message to a running agent's stdin
 *
 * These tools follow the MCP protocol and are registered with the MCP server.
 */

import { z } from 'zod';
import { spawnClaude, SpawnOptions } from '../process/spawner.js';
import { sessionRegistry } from '../registry/session.js';

/**
 * Input schema for agent.start tool
 */
export const AgentStartInputSchema = z.object({
  /** Absolute path to the project directory where Claude will run */
  projectPath: z.string().describe('Absolute path to project directory'),

  /** The prompt or task to send to Claude */
  prompt: z.string().describe('Initial prompt or follow-up message'),

  /** Model to use: haiku (default), sonnet, or opus */
  model: z
    .enum(['haiku', 'sonnet', 'opus'])
    .default('haiku')
    .describe('Model to use for this session'),

  /** Optional session ID to resume an existing session */
  resume: z
    .string()
    .optional()
    .describe('Session ID to resume (omit for new session)'),
});

export type AgentStartInput = z.infer<typeof AgentStartInputSchema>;

/**
 * Output schema for agent.start tool
 */
export const AgentStartOutputSchema = z.object({
  /** The session ID for this agent instance */
  sessionId: z.string(),

  /** Status of the operation */
  status: z.enum(['started', 'error']),

  /** Error message if status is 'error' */
  error: z.string().optional(),
});

export type AgentStartOutput = z.infer<typeof AgentStartOutputSchema>;

/**
 * Input schema for agent.message tool
 */
export const AgentMessageInputSchema = z.object({
  /** Session ID of the running agent */
  sessionId: z.string().describe('Session ID of the running agent'),

  /** Message to send to the agent */
  message: z.string().describe('Message content to send'),
});

export type AgentMessageInput = z.infer<typeof AgentMessageInputSchema>;

/**
 * Output schema for agent.message tool
 */
export const AgentMessageOutputSchema = z.object({
  /** Whether the message was sent successfully */
  success: z.boolean(),

  /** Error message if success is false */
  error: z.string().optional(),
});

export type AgentMessageOutput = z.infer<typeof AgentMessageOutputSchema>;

/**
 * Handler for the agent.start tool
 *
 * Spawns a Claude Code process with the given configuration.
 * The process runs in the specified project directory and
 * outputs streaming JSON that gets forwarded via notifications.
 */
export async function handleAgentStart(
  input: AgentStartInput
): Promise<AgentStartOutput> {
  console.log(`[Tools] agent.start called with:`, {
    projectPath: input.projectPath,
    prompt: input.prompt.substring(0, 50) + '...',
    model: input.model,
    resume: input.resume,
  });

  try {
    // Build spawn options
    const options: SpawnOptions = {
      projectPath: input.projectPath,
      prompt: input.prompt,
      model: input.model,
      resume: input.resume,
    };

    // Spawn the Claude process
    const result = await spawnClaude(options);

    console.log(`[Tools] Agent started successfully: ${result.sessionId}`);

    return {
      sessionId: result.sessionId,
      status: 'started',
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Tools] agent.start failed:`, errorMessage);

    return {
      sessionId: '',
      status: 'error',
      error: errorMessage,
    };
  }
}

/**
 * Handler for the agent.message tool
 *
 * Sends a message to a running agent's stdin.
 * This is used for follow-up prompts in an interactive session.
 */
export async function handleAgentMessage(
  input: AgentMessageInput
): Promise<AgentMessageOutput> {
  console.log(
    `[Tools] agent.message called for session: ${input.sessionId}`
  );

  // Check if session exists
  if (!sessionRegistry.has(input.sessionId)) {
    console.warn(`[Tools] Session not found: ${input.sessionId}`);
    return {
      success: false,
      error: `Session not found: ${input.sessionId}`,
    };
  }

  // Send message to the session
  const success = sessionRegistry.sendMessage(
    input.sessionId,
    input.message
  );

  if (!success) {
    return {
      success: false,
      error: 'Failed to send message to agent',
    };
  }

  console.log(`[Tools] Message sent to session: ${input.sessionId}`);

  return {
    success: true,
  };
}

/**
 * Tool definitions for MCP server registration
 */
export const agentTools = {
  'agent.start': {
    name: 'agent.start',
    description:
      'Start a new Claude Code agent session or resume an existing one. Returns a sessionId that can be used to send messages and receive output notifications.',
    inputSchema: AgentStartInputSchema,
    handler: handleAgentStart,
  },
  'agent.message': {
    name: 'agent.message',
    description:
      'Send a message to a running Claude Code agent session. The message is written to the agent stdin.',
    inputSchema: AgentMessageInputSchema,
    handler: handleAgentMessage,
  },
};
