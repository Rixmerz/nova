/**
 * Projects Service for Nova Core
 *
 * Handles reading projects and sessions from ~/.claude/projects
 */

import { readdir, stat, readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Project interface
 */
export interface Project {
  id: string;
  name: string;
  path: string;
  lastModified: string;
  sessionCount: number;
}

/**
 * Session interface
 */
export interface Session {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/**
 * Get the Claude projects directory
 */
function getProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

/**
 * Decode project path from directory name
 * Claude encodes paths like: -Users-juanpablodiaz-my_projects-opcode
 * The encoding replaces / with - but preserves underscores
 */
function decodeProjectPath(dirName: string): string {
  // The directory name format is: -Users-user-path-to-project
  // This corresponds to: /Users/user/path/to/project
  // We need to replace dashes with slashes, but only those that were originally slashes
  // The trick is that underscores in the original path are preserved as underscores

  // Replace leading dash with /
  let path = dirName.replace(/^-/, '/');

  // Replace remaining dashes with /
  path = path.replace(/-/g, '/');

  return path;
}

/**
 * Get project name from path
 */
function getProjectName(projectPath: string): string {
  const parts = projectPath.split('/').filter(Boolean);
  return parts[parts.length - 1] || projectPath;
}

/**
 * Count JSONL files in a directory
 */
async function countJsonlFiles(dirPath: string): Promise<number> {
  try {
    const entries = await readdir(dirPath);
    return entries.filter((f) => f.endsWith('.jsonl')).length;
  } catch {
    return 0;
  }
}

/**
 * Count messages in a JSONL file
 */
async function countMessages(filePath: string): Promise<number> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return content.split('\n').filter((line) => line.trim()).length;
  } catch {
    return 0;
  }
}

/**
 * List all projects in ~/.claude/projects
 */
export async function listProjects(): Promise<Project[]> {
  const projectsDir = getProjectsDir();
  const projects: Project[] = [];

  try {
    const entries = await readdir(projectsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const projectDirPath = join(projectsDir, entry.name);
      const projectPath = decodeProjectPath(entry.name);

      try {
        const stats = await stat(projectDirPath);
        const sessionCount = await countJsonlFiles(projectDirPath);

        projects.push({
          id: entry.name,
          name: getProjectName(projectPath),
          path: projectPath,
          lastModified: stats.mtime.toISOString(),
          sessionCount,
        });
      } catch (error) {
        console.error(`[Projects] Error reading project ${entry.name}:`, error);
      }
    }

    // Sort by last modified, newest first
    projects.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

    return projects;
  } catch (error) {
    console.error('[Projects] Error listing projects:', error);
    return [];
  }
}

/**
 * Get sessions for a specific project
 */
export async function getProjectSessions(projectId: string): Promise<Session[]> {
  const projectDir = join(getProjectsDir(), projectId);
  const sessions: Session[] = [];

  try {
    const entries = await readdir(projectDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;

      const sessionId = entry.name.replace('.jsonl', '');
      const filePath = join(projectDir, entry.name);

      try {
        const stats = await stat(filePath);
        const messageCount = await countMessages(filePath);

        // Try to get first message to extract session name/topic
        let sessionName = sessionId;
        try {
          const content = await readFile(filePath, 'utf-8');
          const firstLine = content.split('\n')[0];
          if (firstLine) {
            const parsed = JSON.parse(firstLine);
            // Try to extract a meaningful name from the first message
            if (parsed.message?.content) {
              const content = parsed.message.content;
              // Take first 50 chars as name
              sessionName = content.substring(0, 50).replace(/\n/g, ' ');
              if (content.length > 50) sessionName += '...';
            }
          }
        } catch {
          // Ignore parsing errors, use sessionId as name
        }

        sessions.push({
          id: sessionId,
          projectId,
          name: sessionName,
          createdAt: stats.birthtime.toISOString(),
          updatedAt: stats.mtime.toISOString(),
          messageCount,
        });
      } catch (error) {
        console.error(`[Projects] Error reading session ${entry.name}:`, error);
      }
    }

    // Sort by updated, newest first
    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return sessions;
  } catch (error) {
    console.error(`[Projects] Error listing sessions for ${projectId}:`, error);
    return [];
  }
}

/**
 * Get home directory
 */
export function getHomeDirectory(): string {
  return homedir();
}
