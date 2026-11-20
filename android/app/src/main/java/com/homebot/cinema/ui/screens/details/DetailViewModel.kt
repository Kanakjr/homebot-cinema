package com.homebot.cinema.ui.screens.details

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.homebot.cinema.data.api.MetaDetail
import com.homebot.cinema.data.api.StreamItem
import com.homebot.cinema.data.repository.CinemaRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class DetailUiState(
    val isLoading: Boolean = true,
    val meta: MetaDetail? = null,
    val streams: List<StreamItem> = emptyList(),
    val selectedSeason: Int = 1,
    val selectedEpisode: Int = 1,
    val isStreamsLoading: Boolean = false,
    val errorMessage: String? = null
)

class DetailViewModel(
    private val repository: CinemaRepository,
    private val type: String,
    private val id: String
) : ViewModel() {

    private val _uiState = MutableStateFlow(DetailUiState())
    val uiState: StateFlow<DetailUiState> = _uiState.asStateFlow()

    init {
        loadDetails()
    }

    fun loadDetails() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            val result = repository.getMeta(type, id)
            result.onSuccess { meta ->
                _uiState.update { it.copy(isLoading = false, meta = meta) }
                // Load streams for movie or first episode
                if (type == "movie") {
                    loadStreams(id)
                } else if (!meta.videos.isNullOrEmpty()) {
                    val firstEp = meta.videos.first()
                    _uiState.update {
                        it.copy(
                            selectedSeason = firstEp.season,
                            selectedEpisode = firstEp.episode
                        )
                    }
                    loadStreams(firstEp.id)
                }
            }.onFailure { err ->
                _uiState.update {
                    it.copy(isLoading = false, errorMessage = err.message ?: "Failed to load details")
                }
            }
        }
    }

    fun selectEpisode(season: Int, episode: Int, videoId: String) {
        _uiState.update { it.copy(selectedSeason = season, selectedEpisode = episode) }
        loadStreams(videoId)
    }

    fun loadStreams(streamTargetId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isStreamsLoading = true) }
            val result = repository.getStreams(type, streamTargetId)
            result.onSuccess { streams ->
                _uiState.update { it.copy(isStreamsLoading = false, streams = streams) }
            }.onFailure {
                _uiState.update { it.copy(isStreamsLoading = false) }
            }
        }
    }
}
