package com.homebot.cinema.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.homebot.cinema.data.api.MetaItem
import com.homebot.cinema.ui.theme.CinemaCardBg
import com.homebot.cinema.ui.theme.CinemaTextPrimary
import com.homebot.cinema.ui.theme.CinemaTextSecondary

@Composable
fun MetaItemCard(
    item: MetaItem,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    cardWidth: androidx.compose.ui.unit.Dp = 135.dp
) {
    Column(
        modifier = modifier
            .width(cardWidth)
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(bottom = 6.dp)
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(2f / 3f),
            shape = RoundedCornerShape(10.dp),
            colors = CardDefaults.cardColors(containerColor = CinemaCardBg),
            elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
        ) {
            AsyncImage(
                model = item.poster,
                contentDescription = item.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxWidth()
            )
        }

        Spacer(modifier = Modifier.height(6.dp))

        Text(
            text = item.name,
            color = CinemaTextPrimary,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )

        val subtext = item.year ?: item.releaseInfo ?: item.genres?.firstOrNull() ?: item.genre?.firstOrNull()
        if (subtext != null) {
            Text(
                text = subtext,
                color = CinemaTextSecondary,
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}
