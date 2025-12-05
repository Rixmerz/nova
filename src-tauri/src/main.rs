// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

fn main() {
    // Initialize logger
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Apply window vibrancy with rounded corners on macOS
            #[cfg(target_os = "macos")]
            {
                let window = app.get_webview_window("main").unwrap();

                // Try different vibrancy materials that support rounded corners
                let materials = [
                    NSVisualEffectMaterial::UnderWindowBackground,
                    NSVisualEffectMaterial::WindowBackground,
                    NSVisualEffectMaterial::Popover,
                    NSVisualEffectMaterial::Menu,
                    NSVisualEffectMaterial::Sidebar,
                ];

                let mut applied = false;
                for material in materials.iter() {
                    if apply_vibrancy(&window, *material, None, Some(12.0)).is_ok() {
                        applied = true;
                        break;
                    }
                }

                if !applied {
                    // Fallback without rounded corners
                    apply_vibrancy(
                        &window,
                        NSVisualEffectMaterial::WindowBackground,
                        None,
                        None,
                    )
                    .expect("Failed to apply any window vibrancy");
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
