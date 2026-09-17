const COMMANDS: &[&str] = &["save_to_downloads"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
