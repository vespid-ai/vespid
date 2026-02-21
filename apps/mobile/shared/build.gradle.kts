import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
  kotlin("multiplatform")
  id("com.android.library")
  kotlin("plugin.serialization")
}

fun hasXcodeToolchain(): Boolean {
  return try {
    val process = ProcessBuilder("/usr/bin/xcrun", "xcodebuild", "-version")
      .redirectErrorStream(true)
      .start()
    process.waitFor() == 0
  } catch (_: Exception) {
    false
  }
}

kotlin {
  androidTarget {
    compilerOptions {
      jvmTarget.set(JvmTarget.JVM_17)
    }
  }

  if (hasXcodeToolchain()) {
    iosX64()
    iosArm64()
    iosSimulatorArm64()
  } else {
    logger.lifecycle("Xcode toolchain not detected; skipping iOS targets for this environment.")
  }

  sourceSets {
    val commonMain by getting {
      dependencies {
        implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
        implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
        implementation("org.jetbrains.kotlinx:kotlinx-datetime:0.6.1")
        implementation("io.ktor:ktor-client-core:2.3.12")
        implementation("io.ktor:ktor-client-content-negotiation:2.3.12")
        implementation("io.ktor:ktor-client-websockets:2.3.12")
        implementation("io.ktor:ktor-serialization-kotlinx-json:2.3.12")
      }
    }
    val commonTest by getting {
      dependencies {
        implementation(kotlin("test"))
      }
    }
    val androidMain by getting {
      dependencies {
        implementation("io.ktor:ktor-client-okhttp:2.3.12")
      }
    }
  }
}

android {
  namespace = "com.vespid.mobile.shared"
  compileSdk = 35
  defaultConfig {
    minSdk = 29
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}
