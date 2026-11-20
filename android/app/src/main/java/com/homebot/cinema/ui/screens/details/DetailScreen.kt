package com.homebot.cinema.ui.screens.details

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.homebot.cinema.data.api.StreamItem
import com.homebot.cinema.ui.theme.CinemaAccentOrange
import com.homebot.cinema.ui.theme.CinemaBackground
import com.homebot.cinema.ui.theme.CinemaCardBg
import com.homebot.cinema.ui.theme.CinemaSurfaceVariant
import com.homebot.cinema.ui.theme.CinemaTextPrimary
import com.homebot.cinema.ui.theme.CinemaTextSecondary

@Composable
fun DetailScreen(
    viewModel: DetailViewModel,
    onBackClick: () -> Unit,
    onPlayStream: (StreamItem, String, Int?, Int?) -> Unit,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()

    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = CinemaBackground
    ) { innerPadding ->
        if (state.isLoading && state.meta == null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = CinemaAccentOrange)
                    Spacer(modifier = Modifier.height(16.dp))
                    Text("Loading title...", color = CinemaTextSecondary, fontSize = 13.sp)
                }
                IconButton(
                    onClick = onBackClick,
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .statusBarsPadding()
                        .padding(16.dp)
                        .size(42.dp)
                        .background(Color.Black.copy(alpha = 0.6f), CircleShape)
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "Back",
                        tint = Color.White
                    )
                }
            }
        } else {
            val meta = state.meta
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(bottom = innerPadding.calculateBottomPadding()),
                contentPadding = PaddingValues(bottom = 40.dp)
            ) {
                // Backdrop with back button safely respecting status bars
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .aspectRatio(16f / 10f)
                    ) {
                        AsyncImage(
                            model = meta?.background ?: meta?.poster,
                            contentDescription = meta?.name,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize()
                        )
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(
                                    Brush.verticalGradient(
                                        colors = listOf(
                                            Color.Black.copy(alpha = 0.6f),
                                            Color.Transparent,
                                            CinemaBackground
                                        )
                                    )
                                )
                        )
                        IconButton(
                            onClick = onBackClick,
                            modifier = Modifier
                                .statusBarsPadding()
                                .padding(16.dp)
                                .size(42.dp)
                                .background(Color.Black.copy(alpha = 0.6f), CircleShape)
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = "Back",
                                tint = Color.White
                            )
                        }
                    }
                }

                // Info Section
                if (meta != null) {
                    item {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp)
                        ) {
                            Text(
                                text = meta.name,
                                color = CinemaTextPrimary,
                                fontSize = 24.sp,
                                fontWeight = FontWeight.Bold
                            )

                            Spacer(modifier = Modifier.height(6.dp))

                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                if (!meta.imdbRating.isNullOrBlank()) {
                                    Surface(
                                        shape = RoundedCornerShape(4.dp),
                                        color = Color(0xFFF5C518)
                                    ) {
                                        Row(
                                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            Icon(
                                                imageVector = Icons.Default.Star,
                                                contentDescription = null,
                                                tint = Color.Black,
                                                modifier = Modifier.size(12.dp)
                                            )
                                            Spacer(modifier = Modifier.width(3.dp))
                                            Text(
                                                text = meta.imdbRating,
                                                color = Color.Black,
                                                fontWeight = FontWeight.Bold,
                                                fontSize = 11.sp
                                            )
                                        }
                                    }
                                }

                                val metaLine = listOfNotNull(
                                    meta.releaseInfo,
                                    meta.runtime,
                                    meta.genres?.joinToString(", ")
                                ).joinToString(" • ")

                                if (metaLine.isNotEmpty()) {
                                    Text(
                                        text = metaLine,
                                        color = CinemaTextSecondary,
                                        fontSize = 12.sp
                                    )
                                }
                            }

                            if (!meta.description.isNullOrBlank()) {
                                Spacer(modifier = Modifier.height(10.dp))
                                Text(
                                    text = meta.description,
                                    color = CinemaTextSecondary,
                                    fontSize = 13.sp,
                                    lineHeight = 18.sp
                                )
                            }

                            Spacer(modifier = Modifier.height(18.dp))
                        }
                    }

                    // For Series: Season / Episode Selector
                    if (!meta.videos.isNullOrEmpty()) {
                        val seasons = meta.videos.map { it.season }.distinct().sorted()
                        item {
                            Column(modifier = Modifier.padding(bottom = 16.dp)) {
                                Text(
                                    text = "Episodes",
                                    color = CinemaTextPrimary,
                                    fontSize = 18.sp,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.padding(horizontal = 16.dp)
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                                LazyRow(
                                    contentPadding = PaddingValues(horizontal = 16.dp),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    items(seasons) { season ->
                                        val isSelected = season == state.selectedSeason
                                        Surface(
                                            shape = RoundedCornerShape(16.dp),
                                            color = if (isSelected) CinemaAccentOrange else CinemaSurfaceVariant,
                                            modifier = Modifier.clickable {
                                                val firstInSeason = meta.videos.firstOrNull { it.season == season }
                                                if (firstInSeason != null) {
                                                    viewModel.selectEpisode(season, firstInSeason.episode, firstInSeason.id)
                                                }
                                            }
                                        ) {
                                            Text(
                                                text = "Season $season",
                                                color = Color.White,
                                                fontSize = 13.sp,
                                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp)
                                            )
                                        }
                                    }
                                }

                                Spacer(modifier = Modifier.height(12.dp))

                                val episodesInSeason = meta.videos.filter { it.season == state.selectedSeason }
                                LazyRow(
                                    contentPadding = PaddingValues(horizontal = 16.dp),
                                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                                ) {
                                    items(episodesInSeason, key = { it.id }) { ep ->
                                        val isEpSelected = ep.episode == state.selectedEpisode
                                        Card(
                                            shape = RoundedCornerShape(10.dp),
                                            colors = CardDefaults.cardColors(
                                                containerColor = if (isEpSelected) CinemaAccentOrange.copy(alpha = 0.25f) else CinemaCardBg
                                            ),
                                            border = if (isEpSelected) androidx.compose.foundation.BorderStroke(1.5.dp, CinemaAccentOrange) else null,
                                            modifier = Modifier
                                                .width(160.dp)
                                                .clickable {
                                                    viewModel.selectEpisode(ep.season, ep.episode, ep.id)
                                                }
                                        ) {
                                            Column(modifier = Modifier.padding(10.dp)) {
                                                Text(
                                                    text = "EP ${ep.episode}",
                                                    color = CinemaAccentOrange,
                                                    fontSize = 11.sp,
                                                    fontWeight = FontWeight.Bold
                                                )
                                                Text(
                                                    text = ep.title ?: "Episode ${ep.episode}",
                                                    color = CinemaTextPrimary,
                                                    fontSize = 13.sp,
                                                    fontWeight = FontWeight.Medium,
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Streams Section
                    item {
                        Text(
                            text = "Streams",
                            color = CinemaTextPrimary,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(horizontal = 16.dp)
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                    }

                    if (state.isStreamsLoading) {
                        item {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 24.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                CircularProgressIndicator(
                                    color = CinemaAccentOrange,
                                    modifier = Modifier.size(28.dp)
                                )
                            }
                        }
                    } else if (state.streams.isEmpty()) {
                        item {
                            Text(
                                text = "No streams loaded. Connect to your server in Settings.",
                                color = CinemaTextSecondary,
                                fontSize = 13.sp,
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                            )
                        }
                    } else {
                        items(state.streams) { stream ->
                            Card(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 5.dp)
                                    .clickable {
                                        onPlayStream(
                                            stream,
                                            meta.name,
                                            if (meta.type == "series") state.selectedSeason else null,
                                            if (meta.type == "series") state.selectedEpisode else null
                                        )
                                    },
                                shape = RoundedCornerShape(10.dp),
                                colors = CardDefaults.cardColors(containerColor = CinemaCardBg)
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(14.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = stream.title ?: stream.name ?: "Stream",
                                            color = CinemaTextPrimary,
                                            fontSize = 13.sp,
                                            fontWeight = FontWeight.Medium,
                                            maxLines = 2,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                    Spacer(modifier = Modifier.width(12.dp))
                                    Button(
                                        onClick = {
                                            onPlayStream(
                                                stream,
                                                meta.name,
                                                if (meta.type == "series") state.selectedSeason else null,
                                                if (meta.type == "series") state.selectedEpisode else null
                                            )
                                        },
                                        colors = ButtonDefaults.buttonColors(containerColor = CinemaAccentOrange),
                                        shape = CircleShape,
                                        contentPadding = PaddingValues(6.dp),
                                        modifier = Modifier.size(36.dp)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.PlayArrow,
                                            contentDescription = "Play",
                                            tint = Color.White,
                                            modifier = Modifier.size(20.dp)
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
