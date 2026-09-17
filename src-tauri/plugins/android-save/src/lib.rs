//! Saves a generated file (PDF / Excel / JSON backup) into the *public*
//! Downloads folder on Android.
//!
//! Why this exists: on Android 10+ (scoped storage) the app can't write to
//! `/storage/emulated/0/Download` directly, and `tauri-plugin-fs` can't write
//! the `content://` URI the system save dialog hands back — that's what
//! produced 0-byte files. The only supported route is `MediaStore` (API 29+)
//! or a legacy `WRITE_EXTERNAL_STORAGE` write below that, which is what the
//! Kotlin side of this plugin does.
//!
//! On non-Android targets the command returns an error, and the TypeScript
//! caller falls back to the existing desktop/browser save paths.

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.androidsave";

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Plugin(String),
    #[cfg(target_os = "android")]
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    /// File name including extension, e.g. `bill-1024.pdf`.
    pub file_name: String,
    /// MIME type, e.g. `application/pdf`.
    pub mime_type: String,
    /// File contents, base64 encoded (JSON can't carry raw bytes).
    pub base64: String,
    /// Open the saved file in the OS viewer afterwards (used by Print).
    #[serde(default)]
    pub open_after_save: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResponse {
    /// `content://` URI (API 29+) or absolute path of the saved file.
    pub uri: String,
    /// Bytes actually written — the TS side rejects 0 so a silent failure
    /// can never again look like a successful download.
    pub bytes_written: u64,
}

/// Backs the Telegram bot token / backup passphrase store on Android — see
/// audit item 1.3. Values are encrypted at rest via
/// `EncryptedSharedPreferences` on the Kotlin side (Keystore-derived
/// AES256-GCM master key); this Rust layer just forwards key/value pairs
/// across the plugin bridge.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureSetRequest {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureKeyRequest {
    pub key: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureGetResponse {
    pub value: Option<String>,
}

#[cfg(target_os = "android")]
pub struct AndroidSave<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[cfg(target_os = "android")]
impl<R: Runtime> AndroidSave<R> {
    pub fn save_to_downloads(&self, payload: SaveRequest) -> Result<SaveResponse> {
        self.0
            .run_mobile_plugin("saveToDownloads", payload)
            .map_err(Into::into)
    }

    pub fn secure_set(&self, payload: SecureSetRequest) -> Result<()> {
        self.0.run_mobile_plugin("secureSet", payload).map_err(Into::into)
    }

    pub fn secure_get(&self, payload: SecureKeyRequest) -> Result<SecureGetResponse> {
        self.0.run_mobile_plugin("secureGet", payload).map_err(Into::into)
    }

    pub fn secure_delete(&self, payload: SecureKeyRequest) -> Result<()> {
        self.0.run_mobile_plugin("secureDelete", payload).map_err(Into::into)
    }
}

// `PhantomData<fn() -> R>` (rather than `PhantomData<R>`) so this type is
// always `Send + Sync` regardless of the concrete `Runtime`, since
// `Manager::state`/`manage` require `Send + Sync + 'static`.
#[cfg(not(target_os = "android"))]
pub struct AndroidSave<R: Runtime>(std::marker::PhantomData<fn() -> R>);

#[cfg(not(target_os = "android"))]
impl<R: Runtime> AndroidSave<R> {
    pub fn save_to_downloads(&self, _payload: SaveRequest) -> Result<SaveResponse> {
        Err(Error::Plugin(
            "android-save is only available on Android".into(),
        ))
    }

    pub fn secure_set(&self, _payload: SecureSetRequest) -> Result<()> {
        Err(Error::Plugin(
            "android-save is only available on Android".into(),
        ))
    }

    pub fn secure_get(&self, _payload: SecureKeyRequest) -> Result<SecureGetResponse> {
        Err(Error::Plugin(
            "android-save is only available on Android".into(),
        ))
    }

    pub fn secure_delete(&self, _payload: SecureKeyRequest) -> Result<()> {
        Err(Error::Plugin(
            "android-save is only available on Android".into(),
        ))
    }
}

pub trait AndroidSaveExt<R: Runtime> {
    fn android_save(&self) -> &AndroidSave<R>;
}

impl<R: Runtime, T: Manager<R>> AndroidSaveExt<R> for T {
    fn android_save(&self) -> &AndroidSave<R> {
        self.state::<AndroidSave<R>>().inner()
    }
}

#[tauri::command]
fn save_to_downloads<R: Runtime>(
    app: tauri::AppHandle<R>,
    payload: SaveRequest,
) -> Result<SaveResponse> {
    app.android_save().save_to_downloads(payload)
}

#[tauri::command]
fn secure_set<R: Runtime>(app: tauri::AppHandle<R>, payload: SecureSetRequest) -> Result<()> {
    app.android_save().secure_set(payload)
}

#[tauri::command]
fn secure_get<R: Runtime>(
    app: tauri::AppHandle<R>,
    payload: SecureKeyRequest,
) -> Result<SecureGetResponse> {
    app.android_save().secure_get(payload)
}

#[tauri::command]
fn secure_delete<R: Runtime>(app: tauri::AppHandle<R>, payload: SecureKeyRequest) -> Result<()> {
    app.android_save().secure_delete(payload)
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("android-save")
        .invoke_handler(tauri::generate_handler![
            save_to_downloads,
            secure_set,
            secure_get,
            secure_delete
        ])
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let handle = _api.register_android_plugin(PLUGIN_IDENTIFIER, "AndroidSavePlugin")?;
            #[cfg(target_os = "android")]
            app.manage(AndroidSave(handle));
            #[cfg(not(target_os = "android"))]
            app.manage(AndroidSave::<R>(std::marker::PhantomData));
            Ok(())
        })
        .build()
}
