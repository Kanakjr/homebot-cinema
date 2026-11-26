package com.homebot.cinema.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.homebot.cinema.data.api.Profile
import com.homebot.cinema.ui.theme.CinemaAccent
import com.homebot.cinema.ui.theme.CinemaAccentOrange
import com.homebot.cinema.ui.theme.CinemaBackground
import com.homebot.cinema.ui.theme.CinemaSurfaceVariant
import com.homebot.cinema.ui.theme.CinemaTextSecondary

@Composable
fun TopNavBar(
    currentProfile: Profile?,
    onSearchClick: () -> Unit,
    onProfileClick: () -> Unit,
    modifier: Modifier = Modifier,
    serverUrl: String = "",
    cfToken: String? = null
) {
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .statusBarsPadding(),
        color = CinemaBackground.copy(alpha = 0.95f)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            // Left: Orange Brand Play Badge
            Box(
                modifier = Modifier
                    .size(38.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(CinemaAccentOrange),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.PlayArrow,
                    contentDescription = "HomeBot Cinema",
                    tint = Color.White,
                    modifier = Modifier.size(24.dp)
                )
            }

            // Center: Search Pill Bar
            Surface(
                modifier = Modifier
                    .weight(1f)
                    .height(38.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .clickable(onClick = onSearchClick),
                shape = RoundedCornerShape(20.dp),
                color = CinemaSurfaceVariant
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = "Search",
                        color = CinemaTextSecondary,
                        fontSize = 13.sp
                    )
                    Icon(
                        imageVector = Icons.Default.Search,
                        contentDescription = "Search",
                        tint = CinemaTextSecondary,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }

            // AI Sparkle Action Icon
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .clickable(onClick = onSearchClick),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.AutoAwesome,
                    contentDescription = "AI Assistant",
                    tint = CinemaTextSecondary,
                    modifier = Modifier.size(20.dp)
                )
            }

            // Stats / Equalizer Action Icon
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .clickable(onClick = onSearchClick),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.BarChart,
                    contentDescription = "Stats",
                    tint = CinemaTextSecondary,
                    modifier = Modifier.size(20.dp)
                )
            }

            // Right: Profile Avatar
            val avatarPath = currentProfile?.avatar
            val fullAvatarUrl = when {
                avatarPath.isNullOrBlank() -> null
                avatarPath.startsWith("http") -> avatarPath
                else -> "${serverUrl.trimEnd('/')}$avatarPath"
            }

            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(CinemaAccent)
                    .border(1.5.dp, Color.White.copy(alpha = 0.25f), CircleShape)
                    .clickable(onClick = onProfileClick),
                contentAlignment = Alignment.Center
            ) {
                if (fullAvatarUrl != null) {
                    val context = LocalContext.current
                    val imgReq = ImageRequest.Builder(context)
                        .data(fullAvatarUrl)
                        .crossfade(true)
                        .apply {
                            if (!cfToken.isNullOrBlank()) {
                                addHeader("Cookie", "CF_Authorization=$cfToken")
                                addHeader("CF-Access-Token", cfToken)
                            }
                        }
                        .build()

                    AsyncImage(
                        model = imgReq,
                        contentDescription = currentProfile?.name ?: "Profile",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize()
                    )
                } else {
                    Text(
                        text = currentProfile?.name?.take(1)?.uppercase() ?: "K",
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp
                    )
                }
            }
        }
    }
}
