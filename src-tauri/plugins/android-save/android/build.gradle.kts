plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.tauri.androidsave"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("proguard-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    // Backs the secureSet/secureGet/secureDelete commands (EncryptedSharedPreferences,
    // Keystore-derived AES256-GCM master key) used to store the Telegram bot token and
    // the backup passphrase outside plaintext localStorage — see audit item 1.3.
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation(project(":tauri-android"))
}
