package com.homebot.cinema.ui.screens.home

import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.homebot.cinema.data.api.ContinueWatchingItem
import com.homebot.cinema.data.api.MetaItem
import com.homebot.cinema.data.api.UpcomingItem
import com.homebot.cinema.data.preferences.UserPreferences
import com.homebot.cinema.ui.components.BottomNavBar
import com.homebot.cinema.ui.components.ContinueWatchingCard
import com.homebot.cinema.ui.components.HeroCarousel
import com.homebot.cinema.ui.components.MetaItemCard
import com.homebot.cinema.ui.components.NavTab
import com.homebot.cinema.ui.components.TopNavBar
import com.homebot.cinema.ui.components.UpcomingCard
import com.homebot.cinema.ui.theme.CinemaAccentOrange
import com.homebot.cinema.ui.theme.CinemaBackground
import com.homebot.cinema.ui.theme.CinemaSurfaceVariant
import com.homebot.cinema.ui.theme.CinemaTextPrimary
import com.homebot.cinema.ui.theme.CinemaTextSecondary
import kotlinx.coroutines.launch

@Composable
fun HomeScreen(
    viewModel: HomeViewModel,
    userPreferences: UserPreferences,
    onNavigateToDetail: (String, String) -> Unit,
    onNavigateToPlayer: (String, String?, Int?, Int?) -> Unit,
    onNavigateToSearch: () -> Unit,
    onNavigateToProfile: () -> Unit,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()
    val serverUrl by userPreferences.serverUrl.collectAsState(initial = "https://cinema.kanakjr.in")
    val cfToken by userPreferences.cfToken.collectAsState(initial = null)
    val scope = rememberCoroutineScope()
    var showLoginDialog by remember { mutableStateOf(false) }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = CinemaBackground,
        topBar = {
            TopNavBar(
                currentProfile = state.currentProfile,
                onSearchClick = onNavigateToSearch,
                onProfileClick = onNavigateToProfile,
                serverUrl = serverUrl,
                cfToken = cfToken
            )
        },
        bottomBar = {
            BottomNavBar(
                selectedTab = NavTab.HOME,
                onTabSelected = { tab ->
                    when (tab) {
                        NavTab.HOME -> {}
                        NavTab.SETTINGS -> onNavigateToSearch()
                        else -> {}
                    }
                }
            )
        }
    ) { innerPadding ->
        if (state.isLoading && state.catalogs.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(color = CinemaAccentOrange)
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding),
                contentPadding = PaddingValues(bottom = 32.dp)
            ) {
                // 1. Hero Carousel
                if (state.heroItems.isNotEmpty()) {
                    item {
                        HeroCarousel(
                            items = state.heroItems,
                            onPlayClick = { meta ->
                                onNavigateToPlayer(meta.id, meta.type, null, null)
                            },
                            onDetailsClick = { meta ->
                                onNavigateToDetail(meta.id, meta.type ?: "movie")
                            }
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                    }
                }

                // 2. Auth Banner if unauthenticated
                if (!state.isAuthenticated) {
                    item {
                        Surface(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 8.dp)
                                .clip(RoundedCornerShape(12.dp)),
                            color = CinemaSurfaceVariant
                        ) {
                            Row(
                                modifier = Modifier.padding(16.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = "Household Sign In",
                                        color = CinemaTextPrimary,
                                        fontSize = 15.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                    Spacer(modifier = Modifier.height(4.dp))
                                    Text(
                                        text = "Sign in with Cloudflare Access to see your Continue Watching and private library.",
                                        color = CinemaTextSecondary,
                                        fontSize = 12.sp
                                    )
                                    Spacer(modifier = Modifier.height(10.dp))
                                    Button(
                                        onClick = { showLoginDialog = true },
                                        colors = ButtonDefaults.buttonColors(containerColor = CinemaAccentOrange),
                                        shape = RoundedCornerShape(8.dp),
                                        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.Lock,
                                            contentDescription = null,
                                            tint = Color.White,
                                            modifier = Modifier.size(16.dp)
                                        )
                                        Spacer(modifier = Modifier.width(6.dp))
                                        Text("Sign In (Cloudflare)", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                    }
                                }
                            }
                        }
                        Spacer(modifier = Modifier.height(12.dp))
                    }
                }

                // 3. Continue Watching Row
                if (state.continueWatching.isNotEmpty()) {
                    item {
                        SectionHeader(
                            title = "Continue watching",
                            onSeeAllClick = {}
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = 16.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            items(state.continueWatching, key = { "${it.id}_${it.season}_${it.episode}" }) { item ->
                                ContinueWatchingCard(
                                    item = item,
                                    cardWidth = 260.dp,
                                    onClick = {
                                        onNavigateToPlayer(item.id, item.type, item.season, item.episode)
                                    }
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(24.dp))
                    }
                }

                // 4. Upcoming Row
                if (state.upcoming.isNotEmpty()) {
                    item {
                        SectionHeader(
                            title = "Upcoming",
                            onSeeAllClick = {}
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = 16.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            items(state.upcoming, key = { "${it.metaId}_${it.season}_${it.episode}_${it.videoId}" }) { item ->
                                UpcomingCard(
                                    item = item,
                                    cardWidth = 260.dp,
                                    onClick = {
                                        onNavigateToDetail(item.metaId, "series")
                                    }
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(24.dp))
                    }
                }

                // 5. Catalog Rows (Popular Movies, Popular Series)
                items(state.catalogs.size) { catIndex ->
                    val catalog = state.catalogs[catIndex]
                    val catTitle = if (catalog.metas.firstOrNull()?.type == "series") "Popular • Series" else "Popular • Movies"
                    SectionHeader(
                        title = catTitle,
                        onSeeAllClick = {}
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    LazyRow(
                        contentPadding = PaddingValues(horizontal = 16.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        items(catalog.metas, key = { it.id }) { meta ->
                            MetaItemCard(
                                item = meta,
                                cardWidth = 135.dp,
                                onClick = {
                                    onNavigateToDetail(meta.id, meta.type ?: "movie")
                                }
                            )
                        }
                    }
                    Spacer(modifier = Modifier.height(24.dp))
                }
            }
        }
    }

    if (showLoginDialog) {
        Dialog(
            onDismissRequest = { showLoginDialog = false },
            properties = DialogProperties(usePlatformDefaultWidth = false)
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black)
            ) {
                AndroidView(
                    factory = { ctx ->
                        WebView(ctx).apply {
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            webViewClient = object : WebViewClient() {
                                override fun onPageFinished(view: WebView?, url: String?) {
                                    super.onPageFinished(view, url)
                                    val cookieStr = CookieManager.getInstance().getCookie(url ?: serverUrl)
                                    if (cookieStr != null && cookieStr.contains("CF_Authorization=")) {
                                        val token = cookieStr.split(";")
                                            .map { it.trim() }
                                            .find { it.startsWith("CF_Authorization=") }
                                            ?.substringAfter("CF_Authorization=")
                                        if (!token.isNullOrBlank()) {
                                            scope.launch {
                                                userPreferences.setCfToken(token)
                                                showLoginDialog = false
                                            }
                                        }
                                    }
                                }
                            }
                            loadUrl(serverUrl)
                        }
                    },
                    modifier = Modifier.fillMaxSize()
                )

                IconButton(
                    onClick = { showLoginDialog = false },
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(16.dp)
                        .background(Color.Black.copy(alpha = 0.6f), CircleShape)
                ) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "Close",
                        tint = Color.White
                    )
                }
            }
        }
    }
}

@Composable
fun SectionHeader(
    title: String,
    onSeeAllClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = title,
            color = CinemaTextPrimary,
            fontSize = 18.sp,
            fontWeight = FontWeight.Bold
        )

        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.clickable(onClick = onSeeAllClick)
        ) {
            Text(
                text = "See all",
                color = CinemaTextSecondary,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium
            )
            Icon(
                imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = "See all",
                tint = CinemaTextSecondary
            )
        }
    }
}
