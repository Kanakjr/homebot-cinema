package com.homebot.cinema.data.preferences

import java.net.URI
import java.util.Locale

object ServerUrlConfig {

    private val LOCAL_HOST_REGEX = Regex(
        "^(localhost|127\\.0\\.0\\.1|10\\.0\\.2\\.2|10\\..*|192\\.168\\..*|.*\\.local|.*\\.lan|.*\\.home\\.arpa)$",
        RegexOption.IGNORE_CASE
    )

    fun normalizeServerUrl(raw: String): String? {
        val trimmed = raw.trim().trimEnd('/')
        if (trimmed.isEmpty() || trimmed.any { it.isWhitespace() }) return null

        val withScheme = if (trimmed.contains("://")) {
            trimmed
        } else {
            val candidateHost = trimmed.substringBefore('/').substringBefore(':').substringBefore('?')
            val scheme = if (LOCAL_HOST_REGEX.matches(candidateHost)) "http" else "https"
            "$scheme://$trimmed"
        }

        val uri = try {
            URI(withScheme)
        } catch (_: Exception) {
            return null
        }

        val scheme = uri.scheme?.lowercase(Locale.US) ?: return null
        if (scheme != "http" && scheme != "https") return null
        val host = uri.host?.takeIf { it.isNotBlank() } ?: return null
        val portPart = if (uri.port > 0) ":${uri.port}" else ""
        val pathPart = uri.rawPath?.trimEnd('/') ?: ""
        return "$scheme://$host$portPart$pathPart"
    }

    fun originFor(serverUrl: String): String? {
        val uri = try {
            URI(serverUrl)
        } catch (_: Exception) {
            return null
        }
        val scheme = uri.scheme?.lowercase(Locale.US) ?: return null
        if (scheme != "http" && scheme != "https") return null
        val host = uri.host?.takeIf { it.isNotBlank() } ?: return null
        val portPart = if (uri.port > 0) ":${uri.port}" else ""
        return "$scheme://$host$portPart"
    }

    fun cookieSpec(serverUrl: String, cfToken: String): Pair<String, String>? {
        val token = cfToken.trim()
        if (token.isEmpty()) return null
        val origin = originFor(serverUrl) ?: return null
        val uri = URI(origin)
        val host = uri.host ?: return null
        val secure = if (uri.scheme.equals("https", ignoreCase = true)) "; Secure" else ""
        val cookie = "CF_Authorization=$token; Path=/; Domain=$host$secure; HttpOnly"
        return origin to cookie
    }

    fun hostOf(url: String?): String? {
        if (url.isNullOrBlank()) return null
        return try {
            URI(url).host?.lowercase(Locale.US)
        } catch (_: Exception) {
            null
        }
    }
}
