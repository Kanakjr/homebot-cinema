package com.homebot.cinema.ui.screens.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.homebot.cinema.data.api.CatalogResponse
import com.homebot.cinema.data.api.ContinueWatchingItem
import com.homebot.cinema.data.api.MetaItem
import com.homebot.cinema.data.api.Profile
import com.homebot.cinema.data.api.UpcomingItem
import com.homebot.cinema.data.repository.CinemaRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class HomeUiState(
    val isLoading: Boolean = true,
    val isAuthenticated: Boolean = false,
    val currentProfile: Profile? = null,
    val heroItems: List<MetaItem> = emptyList(),
    val heroIndex: Int = 0,
    val continueWatching: List<ContinueWatchingItem> = emptyList(),
    val upcoming: List<UpcomingItem> = emptyList(),
    val catalogs: List<CatalogResponse> = emptyList(),
    val errorMessage: String? = null
)

class HomeViewModel(
    private val repository: CinemaRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    init {
        // Observe auth state changes
        viewModelScope.launch {
            repository.cfToken.collect { token ->
                val isAuth = !token.isNullOrBlank()
                _uiState.update { it.copy(isAuthenticated = isAuth) }
                if (isAuth) {
                    loadPrivateData()
                }
            }
        }
        loadHomeData()
    }

    fun loadHomeData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }

            // 1. Load Cinemeta Catalogs immediately (never requires auth)
            launch {
                try {
                    val moviesResult = repository.getCatalog("movie", "top")
                    val seriesResult = repository.getCatalog("series", "top")

                    val catalogsList = mutableListOf<CatalogResponse>()
                    moviesResult.getOrNull()?.let { catalogsList.add(it) }
                    seriesResult.getOrNull()?.let { catalogsList.add(it) }

                    val heroItems = moviesResult.getOrNull()?.metas?.take(6) ?: emptyList()

                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            heroItems = heroItems,
                            catalogs = catalogsList
                        )
                    }
                } catch (e: Exception) {
                    _uiState.update { it.copy(isLoading = false) }
                }
            }

            // 2. Load private household data
            loadPrivateData()
        }
    }

    private fun loadPrivateData() {
        viewModelScope.launch {
            try {
                val profilesResult = repository.getProfiles()
                val profiles = profilesResult.getOrNull() ?: emptyList()
                val currentProfile = profiles.firstOrNull()

                val continueWatchingResult = repository.getContinueWatching()
                val continueWatching = continueWatchingResult.getOrNull() ?: emptyList()

                val upcomingResult = repository.getUpcoming()
                val upcoming = upcomingResult.getOrNull() ?: emptyList()

                _uiState.update {
                    it.copy(
                        currentProfile = currentProfile,
                        continueWatching = continueWatching,
                        upcoming = upcoming
                    )
                }
            } catch (_: Exception) {
                // If unauthenticated or offline, public catalog still renders
            }
        }
    }

    fun selectHeroIndex(index: Int) {
        _uiState.update { it.copy(heroIndex = index) }
    }
}
