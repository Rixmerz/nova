//! Debug mode module for Nova
//!
//! Provides a tmux-based debugging proxy that logs all communication
//! between the frontend and backend.
//!
//! # Activation
//! Set environment variable `NOVA_DEBUG=1` before starting the app.
//!
//! # Usage
//! ```bash
//! NOVA_DEBUG=1 cargo tauri dev
//! # In another terminal:
//! tmux attach -t nova-debug
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

/// Check if debug mode is enabled via NOVA_DEBUG environment variable
pub fn is_debug_enabled() -> bool {
    std::env::var("NOVA_DEBUG")
        .map(|v| v == "1" || v.to_lowercase() == "true")
        .unwrap_or(false)
}

/// Default session name for debug mode
pub const DEBUG_SESSION_NAME: &str = "nova-debug";
