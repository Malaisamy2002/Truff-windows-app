package app.tauri.androidsave

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import androidx.core.content.FileProvider
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class SaveArgs {
    lateinit var fileName: String
    lateinit var mimeType: String
    lateinit var base64: String
    /** Open the saved file in a viewer afterwards (used by Print). */
    var openAfterSave: Boolean = false
}

@InvokeArg
class SecureSetArgs {
    lateinit var key: String
    lateinit var value: String
}

@InvokeArg
class SecureKeyArgs {
    lateinit var key: String
}

@TauriPlugin
class AndroidSavePlugin(private val activity: Activity) : Plugin(activity) {

    /**
     * Writes the bytes into the device's public Downloads folder.
     *
     * API 29+ : MediaStore.Downloads insert + OutputStream (no permission needed,
     *           and unlike direct filesystem writes it is not silently blocked,
     *           which is what left 0-byte files behind).
     * API 24-28: legacy direct write to the public Downloads directory.
     */
    @Command
    fun saveToDownloads(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SaveArgs::class.java)
            val bytes = Base64.decode(args.base64, Base64.DEFAULT)
            if (bytes.isEmpty()) {
                invoke.reject("refusing to save an empty file")
                return
            }

            val uriString: String
            var written = 0L

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = activity.contentResolver
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, args.fileName)
                    put(MediaStore.MediaColumns.MIME_TYPE, args.mimeType)
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: run {
                        invoke.reject("MediaStore refused to create the file")
                        return
                    }
                resolver.openOutputStream(uri)?.use { out ->
                    out.write(bytes)
                    out.flush()
                    written = bytes.size.toLong()
                } ?: run {
                    resolver.delete(uri, null, null)
                    invoke.reject("could not open an output stream for the new file")
                    return
                }
                values.clear()
                values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                uriString = uri.toString()

                if (args.openAfterSave) openUri(uri.toString(), args.mimeType, false)
            } else {
                val dir = Environment.getExternalStoragePublicDirectory(
                    Environment.DIRECTORY_DOWNLOADS
                )
                if (!dir.exists()) dir.mkdirs()
                val target = uniqueFile(dir, args.fileName)
                target.outputStream().use { it.write(bytes) }
                written = target.length()
                uriString = target.absolutePath
                if (args.openAfterSave) openFile(target, args.mimeType)
            }

            if (written == 0L) {
                invoke.reject("file was created but nothing was written")
                return
            }

            val result = JSObject()
            result.put("uri", uriString)
            result.put("bytesWritten", written)
            invoke.resolve(result)
        } catch (e: Exception) {
            invoke.reject(e.message ?: e.toString())
        }
    }

    /**
     * Backing store for secureSet/secureGet/secureDelete: a SharedPreferences
     * file whose keys AND values are encrypted with a Keystore-derived
     * AES256-GCM master key (`EncryptedSharedPreferences`). This is what the
     * Telegram bot token (and the backup passphrase) get moved into on
     * Android instead of plaintext `localStorage` (audit item 1.3) — the
     * desktop build already has an equivalent via `keyring_*` (OS credential
     * store), which has no Android counterpart; this is that counterpart.
     *
     * Created lazily (not in a field initializer) so a Keystore failure
     * surfaces as a rejected command the TS caller can fall back from,
     * rather than crashing plugin registration.
     */
    private fun securePrefs(): SharedPreferences {
        val masterKey = MasterKey.Builder(activity)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            activity,
            "turf_ledger_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    /**
     * Same defense-in-depth principle as desktop's `keyring_*` commands (see
     * `src-tauri/src/lib.rs`): `key` is checked against a fixed allowlist
     * rather than trusted as an arbitrary caller-supplied name, so a script
     * running in the webview can't use this as a general encrypted
     * key/value store for anything it likes.
     */
    private val allowedSecureKeys = setOf(
        "telegram-backup-token",
        "telegram-backup-extra-tokens",
        "backup-passphrase",
    )

    private fun checkSecureKey(key: String) {
        require(allowedSecureKeys.contains(key)) { "unknown credential slot" }
    }

    /** Stores one secret under `key`, replacing any existing value. */
    @Command
    fun secureSet(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SecureSetArgs::class.java)
            checkSecureKey(args.key)
            securePrefs().edit().putString(args.key, args.value).apply()
            invoke.resolve(JSObject())
        } catch (e: Exception) {
            invoke.reject(e.message ?: e.toString())
        }
    }

    /** Returns the stored secret for `key`, or null in `value` if unset. */
    @Command
    fun secureGet(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SecureKeyArgs::class.java)
            checkSecureKey(args.key)
            val result = JSObject()
            result.put("value", securePrefs().getString(args.key, null))
            invoke.resolve(result)
        } catch (e: Exception) {
            invoke.reject(e.message ?: e.toString())
        }
    }

    /** Removes the stored secret for `key`, if any. Never rejects on "already absent". */
    @Command
    fun secureDelete(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SecureKeyArgs::class.java)
            checkSecureKey(args.key)
            securePrefs().edit().remove(args.key).apply()
            invoke.resolve(JSObject())
        } catch (e: Exception) {
            invoke.reject(e.message ?: e.toString())
        }
    }

    private fun uniqueFile(dir: File, name: String): File {
        var candidate = File(dir, name)
        if (!candidate.exists()) return candidate
        val dot = name.lastIndexOf('.')
        val stem = if (dot > 0) name.substring(0, dot) else name
        val ext = if (dot > 0) name.substring(dot) else ""
        var i = 1
        while (candidate.exists()) {
            candidate = File(dir, "$stem ($i)$ext")
            i++
        }
        return candidate
    }

    private fun openUri(uri: String, mimeType: String, grantWrite: Boolean) {
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(android.net.Uri.parse(uri), mimeType)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            if (grantWrite) addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }
        runCatching { activity.startActivity(intent) }
    }

    private fun openFile(file: File, mimeType: String) {
        val uri = runCatching {
            FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
        }.getOrNull() ?: android.net.Uri.fromFile(file)
        openUri(uri.toString(), mimeType, false)
    }
}
