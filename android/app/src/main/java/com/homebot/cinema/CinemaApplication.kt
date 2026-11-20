package com.homebot.cinema

import android.app.Application
import com.homebot.cinema.data.api.CinemaApiClient
import com.homebot.cinema.data.preferences.UserPreferences
import com.homebot.cinema.data.repository.CinemaRepository
import com.homebot.cinema.player.CinemaPlayerManager

class CinemaApplication : Application() {
    val userPreferences by lazy { UserPreferences(this) }
    val apiClient by lazy { CinemaApiClient(userPreferences = userPreferences) }
    val repository by lazy { CinemaRepository(apiClient, userPreferences) }
    val playerManager by lazy { CinemaPlayerManager(this) }

    override fun onCreate() {
        super.onCreate()
    }
}
