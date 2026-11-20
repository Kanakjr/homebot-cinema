package com.homebot.cinema.data.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

@Serializable
data class Profile(
    val id: Int = 1,
    val name: String = "",
    val avatar: String? = null,
    val isKid: Boolean = false,
    val hasPin: Boolean = false,
    val accent: String? = null
)

@Serializable
data class ProfilesResponse(
    val profiles: List<Profile> = emptyList(),
    val ownerProfileId: String? = null
)

@Serializable
data class NextEpisodeInfo(
    val id: String = "",
    val season: Int? = null,
    val episode: Int? = null,
    val released: String? = null,
    val title: String? = null,
    val thumbnail: String? = null
)

@Serializable
data class UpNextInfo(
    val mode: String = "resume", // "resume", "next", "upcoming", "none"
    val remainingMs: Long? = null,
    val progress: Float? = null,
    val next: NextEpisodeInfo? = null,
    val videoId: String? = null,
    val season: Int? = null,
    val episode: Int? = null
)

@Serializable
data class UpNextResponse(
    val items: List<UpNextItem> = emptyList()
)

@Serializable
data class UpNextItem(
    val id: String,
    val mode: String = "none",
    val remainingMs: Long? = null,
    val progress: Float? = null,
    val next: NextEpisodeInfo? = null,
    val videoId: String? = null,
    val season: Int? = null,
    val episode: Int? = null
)

@Serializable
data class LibraryItemState(
    val duration: Long? = null,
    val timeOffset: Long? = null,
    val timeWatched: Long? = null,
    val lastWatched: String? = null,
    @SerialName("video_id") val videoId: String? = null
)

@Serializable
data class SyncLibraryItem(
    @SerialName("_id") val id: String,
    val type: String = "movie",
    val name: String = "",
    val poster: String? = null,
    val posterShape: String? = "poster",
    val state: LibraryItemState? = null
)

@Serializable
data class SyncLibraryRecent(
    val items: Map<String, SyncLibraryItem> = emptyMap()
)

@Serializable
data class SyncLibraryResponse(
    val profileId: Int? = null,
    @SerialName("library_recent") val libraryRecent: SyncLibraryRecent? = null
)

@Serializable
data class ContinueWatchingItem(
    val id: String,
    val type: String = "movie",
    val name: String = "",
    val poster: String? = null,
    val thumbnail: String? = null,
    val background: String? = null,
    val progress: Float = 0f,
    val pillLabel: String = "",
    val isAccentPill: Boolean = false,
    val season: Int? = null,
    val episode: Int? = null,
    val episodeTitle: String? = null,
    val videoId: String? = null,
    val remainingMs: Long? = null
)

@Serializable
data class ContinueWatchingResponse(
    val items: List<ContinueWatchingItem> = emptyList()
)

@Serializable
data class UpcomingItem(
    val metaId: String,
    val videoId: String = "",
    val name: String = "",
    val season: Int = 1,
    val episode: Int = 1,
    val title: String? = null,
    val released: String? = null,
    val thumbnail: String? = null,
    val background: String? = null,
    val poster: String? = null,
    val id: String = ""
) {
    val seriesTitle: String get() = name
    val episodeTitle: String get() = title ?: "Episode $episode"

    fun airBadge(): String {
        val rel = released ?: return ""
        return try {
            val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }
            val date = format.parse(rel) ?: return ""
            val nowCal = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }
            val targetCal = Calendar.getInstance().apply {
                time = date
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }
            val diffDays = ((targetCal.timeInMillis - nowCal.timeInMillis) / (24 * 60 * 60 * 1000)).toInt()
            when (diffDays) {
                -1 -> "Yesterday"
                0 -> "Today"
                1 -> "Tomorrow"
                in 2..6 -> SimpleDateFormat("EEEE", Locale.US).format(date)
                else -> SimpleDateFormat("d MMM", Locale.US).format(date)
            }
        } catch (_: Exception) {
            ""
        }
    }
}

@Serializable
data class UpcomingResponse(
    val items: List<UpcomingItem> = emptyList()
)

@Serializable
data class MetaItem(
    val id: String,
    val type: String? = "movie",
    val name: String,
    val poster: String? = null,
    val background: String? = null,
    val logo: String? = null,
    val description: String? = null,
    val releaseInfo: String? = null,
    val year: String? = null,
    val imdbRating: String? = null,
    val genres: List<String>? = emptyList(),
    val genre: List<String>? = emptyList(),
    val posterShape: String? = "poster"
)

@Serializable
data class CatalogResponse(
    val metas: List<MetaItem> = emptyList()
)

@Serializable
data class VideoItem(
    val id: String,
    val title: String? = null,
    val season: Int = 1,
    val episode: Int = 1,
    val thumbnail: String? = null,
    val released: String? = null
)

@Serializable
data class MetaDetail(
    val id: String,
    val type: String = "movie",
    val name: String,
    val poster: String? = null,
    val background: String? = null,
    val logo: String? = null,
    val description: String? = null,
    val releaseInfo: String? = null,
    val runtime: String? = null,
    val imdbRating: String? = null,
    val genres: List<String>? = emptyList(),
    val videos: List<VideoItem>? = null
)

@Serializable
data class MetaDetailResponse(
    val meta: MetaDetail
)

@Serializable
data class Stream(
    val name: String? = null,
    val title: String? = null,
    val url: String? = null,
    val infoHash: String? = null,
    val fileIdx: Int? = null,
    val quality: String? = null,
    val resolution: String? = null
)

typealias StreamItem = Stream

@Serializable
data class StreamsResponse(
    val streams: List<Stream> = emptyList()
)
