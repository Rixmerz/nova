import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, MessageSquare, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { ClaudeMemoriesDropdown } from "@/components/ClaudeMemoriesDropdown";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { truncateText, getFirstLine } from "@/lib/date-utils";
import { useSessionStore } from "@/stores/sessionStore";
import type { Session, ClaudeMdFile } from "@/lib/api";

/**
 * Generate a meaningful title from the session's first message
 */
function generateSessionTitle(session: Session): string {
  if (session.first_message) {
    // Remove code blocks and clean up the text
    const cleanText = session.first_message
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/[^\w\s\u00C0-\u024F]/g, ' ') // Keep letters, numbers, spaces, and accented chars
      .split(/\s+/)
      .filter(w => w.length > 2)
      .slice(0, 6)
      .join(' ')
      .trim();

    if (cleanText.length > 3) {
      return cleanText.length > 45 ? cleanText.substring(0, 45) + '...' : cleanText;
    }
  }

  // Fallback to date
  const date = session.message_timestamp
    ? new Date(session.message_timestamp)
    : new Date(session.created_at * 1000);

  return `Session on ${date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })}`;
}

interface SessionListProps {
  /**
   * Array of sessions to display
   */
  sessions: Session[];
  /**
   * The current project path being viewed
   */
  projectPath: string;
  /**
   * Optional callback to go back to project list (deprecated - use tabs instead)
   */
  onBack?: () => void;
  /**
   * Callback when a session is clicked
   */
  onSessionClick?: (session: Session) => void;
  /**
   * Callback when a CLAUDE.md file should be edited
   */
  onEditClaudeFile?: (file: ClaudeMdFile) => void;
  /**
   * Optional className for styling
   */
  className?: string;
}

const ITEMS_PER_PAGE = 12;

/**
 * SessionList component - Displays paginated sessions for a specific project
 * 
 * @example
 * <SessionList
 *   sessions={sessions}
 *   projectPath="/Users/example/project"
 *   onBack={() => setSelectedProject(null)}
 *   onSessionClick={(session) => console.log('Selected session:', session)}
 * />
 */
export const SessionList: React.FC<SessionListProps> = ({
  sessions,
  projectPath,
  onSessionClick,
  onEditClaudeFile,
  className,
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const { deleteSession } = useSessionStore();

  // Handle session deletion
  const handleDeleteSession = async (e: React.MouseEvent, session: Session) => {
    e.stopPropagation(); // Prevent card click

    if (confirmDelete === session.id) {
      // Second click - confirm deletion
      setDeletingSessionId(session.id);
      try {
        await deleteSession(session.id, session.project_id);
      } catch (error) {
        console.error('Failed to delete session:', error);
      } finally {
        setDeletingSessionId(null);
        setConfirmDelete(null);
      }
    } else {
      // First click - show confirmation
      setConfirmDelete(session.id);
      // Reset confirmation after 3 seconds
      setTimeout(() => setConfirmDelete(null), 3000);
    }
  };
  
  // Calculate pagination
  const totalPages = Math.ceil(sessions.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentSessions = sessions.slice(startIndex, endIndex);
  
  // Reset to page 1 if sessions change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [sessions.length]);
  
  return (
    <TooltipProvider>
      <div className={cn("space-y-4", className)}>
      {/* CLAUDE.md Memories Dropdown */}
      {onEditClaudeFile && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <ClaudeMemoriesDropdown
            projectPath={projectPath}
            onEditFile={onEditClaudeFile}
          />
        </motion.div>
      )}

      <AnimatePresence mode="popLayout">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {currentSessions.map((session, index) => (
            <motion.div
              key={session.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{
                duration: 0.3,
                delay: index * 0.05,
                ease: [0.4, 0, 0.2, 1],
              }}
            >
              <Card
                className={cn(
                  "p-3 hover:bg-accent/50 transition-all duration-200 cursor-pointer group h-full",
                  session.todo_data && "bg-primary/5"
                )}
                onClick={() => {
                  // Emit a special event for Claude Code session navigation
                  const event = new CustomEvent('claude-session-selected', { 
                    detail: { session, projectPath } 
                  });
                  window.dispatchEvent(event);
                  onSessionClick?.(session);
                }}
              >
                <div className="flex flex-col h-full">
                  <div className="flex-1">
                    {/* Session header */}
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-start gap-1.5 flex-1 min-w-0">
                        <Clock className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-body-small font-medium line-clamp-1">
                            {generateSessionTitle(session)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {session.todo_data && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-caption font-medium bg-primary/10 text-primary">
                            Todo
                          </span>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={(e) => handleDeleteSession(e, session)}
                              disabled={deletingSessionId === session.id}
                              className={cn(
                                "p-1 rounded-md opacity-0 group-hover:opacity-100 transition-all duration-200",
                                confirmDelete === session.id
                                  ? "bg-destructive/20 text-destructive opacity-100"
                                  : "hover:bg-muted text-muted-foreground hover:text-foreground",
                                deletingSessionId === session.id && "opacity-50 cursor-not-allowed"
                              )}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            {confirmDelete === session.id ? "Click again to confirm" : "Delete session"}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                    
                    {/* First message preview */}
                    {session.first_message ? (
                      <p className="text-caption text-muted-foreground line-clamp-2 mb-2">
                        {truncateText(getFirstLine(session.first_message), 120)}
                      </p>
                    ) : (
                      <p className="text-caption text-muted-foreground/60 italic mb-2">
                        No messages yet
                      </p>
                    )}
                  </div>
                  
                  {/* Metadata footer */}
                  <div className="flex items-center justify-between pt-2 border-t">
                    <p className="text-caption text-muted-foreground font-mono">
                      {session.id.slice(-8)}
                    </p>
                    {session.todo_data && (
                      <MessageSquare className="h-3 w-3 text-primary" />
                    )}
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </AnimatePresence>
      
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      </div>
    </TooltipProvider>
  );
}; 