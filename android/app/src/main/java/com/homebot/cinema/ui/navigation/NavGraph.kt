package com.homebot.cinema.ui.navigation

import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.homebot.cinema.data.preferences.UserPreferences
import com.homebot.cinema.data.repository.CinemaRepository
import com.homebot.cinema.player.CinemaPlayerManager
import com.homebot.cinema.ui.screens.details.DetailScreen
import com.homebot.cinema.ui.screens.details.DetailViewModel
import com.homebot.cinema.ui.screens.home.HomeScreen
import com.homebot.cinema.ui.screens.home.HomeViewModel
import com.homebot.cinema.ui.screens.player.PlayerScreen
import com.homebot.cinema.ui.screens.player.PlayerViewModel
import com.homebot.cinema.ui.screens.profiles.ProfileScreen
import com.homebot.cinema.ui.screens.profiles.ProfileViewModel
import com.homebot.cinema.ui.screens.settings.SettingsScreen

object Destinations {
    const val HOME = "home"
    const val DETAIL = "detail/{type}/{id}"
    const val PLAYER = "player?url={url}&title={title}"
    const val PROFILES = "profiles"
    const val SETTINGS = "settings"

    fun detailRoute(type: String, id: String) = "detail/$type/$id"
    fun playerRoute(url: String, title: String) =
        "player?url=${Uri.encode(url)}&title=${Uri.encode(title)}"
}

@Composable
fun CinemaNavGraph(
    navController: NavHostController,
    repository: CinemaRepository,
    playerManager: CinemaPlayerManager,
    userPreferences: UserPreferences,
    modifier: Modifier = Modifier
) {
    NavHost(
        navController = navController,
        startDestination = Destinations.HOME,
        modifier = modifier
    ) {
        composable(Destinations.HOME) {
            val homeViewModel = remember { HomeViewModel(repository) }
            HomeScreen(
                viewModel = homeViewModel,
                userPreferences = userPreferences,
                onNavigateToDetail = { id, type ->
                    navController.navigate(Destinations.detailRoute(type, id))
                },
                onNavigateToPlayer = { id, type, season, episode ->
                    // Navigate to details to select stream or auto-play
                    navController.navigate(Destinations.detailRoute(type ?: "movie", id))
                },
                onNavigateToSearch = {
                    navController.navigate(Destinations.SETTINGS)
                },
                onNavigateToProfile = {
                    navController.navigate(Destinations.PROFILES)
                }
            )
        }

        composable(
            route = Destinations.DETAIL,
            arguments = listOf(
                navArgument("type") { type = NavType.StringType },
                navArgument("id") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val type = backStackEntry.arguments?.getString("type") ?: "movie"
            val id = backStackEntry.arguments?.getString("id") ?: ""
            val detailViewModel = remember(type, id) { DetailViewModel(repository, type, id) }

            DetailScreen(
                viewModel = detailViewModel,
                onBackClick = { navController.popBackStack() },
                onPlayStream = { stream, title, season, episode ->
                    val streamUrl = stream.url ?: ""
                    val displayTitle = if (season != null && episode != null) "$title - S${season}E${episode}" else title
                    navController.navigate(Destinations.playerRoute(streamUrl, displayTitle))
                }
            )
        }

        composable(
            route = Destinations.PLAYER,
            arguments = listOf(
                navArgument("url") { type = NavType.StringType; defaultValue = "" },
                navArgument("title") { type = NavType.StringType; defaultValue = "" }
            )
        ) { backStackEntry ->
            val url = backStackEntry.arguments?.getString("url") ?: ""
            val title = backStackEntry.arguments?.getString("title") ?: ""
            val playerViewModel = remember { PlayerViewModel(playerManager) }

            remember(url) {
                if (url.isNotEmpty()) {
                    playerViewModel.startPlayback(url, title)
                }
                true
            }

            PlayerScreen(
                viewModel = playerViewModel,
                onBackClick = {
                    playerManager.player.stop()
                    navController.popBackStack()
                }
            )
        }

        composable(Destinations.PROFILES) {
            val profileViewModel = remember { ProfileViewModel(repository) }
            ProfileScreen(
                viewModel = profileViewModel,
                onBackClick = { navController.popBackStack() },
                onProfileSelected = { navController.popBackStack() }
            )
        }

        composable(Destinations.SETTINGS) {
            SettingsScreen(
                userPreferences = userPreferences,
                onBackClick = { navController.popBackStack() }
            )
        }
    }
}
