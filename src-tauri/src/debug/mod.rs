//! Debug mode module for opcode
//!
//! Provides a tmux-based debugging proxy that logs all communication
//! between the frontend and backend.
//!
//! # Activation
//! Set environment variable `OPCODE_DEBUG=1` before starting the app.
//!
//! # Usage
//! ```bash
//! OPCODE_DEBUG=1 cargo tauri dev
//! # In another terminal:
//! tmux attach -t opcode-debug
//! ```

pub mod logger;
pub mod tmux;

pub use logger::DebugLogger;
pub use tmux::TmuxSession;

use std::sync::Arc;
use tokio::sync::Mutex;

/// State managed by Tauri for debug mode
pub struct DebugState {
    pub logger: Arc<Mutex<DebugLogger>>,
}

impl DebugState {
    /// Create a new DebugState with a logger
    pub fn new(logger: DebugLogger) -> Self {
        Self {
            logger: Arc::new(Mutex::new(logger)),
        }
    }
}

/// Check if debug mode is enabled via OPCODE_DEBUG environment variable
pub fn is_debug_enabled() -> bool {
    std::env::var("OPCODE_DEBUG")
        .map(|v| v == "1" || v.to_lowercase() == "true")
        .unwrap_or(false)
}

/// Default session name for debug mode
pub const DEBUG_SESSION_NAME: &str = "opcode-debug";
