import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, MessageSquare, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { ClaudeMemoriesDropdown } from "@/components/ClaudeMemoriesDropdown";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
  const [isDeletingBatch, setIsDeletingBatch] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  const { deleteSession, deleteSessions } = useSessionStore();

  // Toggle selection of a single session
  const toggleSelectSession = (e: React.SyntheticEvent, sessionId: string) => {
    e.stopPropagation();
    const newSelected = new Set(selectedSessions);
    if (newSelected.has(sessionId)) {
      newSelected.delete(sessionId);
    } else {
      newSelected.add(sessionId);
    }
    setSelectedSessions(newSelected);
  };

  // Toggle selection of all sessions on current page
  const toggleSelectAll = () => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const currentSessions = sessions.slice(startIndex, endIndex);

    const allSelected = currentSessions.every(s => selectedSessions.has(s.id));

    const newSelected = new Set(selectedSessions);
    if (allSelected) {
      currentSessions.forEach(s => newSelected.delete(s.id));
    } else {
      currentSessions.forEach(s => newSelected.add(s.id));
    }
    setSelectedSessions(newSelected);
  };

  // Open delete confirmation modal
  const handleDeleteClick = (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    setSessionToDelete(session);
  };

  // Confirm and execute deletion (single or bulk)
  const handleConfirmDelete = async () => {
    if (sessionToDelete) {
      // Single deletion
      setDeletingSessionId(sessionToDelete.id);
      try {
        await deleteSession(sessionToDelete.id, sessionToDelete.project_id);
        // Remove from selection if it was selected
        if (selectedSessions.has(sessionToDelete.id)) {
          const newSelected = new Set(selectedSessions);
          newSelected.delete(sessionToDelete.id);
          setSelectedSessions(newSelected);
        }
      } catch (error) {
        console.error('Failed to delete session:', error);
      } finally {
        setDeletingSessionId(null);
        setSessionToDelete(null);
      }
    } else if (showBulkDeleteConfirm && selectedSessions.size > 0) {
      // Bulk deletion
      setIsDeletingBatch(true);
      try {
        // Get project ID from the first selected session (assuming all are from same project)
        // In this component, projectPath is passed, but we need projectId.
        // We can find it from one of the sessions.
        const firstSessionId = Array.from(selectedSessions)[0];
        const session = sessions.find(s => s.id === firstSessionId);

        if (session) {
          await deleteSessions(Array.from(selectedSessions), session.project_id);
          setSelectedSessions(new Set());
        }
      } catch (error) {
        console.error('Failed to delete sessions:', error);
      } finally {
        setIsDeletingBatch(false);
        setShowBulkDeleteConfirm(false);
      }
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
            className="flex justify-between items-center"
          >
            <div className="flex items-center gap-4">
              <ClaudeMemoriesDropdown
                projectPath={projectPath}
                onEditFile={onEditClaudeFile}
              />

              {/* Bulk Actions */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-secondary/30 border border-border/50">
                  <input
                    type="checkbox"
                    checked={currentSessions.length > 0 && currentSessions.every(s => selectedSessions.has(s.id))}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-primary text-primary focus:ring-primary/50 cursor-pointer"
                  />
                  <span className="text-sm text-muted-foreground">Select Page</span>
                </div>

                <AnimatePresence>
                  {selectedSessions.size > 0 && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, x: -10 }}
                      animate={{ opacity: 1, scale: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.95, x: -10 }}
                    >
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setShowBulkDeleteConfirm(true)}
                        className="gap-2"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete Selected ({selectedSessions.size})
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
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
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          {/* Selection Checkbox */}
                          <div
                            className="pt-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={selectedSessions.has(session.id)}
                              onChange={(e) => toggleSelectSession(e, session.id)}
                              className="h-4 w-4 rounded border-primary text-primary focus:ring-primary/50 cursor-pointer"
                            />
                          </div>

                          <div className="flex items-start gap-1.5 flex-1 min-w-0">
                            <Clock className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="text-body-small font-medium line-clamp-1">
                                {generateSessionTitle(session)}
                              </p>
                            </div>
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
                                onClick={(e) => handleDeleteClick(e, session)}
                                disabled={deletingSessionId === session.id}
                                className={cn(
                                  "p-1 rounded-md opacity-0 group-hover:opacity-100 transition-all duration-200",
                                  "hover:bg-destructive/20 hover:text-destructive text-muted-foreground",
                                  deletingSessionId === session.id && "opacity-50 cursor-not-allowed"
                                )}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              Delete session
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

      {/* Delete Confirmation Modal */}
      <Dialog
        open={sessionToDelete !== null || showBulkDeleteConfirm}
        onOpenChange={(open) => {
          if (!open) {
            setSessionToDelete(null);
            setShowBulkDeleteConfirm(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {showBulkDeleteConfirm
                ? `Delete ${selectedSessions.size} Sessions`
                : "Delete Session"}
            </DialogTitle>
            <DialogDescription>
              {showBulkDeleteConfirm
                ? `Are you sure you want to delete ${selectedSessions.size} sessions? This action cannot be undone.`
                : "Are you sure you want to delete this session? This action cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          {sessionToDelete && (
            <div className="py-4">
              <p className="text-sm text-muted-foreground">
                Session: <span className="font-mono text-foreground">{sessionToDelete.id.slice(-8)}</span>
              </p>
              {sessionToDelete.first_message && (
                <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                  {truncateText(getFirstLine(sessionToDelete.first_message), 100)}
                </p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setSessionToDelete(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deletingSessionId !== null}
            >
              {deletingSessionId || isDeletingBatch ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}; 