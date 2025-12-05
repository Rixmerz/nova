/**
 * Sessions Service for Nova Core
 *
 * Handles session history loading and deletion
 */

import { readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Message from session history
 */
export interface SessionMessage {
  type: string;
  message?: {
    role: string;
    content: string;
  };
  timestamp?: string;
  [key: string]: unknown;
}

/**
 * Get the Claude projects directory
 */
function getProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

/**
 * Get session file path
 */
function getSessionPath(sessionId: string, projectId: string): string {
  return join(getProjectsDir(), projectId, `${sessionId}.jsonl`);
}

/**
 * Load session history from JSONL file
 */
export async function loadSessionHistory(
  sessionId: string,
  projectId: string
): Promise<SessionMessage[]> {
  const filePath = getSessionPath(sessionId, projectId);

  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim());

    const messages: SessionMessage[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        messages.push(parsed);
      } catch (error) {
        console.error(`[Sessions] Error parsing line in ${sessionId}:`, error);
      }
    }

    return messages;
  } catch (error) {
    console.error(`[Sessions] Error loading session ${sessionId}:`, error);
    throw new Error(`Session '${sessionId}' not found or cannot be read`);
  }
}

/**
 * Delete a single session
 */
export async function deleteSession(sessionId: string, projectId: string): Promise<void> {
  const filePath = getSessionPath(sessionId, projectId);

  try {
    await unlink(filePath);
    console.log(`[Sessions] Deleted session: ${sessionId}`);
  } catch (error) {
    console.error(`[Sessions] Error deleting session ${sessionId}:`, error);
    throw new Error(`Failed to delete session '${sessionId}'`);
  }
}

/**
 * Delete multiple sessions
 */
export async function deleteSessions(sessionIds: string[], projectId: string): Promise<{
  deleted: string[];
  failed: string[];
}> {
  const deleted: string[] = [];
  const failed: string[] = [];

  for (const sessionId of sessionIds) {
    try {
      await deleteSession(sessionId, projectId);
      deleted.push(sessionId);
    } catch {
      failed.push(sessionId);
    }
  }

  console.log(`[Sessions] Bulk delete: ${deleted.length} deleted, ${failed.length} failed`);

  return { deleted, failed };
}
