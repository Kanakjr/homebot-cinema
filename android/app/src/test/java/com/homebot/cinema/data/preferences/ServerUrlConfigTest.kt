package com.homebot.cinema.data.preferences

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServerUrlConfigTest {

    @Test
    fun normalizeServerUrl_acceptsPublicHttpsAndLanHttp() {
        assertEquals("https://cinema.example.com", ServerUrlConfig.normalizeServerUrl("cinema.example.com/"))
        assertEquals("https://cinema.example.com:8443", ServerUrlConfig.normalizeServerUrl("  https://cinema.example.com:8443/  "))
        assertEquals("http://10.0.2.2:3099", ServerUrlConfig.normalizeServerUrl("10.0.2.2:3099/"))
        assertEquals("http://homeserver.local:3002", ServerUrlConfig.normalizeServerUrl("homeserver.local:3002"))
    }

    @Test
    fun normalizeServerUrl_rejectsUnsafeOrBlankInputs() {
        assertNull(ServerUrlConfig.normalizeServerUrl(""))
        assertNull(ServerUrlConfig.normalizeServerUrl("   "))
        assertNull(ServerUrlConfig.normalizeServerUrl("javascript:alert(1)"))
        assertNull(ServerUrlConfig.normalizeServerUrl("file:///etc/passwd"))
        assertNull(ServerUrlConfig.normalizeServerUrl("https://not valid"))
    }

    @Test
    fun cookieSpec_derivesDynamicHostAndSecureFlag() {
        val httpsSpec = ServerUrlConfig.cookieSpec("https://media.example.org/app", "jwt-abc")
        assertEquals(
            "https://media.example.org" to "CF_Authorization=jwt-abc; Path=/; Domain=media.example.org; Secure; HttpOnly",
            httpsSpec
        )

        val localSpec = ServerUrlConfig.cookieSpec("http://10.0.2.2:3099", "jwt-dev")
        assertEquals(
            "http://10.0.2.2:3099" to "CF_Authorization=jwt-dev; Path=/; Domain=10.0.2.2; HttpOnly",
            localSpec
        )

        assertNull(ServerUrlConfig.cookieSpec("https://media.example.org", "  "))
        assertNull(ServerUrlConfig.cookieSpec("not-a-url", "jwt-abc"))
    }
}
