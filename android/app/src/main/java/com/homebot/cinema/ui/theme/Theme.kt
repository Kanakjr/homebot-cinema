package com.homebot.cinema.ui.theme

import android.app.Activity
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val DarkColorScheme = darkColorScheme(
    primary = CinemaAccentOrange,
    secondary = CinemaAccent,
    tertiary = CinemaAccentOrange,
    background = CinemaBackground,
    surface = CinemaSurface,
    surfaceVariant = CinemaSurfaceVariant,
    onPrimary = Color.White,
    onSecondary = Color.White,
    onBackground = CinemaTextPrimary,
    onSurface = CinemaTextPrimary,
    onSurfaceVariant = CinemaTextSecondary
)

@Composable
fun CinemaTheme(
    content: @Composable () -> Unit
) {
    val colorScheme = DarkColorScheme
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window
            if (window != null) {
                window.statusBarColor = android.graphics.Color.TRANSPARENT
                window.navigationBarColor = android.graphics.Color.TRANSPARENT
                val controller = WindowCompat.getInsetsController(window, view)
                controller.isAppearanceLightStatusBars = false
                controller.isAppearanceLightNavigationBars = false
            }
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
