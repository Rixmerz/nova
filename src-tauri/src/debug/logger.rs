//! Debug logger for formatting and writing debug messages
//!
//! Provides formatted output for Tauri command invocations, responses,
//! and streaming events.

use super::tmux::TmuxSession;
use chrono::{DateTime, Utc};
use serde_json::Value;

/// Debug logger that writes formatted messages to a tmux session
pub struct DebugLogger {
    tmux: TmuxSession,
}

impl DebugLogger {
    /// Create a new debug logger with a tmux session
    ///
    /// # Arguments
    /// * `session_name` - Name for the tmux session
    pub fn new(session_name: &str) -> Result<Self, String> {
        let tmux = TmuxSession::create(session_name)?;
        let logger = Self { tmux };

        // Write welcome message
        logger.write_header()?;

        Ok(logger)
    }

    /// Write the initial header message
    fn write_header(&self) -> Result<(), String> {
        let header = format!(
            r#"
╔══════════════════════════════════════════════════════════════════════════════╗
║                         OPCODE DEBUG MODE                                     ║
║                                                                              ║
║  Session: {}                                                  ║
║  Started: {}                                           ║
║                                                                              ║
║  Legend:                                                                     ║
║    >>> INVOKE   - Frontend calling backend command                           ║
║    <<< RESPONSE - Backend returning result                                   ║
║    --> EVENT    - Backend emitting event to frontend                         ║
║    !!! ERROR    - Error occurred                                             ║
╚══════════════════════════════════════════════════════════════════════════════╝
"#,
            self.tmux.session_name(),
            Utc::now().format("%Y-%m-%d %H:%M:%S UTC")
        );

        self.tmux.write(&header)
    }

    /// Get current timestamp
    fn timestamp() -> String {
        let now: DateTime<Utc> = Utc::now();
        now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
    }

    /// Format JSON value for display (pretty print with indentation)
    fn format_json(value: &Value) -> String {
        serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
    }

    /// Log a command invocation from frontend to backend
    ///
    /// # Arguments
    /// * `command` - Name of the Tauri command
    /// * `params` - Parameters passed to the command
    pub fn log_invoke(&self, command: &str, params: &Value) {
        let msg = format!(
            r#"
════════════════════════════════════════════════════════════════════════════════
[{}] >>> INVOKE: {}
────────────────────────────────────────────────────────────────────────────────
{}
════════════════════════════════════════════════════════════════════════════════"#,
            Self::timestamp(),
            command,
            Self::format_json(params)
        );

        if let Err(e) = self.tmux.write(&msg) {
            log::warn!("Failed to write debug log: {}", e);
        }
    }

    /// Log a command response from backend to frontend
    ///
    /// # Arguments
    /// * `command` - Name of the Tauri command
    /// * `result` - Result returned by the command
    /// * `duration_ms` - Execution time in milliseconds
    pub fn log_response(&self, command: &str, result: &Value, duration_ms: u64) {
        let msg = format!(
            r#"
════════════════════════════════════════════════════════════════════════════════
[{}] <<< RESPONSE: {} ({}ms)
────────────────────────────────────────────────────────────────────────────────
{}
════════════════════════════════════════════════════════════════════════════════"#,
            Self::timestamp(),
            command,
            duration_ms,
            Self::format_json(result)
        );

        if let Err(e) = self.tmux.write(&msg) {
            log::warn!("Failed to write debug log: {}", e);
        }
    }

    /// Log an event emitted from backend to frontend
    ///
    /// # Arguments
    /// * `event` - Name of the event
    /// * `payload` - Event payload
    pub fn log_event(&self, event: &str, payload: &Value) {
        let msg = format!(
            r#"
════════════════════════════════════════════════════════════════════════════════
[{}] --> EVENT: {}
────────────────────────────────────────────────────────────────────────────────
{}
════════════════════════════════════════════════════════════════════════════════"#,
            Self::timestamp(),
            event,
            Self::format_json(payload)
        );

        if let Err(e) = self.tmux.write(&msg) {
            log::warn!("Failed to write debug log: {}", e);
        }
    }

    /// Log an error
    ///
    /// # Arguments
    /// * `command` - Name of the command that failed
    /// * `error` - Error message
    pub fn log_error(&self, command: &str, error: &str) {
        let msg = format!(
            r#"
════════════════════════════════════════════════════════════════════════════════
[{}] !!! ERROR: {}
────────────────────────────────────────────────────────────────────────────────
{}
════════════════════════════════════════════════════════════════════════════════"#,
            Self::timestamp(),
            command,
            error
        );

        if let Err(e) = self.tmux.write(&msg) {
            log::warn!("Failed to write debug log: {}", e);
        }
    }

    /// Log a raw message without formatting
    pub fn log_raw(&self, msg: &str) {
        if let Err(e) = self.tmux.write(msg) {
            log::warn!("Failed to write debug log: {}", e);
        }
    }
}
