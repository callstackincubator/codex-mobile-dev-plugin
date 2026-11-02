plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.mobile.nativestorage.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.mobile.nativestorage.android"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        // MMKV ships native libs for every ABI; keep the fixture small.
        ndk { abiFilters += listOf("arm64-v8a") }
    }

    buildTypes {
        release {
            // The plugin reads app data through `adb shell run-as`, which needs a debuggable build.
            isDebuggable = true
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.datastore:datastore-preferences:1.1.7")
    implementation("androidx.datastore:datastore-core:1.1.7")
    implementation("com.google.protobuf:protobuf-javalite:4.28.3")
    implementation("com.tencent:mmkv:1.3.14")
}
