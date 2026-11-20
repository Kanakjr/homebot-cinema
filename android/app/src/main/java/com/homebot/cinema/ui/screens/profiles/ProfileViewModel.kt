package com.homebot.cinema.ui.screens.profiles

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.homebot.cinema.data.api.Profile
import com.homebot.cinema.data.repository.CinemaRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ProfileUiState(
    val isLoading: Boolean = true,
    val profiles: List<Profile> = emptyList(),
    val activeProfileId: Int? = null,
    val errorMessage: String? = null
)

class ProfileViewModel(
    private val repository: CinemaRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(ProfileUiState())
    val uiState: StateFlow<ProfileUiState> = _uiState.asStateFlow()

    init {
        loadProfiles()
    }

    fun loadProfiles() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            val result = repository.getProfiles()
            result.onSuccess { profiles ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        profiles = profiles,
                        activeProfileId = profiles.firstOrNull()?.id
                    )
                }
            }.onFailure { err ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = err.message ?: "Failed to load profiles"
                    )
                }
            }
        }
    }

    fun selectProfile(profile: Profile, onComplete: () -> Unit) {
        viewModelScope.launch {
            repository.setActiveProfileId(profile.id.toString())
            _uiState.update { it.copy(activeProfileId = profile.id) }
            onComplete()
        }
    }
}
