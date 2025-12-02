//! tmux session management for debug mode
//!
//! Creates and manages a tmux session with a named pipe for real-time
//! debug output streaming.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;

/// Manages a tmux session for debug output
pub struct TmuxSession {
    session_name: String,
    pipe_path: PathBuf,
}

impl TmuxSession {
    /// Create a new tmux session with a named pipe for output
    ///
    /// # Arguments
    /// * `name` - Name of the tmux session (e.g., "opcode-debug")
    ///
    /// # Returns
    /// A new TmuxSession instance or an error message
    pub fn create(name: &str) -> Result<Self, String> {
        let pipe_path = PathBuf::from(format!("/tmp/{}.pipe", name));

        // Clean up existing pipe if present
        if pipe_path.exists() {
            fs::remove_file(&pipe_path).map_err(|e| format!("Failed to remove old pipe: {}", e))?;
        }

        // Create named pipe using mkfifo
        let mkfifo_status = Command::new("mkfifo")
            .arg(&pipe_path)
            .status()
            .map_err(|e| format!("Failed to create named pipe: {}", e))?;

        if !mkfifo_status.success() {
            return Err("mkfifo command failed".to_string());
        }

        // Kill existing tmux session if present
        let _ = Command::new("tmux")
            .args(["kill-session", "-t", name])
            .output();

        // Create new tmux session in detached mode running tail -f on the pipe
        let tmux_status = Command::new("tmux")
            .args([
                "new-session",
                "-d",
                "-s",
                name,
                "-x",
                "200",
                "-y",
                "50",
                &format!("tail -f {}", pipe_path.display()),
            ])
            .status()
            .map_err(|e| format!("Failed to create tmux session: {}", e))?;

        if !tmux_status.success() {
            // Clean up pipe on failure
            let _ = fs::remove_file(&pipe_path);
            return Err("Failed to create tmux session".to_string());
        }

        log::info!(
            "Debug tmux session '{}' created. Attach with: tmux attach -t {}",
            name,
            name
        );

        Ok(Self {
            session_name: name.to_string(),
            pipe_path,
        })
    }

    /// Write a message to the tmux session via the named pipe
    ///
    /// # Arguments
    /// * `msg` - Message to write (will have newline appended)
    pub fn write(&self, msg: &str) -> Result<(), String> {
        // Open pipe in append mode, non-blocking
        let mut file = OpenOptions::new()
            .write(true)
            .open(&self.pipe_path)
            .map_err(|e| format!("Failed to open pipe: {}", e))?;

        file.write_all(msg.as_bytes())
            .map_err(|e| format!("Failed to write to pipe: {}", e))?;

        file.write_all(b"\n")
            .map_err(|e| format!("Failed to write newline: {}", e))?;

        file.flush()
            .map_err(|e| format!("Failed to flush pipe: {}", e))?;

        Ok(())
    }

    /// Get the session name
    pub fn session_name(&self) -> &str {
        &self.session_name
    }

    /// Destroy the tmux session and clean up the pipe
    pub fn destroy(&self) -> Result<(), String> {
        // Kill tmux session
        let _ = Command::new("tmux")
            .args(["kill-session", "-t", &self.session_name])
            .output();

        // Remove pipe
        if self.pipe_path.exists() {
            fs::remove_file(&self.pipe_path)
                .map_err(|e| format!("Failed to remove pipe: {}", e))?;
        }

        log::info!("Debug tmux session '{}' destroyed", self.session_name);

        Ok(())
    }
}

impl Drop for TmuxSession {
    fn drop(&mut self) {
        // Best effort cleanup on drop
        let _ = self.destroy();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pipe_path_format() {
        let expected = PathBuf::from("/tmp/test-session.pipe");
        assert_eq!(
            PathBuf::from(format!("/tmp/{}.pipe", "test-session")),
            expected
        );
    }
}
