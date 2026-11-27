plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

// A private build can carry its server (CINEMA_ORIGIN=https://your-host, like the desktop app): a fresh install then
// skips the first-run setup. Unset (the default, and every public build) = ask on first run. Never committed.
val bakedServerUrl = (System.getenv("CINEMA_ORIGIN") ?: "").trim().trimEnd('/')
require(bakedServerUrl.isEmpty() || Regex("^https://[A-Za-z0-9.-]+(:[0-9]+)?$").matches(bakedServerUrl)) {
    "CINEMA_ORIGIN must look like https://host[:port] (got \"$bakedServerUrl\")"
}

android {
    namespace = "com.homebot.cinema"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.homebot.cinema"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField("String", "BAKED_SERVER_URL", "\"$bakedServerUrl\"")

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    kotlinOptions {
        jvmTarget = "21"
    }

    buildFeatures {
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.ktx)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.datastore.preferences)

    testImplementation(libs.junit)
}
