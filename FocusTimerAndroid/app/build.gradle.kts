plugins {
    id("com.android.application")
}

android {
    namespace = "nz.co.topline.focustimer"
    compileSdk = 35

    defaultConfig {
        applicationId = "nz.co.topline.focustimer"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
