package com.homebot.cinema

import android.app.Application
import com.homebot.cinema.data.preferences.UserPreferences

class CinemaApplication : Application() {
    val userPreferences by lazy { UserPreferences(this) }
}
