package com.homebot.cinema.data.api

import com.homebot.cinema.data.preferences.UserPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.util.concurrent.TimeUnit

class CinemaApiClient(
    private var baseUrl: String = "http://10.0.2.2:3099",
    private var profileId: String? = null,
    private var cfToken: String? = null,
    private val userPreferences: UserPreferences? = null
) {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    fun updateConfig(baseUrl: String, profileId: String?, cfToken: String?) {
        this.baseUrl = baseUrl.trim().removeSuffix("/")
        this.profileId = profileId
        this.cfToken = cfToken
    }

    private fun newRequestBuilder(path: String): Request.Builder {
        val url = if (path.startsWith("http")) path else "$baseUrl$path"
        val builder = Request.Builder().url(url)
        val activePid = profileId ?: "1"
        builder.addHeader("x-profile-id", activePid)
        builder.addHeader("X-Profile-Id", activePid)
        builder.addHeader("X-Cinema-Profile", activePid)
        cfToken?.let {
            builder.addHeader("CF-Access-Token", it)
            builder.addHeader("Cf-Access-Jwt-Assertion", it)
            builder.addHeader("Cookie", "CF_Authorization=$it")
        }
        return builder
    }

    suspend fun getProfiles(): List<Profile> = withContext(Dispatchers.IO) {
        try {
            val request = newRequestBuilder("/api/profiles").get().build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext emptyList()
                val body = response.body?.string() ?: return@withContext emptyList()
                try {
                    json.decodeFromString<List<Profile>>(body)
                } catch (_: Exception) {
                    try {
                        json.decodeFromString<ProfilesResponse>(body).profiles
                    } catch (_: Exception) {
                        emptyList()
                    }
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    suspend fun getContinueWatching(): List<ContinueWatchingItem> = withContext(Dispatchers.IO) {
        try {
            // 1. Fetch library recent items
            val libRequest = newRequestBuilder("/api/sync/library").get().build()
            val recentItems = client.newCall(libRequest).execute().use { response ->
                if (!response.isSuccessful) return@use emptyList<SyncLibraryItem>()
                val body = response.body?.string() ?: return@use emptyList<SyncLibraryItem>()
                try {
                    val parsed = json.decodeFromString<SyncLibraryResponse>(body)
                    parsed.libraryRecent?.items?.values
                        ?.sortedByDescending { it.state?.lastWatched ?: "" }
                        ?: emptyList()
                } catch (_: Exception) {
                    emptyList()
                }
            }

            if (recentItems.isEmpty()) return@withContext emptyList()

            // 2. Query upnext for top recent items
            val imdbIds = recentItems.map { it.id }.filter { it.startsWith("tt") }.take(10)
            val upNextMap = if (imdbIds.isNotEmpty()) {
                val upNextUrl = "/api/upnext/continue?ids=${imdbIds.joinToString(",")}"
                val upRequest = newRequestBuilder(upNextUrl).get().build()
                client.newCall(upRequest).execute().use { response ->
                    if (response.isSuccessful) {
                        val body = response.body?.string() ?: ""
                        try {
                            json.decodeFromString<UpNextResponse>(body).items.associateBy { it.id }
                        } catch (_: Exception) {
                            emptyMap()
                        }
                    } else emptyMap()
                }
            } else emptyMap()

            // 3. Transform into rich ContinueWatchingItem
            recentItems.mapNotNull { item ->
                val up = upNextMap[item.id]
                val progress = up?.progress ?: run {
                    val offset = item.state?.timeOffset ?: 0L
                    val dur = item.state?.duration ?: 1L
                    if (dur > 0) (offset.toFloat() / dur.toFloat()).coerceIn(0f, 1f) else 0f
                }

                val isNext = up?.mode == "next"
                val isUpcoming = up?.mode == "upcoming"
                val season = up?.season ?: up?.next?.season
                val episode = up?.episode ?: up?.next?.episode
                val episodeTitle = up?.next?.title

                val (pillText, isAccent) = when {
                    isNext -> {
                        val epPart = if (season != null && episode != null) "S$season E$episode " else ""
                        "Next up · ${epPart}New episode" to true
                    }
                    isUpcoming -> {
                        val epPart = if (season != null && episode != null) "S$season E$episode " else ""
                        val airDate = up.next?.released
                        val airStr = if (airDate != null) {
                            val dummy = UpcomingItem(metaId = item.id, released = airDate)
                            val badge = dummy.airBadge()
                            if (badge.isNotEmpty()) "Airs $badge" else "Not aired yet"
                        } else "Not aired yet"
                        "Next up · $epPart$airStr" to true
                    }
                    progress > 0.05f -> {
                        "${(progress * 100).toInt()}% watched" to false
                    }
                    else -> "" to false
                }

                val backdrop = if (item.id.startsWith("tt")) {
                    "https://images.metahub.space/background/medium/${item.id}/img"
                } else item.poster

                ContinueWatchingItem(
                    id = item.id,
                    type = item.type,
                    name = item.name,
                    poster = item.poster,
                    thumbnail = up?.next?.thumbnail ?: backdrop,
                    background = backdrop,
                    progress = progress,
                    pillLabel = pillText,
                    isAccentPill = isAccent,
                    season = season,
                    episode = episode,
                    episodeTitle = episodeTitle,
                    videoId = up?.videoId ?: item.state?.videoId,
                    remainingMs = up?.remainingMs
                )
            }.take(10)
        } catch (_: Exception) {
            emptyList()
        }
    }

    suspend fun getUpcoming(): List<UpcomingItem> = withContext(Dispatchers.IO) {
        try {
            val request = newRequestBuilder("/api/upnext/upcoming").get().build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext emptyList()
                val body = response.body?.string() ?: return@withContext emptyList()
                try {
                    json.decodeFromString<UpcomingResponse>(body).items
                } catch (_: Exception) {
                    try {
                        json.decodeFromString<List<UpcomingItem>>(body)
                    } catch (_: Exception) {
                        emptyList()
                    }
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    suspend fun getCatalog(type: String, id: String): CatalogResponse = withContext(Dispatchers.IO) {
        val cinemetaUrl = "https://v3-cinemeta.strem.io/catalog/$type/$id.json"
        try {
            val request = Request.Builder().url(cinemetaUrl).get().build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext CatalogResponse(emptyList())
                val body = response.body?.string() ?: return@withContext CatalogResponse(emptyList())
                json.decodeFromString<CatalogResponse>(body)
            }
        } catch (_: Exception) {
            CatalogResponse(emptyList())
        }
    }

    suspend fun getMeta(type: String, id: String): MetaDetail = withContext(Dispatchers.IO) {
        val cinemetaUrl = "https://v3-cinemeta.strem.io/meta/$type/$id.json"
        try {
            val request = Request.Builder().url(cinemetaUrl).get().build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw IOException("Failed to load metadata: ${response.code}")
                val body = response.body?.string() ?: throw IOException("Empty body")
                try {
                    json.decodeFromString<MetaDetailResponse>(body).meta
                } catch (_: Exception) {
                    json.decodeFromString<MetaDetail>(body)
                }
            }
        } catch (_: Exception) {
            MetaDetail(id = id, type = type, name = "Unknown")
        }
    }

    suspend fun getStreams(type: String, id: String): List<Stream> = withContext(Dispatchers.IO) {
        val request = newRequestBuilder("/api/stream/$type/$id").get().build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return@withContext emptyList()
            val body = response.body?.string() ?: return@withContext emptyList()
            try {
                json.decodeFromString<StreamsResponse>(body).streams
            } catch (_: Exception) {
                try {
                    json.decodeFromString<List<Stream>>(body)
                } catch (_: Exception) {
                    emptyList()
                }
            }
        }
    }

    fun buildDirectStreamUrl(streamId: String): String {
        return "$baseUrl/api/downloads/stream/$streamId?direct=1"
    }

    fun resolveImageUrl(relativeOrAbsolute: String?): String? {
        if (relativeOrAbsolute == null) return null
        return if (relativeOrAbsolute.startsWith("http")) {
            relativeOrAbsolute
        } else {
            "$baseUrl/$relativeOrAbsolute".replace("([^:])//+".toRegex(), "$1/")
        }
    }
}
