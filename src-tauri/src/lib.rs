// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
//
// Nova Plugin Architecture v3:
// This is a minimal Tauri shell - window management only.
// All business logic (agents, sessions, MCP, storage) is handled by Nova.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
