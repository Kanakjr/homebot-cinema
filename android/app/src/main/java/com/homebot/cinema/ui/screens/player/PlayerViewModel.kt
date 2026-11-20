package com.homebot.cinema.ui.screens.player

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.homebot.cinema.player.CinemaPlayerManager
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class PlayerUiState(
    val title: String = "",
    val isPlaying: Boolean = false,
    val isBuffering: Boolean = false,
    val currentPositionMs: Long = 0L,
    val durationMs: Long = 0L,
    val controlsVisible: Boolean = true,
    val errorMessage: String? = null
)

class PlayerViewModel(
    val playerManager: CinemaPlayerManager
) : ViewModel() {

    private val _uiState = MutableStateFlow(PlayerUiState())
    val uiState: StateFlow<PlayerUiState> = _uiState.asStateFlow()

    private var progressJob: Job? = null

    init {
        startProgressTracking()
    }

    fun startPlayback(url: String, title: String) {
        _uiState.update { it.copy(title = title, isBuffering = true) }
        playerManager.prepareAndPlay(url, title)
    }

    private fun startProgressTracking() {
        progressJob?.cancel()
        progressJob = viewModelScope.launch {
            while (isActive) {
                val player = playerManager.player
                _uiState.update {
                    it.copy(
                        isPlaying = player.isPlaying,
                        isBuffering = player.playbackState == androidx.media3.common.Player.STATE_BUFFERING,
                        currentPositionMs = player.currentPosition.coerceAtLeast(0L),
                        durationMs = player.duration.coerceAtLeast(0L)
                    )
                }
                delay(500)
            }
        }
    }

    fun togglePlayPause() {
        val player = playerManager.player
        if (player.isPlaying) {
            player.pause()
        } else {
            player.play()
        }
    }

    fun seekRelative(offsetMs: Long) {
        val player = playerManager.player
        val target = (player.currentPosition + offsetMs).coerceIn(0L, player.duration.coerceAtLeast(0L))
        player.seekTo(target)
    }

    fun seekTo(positionMs: Long) {
        playerManager.player.seekTo(positionMs)
    }

    fun toggleControls() {
        _uiState.update { it.copy(controlsVisible = !it.controlsVisible) }
    }

    fun setControlsVisible(visible: Boolean) {
        _uiState.update { it.copy(controlsVisible = visible) }
    }

    override fun onCleared() {
        super.onCleared()
        progressJob?.cancel()
        playerManager.release()
    }
}
