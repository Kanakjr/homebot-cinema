package com.homebot.cinema.data.preferences

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "cinema_prefs")

class UserPreferences(private val context: Context) {
    companion object {
        val KEY_SERVER_URL = stringPreferencesKey("server_url")
        val KEY_PROFILE_ID = stringPreferencesKey("profile_id")
        val KEY_CF_TOKEN = stringPreferencesKey("cf_token")
        val KEY_DIRECT_PLAY = booleanPreferencesKey("direct_play")
        const val DEFAULT_SERVER_URL = ""
    }

    val serverUrl: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[KEY_SERVER_URL]?.takeIf { it.isNotBlank() } ?: DEFAULT_SERVER_URL
    }

    val configuredServerUrl: Flow<String?> = context.dataStore.data.map { prefs ->
        prefs[KEY_SERVER_URL]?.let { ServerUrlConfig.normalizeServerUrl(it) }
    }

    val profileId: Flow<String?> = context.dataStore.data.map { prefs ->
        prefs[KEY_PROFILE_ID]
    }

    val cfToken: Flow<String?> = context.dataStore.data.map { prefs ->
        prefs[KEY_CF_TOKEN]
    }

    val directPlayEnabled: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[KEY_DIRECT_PLAY] ?: true
    }

    suspend fun setServerUrl(url: String) {
        val trimmed = url.trim().removeSuffix("/")
        context.dataStore.edit { prefs ->
            prefs[KEY_SERVER_URL] = trimmed
        }
    }

    suspend fun setProfileId(id: String) {
        context.dataStore.edit { prefs ->
            prefs[KEY_PROFILE_ID] = id
        }
    }

    suspend fun setActiveProfileId(id: String) = setProfileId(id)

    suspend fun setDirectPlayEnabled(enabled: Boolean) {
        context.dataStore.edit { prefs ->
            prefs[KEY_DIRECT_PLAY] = enabled
        }
    }

    suspend fun setCfToken(token: String?) {
        context.dataStore.edit { prefs ->
            if (token != null) {
                prefs[KEY_CF_TOKEN] = token
            } else {
                prefs.remove(KEY_CF_TOKEN)
            }
        }
    }
}
