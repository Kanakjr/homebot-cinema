package com.homebot.cinema.ui.screens.settings

import android.annotation.SuppressLint
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.homebot.cinema.data.preferences.ServerUrlConfig
import com.homebot.cinema.data.preferences.UserPreferences
import com.homebot.cinema.ui.theme.CinemaAccentOrange
import com.homebot.cinema.ui.theme.CinemaBackground
import com.homebot.cinema.ui.theme.CinemaSurfaceVariant
import com.homebot.cinema.ui.theme.CinemaTextPrimary
import com.homebot.cinema.ui.theme.CinemaTextSecondary
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(
    userPreferences: UserPreferences,
    onBackClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val serverUrl by userPreferences.serverUrl.collectAsState(initial = "")
    val cfToken by userPreferences.cfToken.collectAsState(initial = null)
    val directPlay by userPreferences.directPlayEnabled.collectAsState(initial = true)
    val scope = rememberCoroutineScope()

    var urlInput by remember(serverUrl) { mutableStateOf(serverUrl) }
    var showLoginDialog by remember { mutableStateOf(false) }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = CinemaBackground,
        topBar = {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(
                    onClick = onBackClick,
                    modifier = Modifier
                        .size(40.dp)
                        .background(Color.Black.copy(alpha = 0.4f), CircleShape)
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "Back",
                        tint = Color.White
                    )
                }
                Spacer(modifier = Modifier.size(16.dp))
                Text(
                    text = "Settings",
                    color = CinemaTextPrimary,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )
            }
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 20.dp)
        ) {
            Text(
                text = "Server Configuration",
                color = CinemaTextSecondary,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold
            )

            Spacer(modifier = Modifier.height(10.dp))

            OutlinedTextField(
                value = urlInput,
                onValueChange = { urlInput = it },
                label = { Text("Server Origin URL") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = CinemaAccentOrange,
                    unfocusedBorderColor = CinemaSurfaceVariant,
                    focusedLabelColor = CinemaAccentOrange,
                    unfocusedLabelColor = CinemaTextSecondary,
                    focusedTextColor = CinemaTextPrimary,
                    unfocusedTextColor = CinemaTextPrimary
                )
            )

            Spacer(modifier = Modifier.height(12.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(
                    onClick = {
                        scope.launch {
                            ServerUrlConfig.normalizeServerUrl(urlInput)?.let { normalized ->
                                userPreferences.setServerUrl(normalized)
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = CinemaAccentOrange),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text("Save URL", color = Color.White, fontWeight = FontWeight.Bold)
                }

                Button(
                    onClick = { showLoginDialog = true },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (cfToken != null) Color(0xFF2E7D32) else CinemaSurfaceVariant
                    ),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Icon(
                        imageVector = if (cfToken != null) Icons.Default.Check else Icons.Default.Lock,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = if (cfToken != null) "Cloudflare Active" else "Sign In (Cloudflare)",
                        color = Color.White,
                        fontWeight = FontWeight.Medium
                    )
                }
            }

            if (cfToken != null) {
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "Authenticated with Cloudflare Access token",
                    color = Color(0xFF81C784),
                    fontSize = 11.sp
                )
            }

            Spacer(modifier = Modifier.height(30.dp))

            Text(
                text = "Playback",
                color = CinemaTextSecondary,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold
            )

            Spacer(modifier = Modifier.height(10.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Direct Play (Stream file directly)",
                        color = CinemaTextPrimary,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Medium
                    )
                    Text(
                        text = "Streams original video stream without server remuxing when supported",
                        color = CinemaTextSecondary,
                        fontSize = 12.sp
                    )
                }
                Switch(
                    checked = directPlay,
                    onCheckedChange = { checked ->
                        scope.launch {
                            userPreferences.setDirectPlayEnabled(checked)
                        }
                    },
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = Color.White,
                        checkedTrackColor = CinemaAccentOrange
                    )
                )
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
                            @SuppressLint("SetJavaScriptEnabled")
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
