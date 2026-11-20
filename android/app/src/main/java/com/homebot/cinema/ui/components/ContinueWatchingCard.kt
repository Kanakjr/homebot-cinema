package com.homebot.cinema.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.homebot.cinema.data.api.ContinueWatchingItem
import com.homebot.cinema.ui.theme.CinemaAccentOrange
import com.homebot.cinema.ui.theme.CinemaCardBg
import com.homebot.cinema.ui.theme.CinemaProgressBar
import com.homebot.cinema.ui.theme.CinemaProgressTrack
import com.homebot.cinema.ui.theme.CinemaTextPrimary
import com.homebot.cinema.ui.theme.CinemaTextSecondary

@Composable
fun ContinueWatchingCard(
    item: ContinueWatchingItem,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    cardWidth: Dp = 240.dp
) {
    Card(
        modifier = modifier
            .width(cardWidth)
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = CinemaCardBg),
        elevation = CardDefaults.cardElevation(defaultElevation = 3.dp)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
        ) {
            // Backdrop / thumbnail image
            val artUrl = item.thumbnail ?: item.background ?: item.poster ?: ""
            AsyncImage(
                model = artUrl,
                contentDescription = item.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )

            // Dark gradient overlay
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            0.0f to Color.Transparent,
                            0.4f to Color.Transparent,
                            0.75f to Color.Black.copy(alpha = 0.85f),
                            1.0f to Color.Black
                        )
                    )
            )

            // Top-right Status Badge (Pill)
            val badgeText = item.pillLabel
            if (badgeText.isNotEmpty()) {
                val badgeBg = if (item.isAccentPill) CinemaAccentOrange else Color.Black.copy(alpha = 0.75f)
                val textColor = if (item.isAccentPill) Color.Black else Color.White
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(8.dp)
                        .background(badgeBg, RoundedCornerShape(12.dp))
                        .padding(horizontal = 9.dp, vertical = 3.dp)
                ) {
                    Text(
                        text = badgeText,
                        color = textColor,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1
                    )
                }
            }

            // Bottom show and episode info
            Column(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(horizontal = 10.dp, vertical = 8.dp)
            ) {
                if (item.season != null && item.episode != null) {
                    val epText = buildString {
                        append("S${item.season} E${item.episode}")
                        if (!item.episodeTitle.isNullOrBlank()) {
                            append(" • ${item.episodeTitle}")
                        }
                    }
                    Text(
                        text = epText,
                        color = CinemaTextSecondary,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Text(
                    text = item.name,
                    color = CinemaTextPrimary,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }

            // Progress bar if progress > 0
            if (item.progress > 0.01f) {
                LinearProgressIndicator(
                    progress = { item.progress.coerceIn(0f, 1f) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(3.dp)
                        .align(Alignment.BottomCenter),
                    color = CinemaProgressBar,
                    trackColor = CinemaProgressTrack
                )
            }
        }
    }
}
