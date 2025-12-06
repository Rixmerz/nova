/**
 * Interactive Prompt Dialog
 *
 * Displays interactive prompts from Claude CLI and allows user to respond.
 * Used for bypass confirmations, tool approvals, file edits, etc.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ShieldAlert, Terminal, FileEdit, List } from 'lucide-react';

/**
 * Interactive prompt from Claude CLI
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

interface InteractivePromptDialogProps {
  prompt: InteractivePrompt | null;
  sessionId: string | null;
  onRespond: (sessionId: string, response: string) => void;
  onClose?: () => void;
}

/**
 * Get icon based on prompt type
 */
function getPromptIcon(type: InteractivePrompt['type']) {
  switch (type) {
    case 'bypass-confirm':
      return <ShieldAlert className="h-6 w-6 text-yellow-500" />;
    case 'tool-approval':
      return <Terminal className="h-6 w-6 text-blue-500" />;
    case 'file-edit':
      return <FileEdit className="h-6 w-6 text-green-500" />;
    case 'selection':
      return <List className="h-6 w-6 text-purple-500" />;
    default:
      return <Terminal className="h-6 w-6 text-muted-foreground" />;
  }
}

/**
 * Get button variant based on option
 */
function getButtonVariant(option: InteractivePrompt['options'][0], promptType: InteractivePrompt['type']) {
  if (option.isDefault) {
    // Default action varies by prompt type
    if (promptType === 'bypass-confirm') {
      return 'default'; // Accept is default but not destructive
    }
    return 'default';
  }
  return 'outline';
}

export function InteractivePromptDialog({
  prompt,
  sessionId,
  onRespond,
  onClose,
}: InteractivePromptDialogProps) {
  if (!prompt || !sessionId) return null;

  const handleResponse = (key: string) => {
    onRespond(sessionId, key);
    onClose?.();
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose?.()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {getPromptIcon(prompt.type)}
            <DialogTitle>{prompt.title}</DialogTitle>
          </div>
          {prompt.description && (
            <DialogDescription className="pt-2">
              {prompt.description}
            </DialogDescription>
          )}
        </DialogHeader>

        <DialogFooter className="flex-row gap-2 sm:justify-end">
          {prompt.options.map((option) => (
            <Button
              key={option.key}
              variant={getButtonVariant(option, prompt.type)}
              onClick={() => handleResponse(option.key)}
              className="flex-1 sm:flex-none"
            >
              {option.label}
            </Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
