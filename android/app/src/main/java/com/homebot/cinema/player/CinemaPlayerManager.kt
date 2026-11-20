package com.homebot.cinema.player

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class PlayerState(
    val isPlaying: Boolean = false,
    val isLoading: Boolean = false,
    val currentPositionMs: Long = 0L,
    val durationMs: Long = 0L,
    val title: String = "",
    val subtitle: String = "",
    val error: String? = null
)

@OptIn(UnstableApi::class)
class CinemaPlayerManager(
    private val context: Context
) {
    private val trackSelector = DefaultTrackSelector(context).apply {
        setParameters(
            buildUponParameters()
                .setPreferredAudioLanguage("eng")
                .setPreferredTextLanguage("eng")
                .setSelectUndeterminedTextLanguage(true)
        )
    }

    private val renderersFactory = DefaultRenderersFactory(context).apply {
        setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
        setEnableDecoderFallback(true)
    }

    val exoPlayer: ExoPlayer = ExoPlayer.Builder(context, renderersFactory)
        .setTrackSelector(trackSelector)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                .build(),
            true
        )
        .setHandleAudioBecomingNoisy(true)
        .build()

    val player: ExoPlayer get() = exoPlayer

    private val _playerState = MutableStateFlow(PlayerState())
    val playerState: StateFlow<PlayerState> = _playerState.asStateFlow()

    init {
        exoPlayer.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                updateState()
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                updateState()
            }

            override fun onPositionDiscontinuity(
                oldPosition: Player.PositionInfo,
                newPosition: Player.PositionInfo,
                reason: Int
            ) {
                updateState()
            }
        })
    }

    private fun updateState() {
        val duration = if (exoPlayer.duration > 0) exoPlayer.duration else 0L
        val position = if (exoPlayer.currentPosition > 0) exoPlayer.currentPosition else 0L
        _playerState.value = PlayerState(
            isPlaying = exoPlayer.isPlaying,
            isLoading = exoPlayer.playbackState == Player.STATE_BUFFERING,
            currentPositionMs = position,
            durationMs = duration,
            title = exoPlayer.mediaMetadata.title?.toString() ?: "",
            subtitle = exoPlayer.mediaMetadata.subtitle?.toString() ?: ""
        )
    }

    fun prepareAndPlay(url: String, title: String, startPositionMs: Long = 0L) {
        playStream(url, title, "", startPositionMs)
    }

    fun playStream(
        url: String,
        title: String,
        subtitle: String = "",
        startPositionMs: Long = 0L,
        headers: Map<String, String> = emptyMap()
    ) {
        val httpDataSourceFactory = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15000)
            .setReadTimeoutMs(20000)

        if (headers.isNotEmpty()) {
            httpDataSourceFactory.setDefaultRequestProperties(headers)
        }

        val mediaSourceFactory = DefaultMediaSourceFactory(httpDataSourceFactory)

        val metadata = MediaMetadata.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .build()

        val mediaItem = MediaItem.Builder()
            .setUri(url)
            .setMediaMetadata(metadata)
            .build()

        val mediaSource = mediaSourceFactory.createMediaSource(mediaItem)
        exoPlayer.setMediaSource(mediaSource)
        if (startPositionMs > 0L) {
            exoPlayer.seekTo(startPositionMs)
        }
        exoPlayer.prepare()
        exoPlayer.playWhenReady = true
    }

    fun togglePlayPause() {
        if (exoPlayer.isPlaying) {
            exoPlayer.pause()
        } else {
            exoPlayer.play()
        }
    }

    fun seekRelative(offsetMs: Long) {
        val current = exoPlayer.currentPosition
        val duration = exoPlayer.duration
        val target = (current + offsetMs).coerceIn(0L, if (duration > 0) duration else Long.MAX_VALUE)
        exoPlayer.seekTo(target)
    }

    fun release() {
        exoPlayer.release()
    }
}
