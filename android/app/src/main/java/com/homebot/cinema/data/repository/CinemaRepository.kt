package com.homebot.cinema.data.repository

import com.homebot.cinema.data.api.CatalogResponse
import com.homebot.cinema.data.api.CinemaApiClient
import com.homebot.cinema.data.api.ContinueWatchingItem
import com.homebot.cinema.data.api.MetaDetail
import com.homebot.cinema.data.api.Profile
import com.homebot.cinema.data.api.Stream
import com.homebot.cinema.data.api.UpcomingItem
import com.homebot.cinema.data.preferences.UserPreferences
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first

class CinemaRepository(
    private val apiClient: CinemaApiClient,
    private val preferences: UserPreferences
) {
    val serverUrl: Flow<String> = preferences.serverUrl
    val profileId: Flow<String?> = preferences.profileId
    val cfToken: Flow<String?> = preferences.cfToken

    private suspend fun syncConfig() {
        val url = preferences.serverUrl.first()
        val pId = preferences.profileId.first() ?: "1"
        val token = preferences.cfToken.first()
        apiClient.updateConfig(url, pId, token)
    }

    suspend fun getProfiles(): Result<List<Profile>> = runCatching {
        syncConfig()
        apiClient.getProfiles()
    }

    suspend fun selectProfile(profileId: String) {
        preferences.setProfileId(profileId)
        syncConfig()
    }

    suspend fun setActiveProfileId(profileId: String) {
        selectProfile(profileId)
    }

    suspend fun setServerUrl(url: String) {
        preferences.setServerUrl(url)
        syncConfig()
    }

    suspend fun getContinueWatching(): Result<List<ContinueWatchingItem>> = runCatching {
        syncConfig()
        apiClient.getContinueWatching()
    }

    suspend fun getUpcoming(): Result<List<UpcomingItem>> = runCatching {
        syncConfig()
        apiClient.getUpcoming()
    }

    suspend fun getCatalog(type: String, id: String): Result<CatalogResponse> = runCatching {
        syncConfig()
        apiClient.getCatalog(type, id)
    }

    suspend fun getMeta(type: String, id: String): Result<MetaDetail> = runCatching {
        syncConfig()
        apiClient.getMeta(type, id)
    }

    suspend fun getStreams(type: String, id: String): Result<List<Stream>> = runCatching {
        syncConfig()
        apiClient.getStreams(type, id)
    }

    fun resolveImageUrl(path: String?): String? {
        return apiClient.resolveImageUrl(path)
    }

    fun buildDirectStreamUrl(streamId: String): String {
        return apiClient.buildDirectStreamUrl(streamId)
    }
}
