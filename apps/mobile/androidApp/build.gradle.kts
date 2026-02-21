plugins {
  id("com.android.application")
  kotlin("android")
  id("org.jetbrains.kotlin.plugin.compose")
}

android {
  namespace = "com.vespid.mobile.android"
  compileSdk = 35

  signingConfigs {
    create("release") {
      // Default to debug keystore for local release testing.
      // Production distribution should override via env vars.
      storeFile = file(
        System.getenv("VESPID_RELEASE_STORE_FILE")
          ?: "${System.getProperty("user.home")}/.android/debug.keystore"
      )
      storePassword = System.getenv("VESPID_RELEASE_STORE_PASSWORD") ?: "android"
      keyAlias = System.getenv("VESPID_RELEASE_KEY_ALIAS") ?: "androiddebugkey"
      keyPassword = System.getenv("VESPID_RELEASE_KEY_PASSWORD") ?: "android"
      enableV1Signing = true
      enableV2Signing = true
      enableV3Signing = true
      enableV4Signing = false
    }
  }

  defaultConfig {
    applicationId = "com.vespid.mobile.android"
    minSdk = 29
    targetSdk = 35
    versionCode = 1
    versionName = "0.1.0"
    buildConfigField("String", "API_BASE_URL", "\"http://127.0.0.1:3001\"")
    buildConfigField("String", "GATEWAY_WS_BASE_URL", "\"ws://127.0.0.1:3002\"")
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      signingConfig = signingConfigs.getByName("release")
      proguardFiles(
        getDefaultProguardFile("proguard-android-optimize.txt"),
        "proguard-rules.pro"
      )
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions {
    jvmTarget = "17"
  }

  buildFeatures {
    compose = true
    buildConfig = true
  }
}

dependencies {
  implementation(project(":shared"))
  implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
  implementation("io.ktor:ktor-client-core:2.3.12")
  implementation("io.ktor:ktor-client-okhttp:2.3.12")
  implementation("io.ktor:ktor-client-content-negotiation:2.3.12")
  implementation("io.ktor:ktor-client-websockets:2.3.12")
  implementation("io.ktor:ktor-serialization-kotlinx-json:2.3.12")

  val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
  implementation(composeBom)
  androidTestImplementation(composeBom)

  implementation("androidx.core:core-ktx:1.13.1")
  implementation("androidx.activity:activity-compose:1.9.2")
  implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
  implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
  implementation("androidx.compose.ui:ui")
  implementation("androidx.compose.ui:ui-tooling-preview")
  implementation("androidx.compose.material3:material3")
  implementation("androidx.navigation:navigation-compose:2.8.2")

  debugImplementation("androidx.compose.ui:ui-tooling")
  debugImplementation("androidx.compose.ui:ui-test-manifest")
}
