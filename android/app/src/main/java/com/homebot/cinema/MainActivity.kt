package com.homebot.cinema

import android.annotation.SuppressLint
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private lateinit var fullscreenContainer: FrameLayout

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Enable modern Android 15 edge-to-edge
        enableEdgeToEdge()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val app = application as CinemaApplication
        val userPreferences = app.userPreferences

        val rootLayout = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#0e0e10"))
        }

        fullscreenContainer = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            visibility = View.GONE
            setBackgroundColor(Color.BLACK)
        }

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#0e0e10"))
        }

        rootLayout.addView(webView)
        rootLayout.addView(fullscreenContainer)
        setContentView(rootLayout)

        // Enable Chrome DevTools inspection for verification
        WebView.setWebContentsDebuggingEnabled(true)

        // Configure WebSettings for maximum performance and media capabilities
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = true
            allowContentAccess = true
            loadWithOverviewMode = true
            useWideViewPort = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            userAgentString = userAgentString.replace("; wv", "")
        }

        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)

        // HTML5 Fullscreen handler (for video player)
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                if (customView != null) {
                    callback?.onCustomViewHidden()
                    return
                }
                customView = view
                customViewCallback = callback
                webView.visibility = View.GONE
                fullscreenContainer.visibility = View.VISIBLE
                fullscreenContainer.addView(view)
                requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }

            override fun onHideCustomView() {
                if (customView == null) return
                fullscreenContainer.removeView(customView)
                fullscreenContainer.visibility = View.GONE
                webView.visibility = View.VISIBLE
                customViewCallback?.onCustomViewHidden()
                customView = null
                customViewCallback = null
                requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                val cookieManager = CookieManager.getInstance()
                val cookies = cookieManager.getCookie(url) ?: ""
                val cfMatch = Regex("CF_Authorization=([^;]+)").find(cookies)
                if (cfMatch != null) {
                    val token = cfMatch.groupValues[1]
                    lifecycleScope.launch {
                        userPreferences.setCfToken(token)
                    }
                }
                return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                url?.let {
                    val cookies = CookieManager.getInstance().getCookie(it) ?: ""
                    val cfMatch = Regex("CF_Authorization=([^;]+)").find(cookies)
                    if (cfMatch != null) {
                        val token = cfMatch.groupValues[1]
                        lifecycleScope.launch {
                            userPreferences.setCfToken(token)
                        }
                    }
                }

                view?.evaluateJavascript(
                    """
                    if (typeof window.qt === 'undefined') { window.qt = {}; }
                    document.documentElement.dataset.shell = 'android';
                    """.trimIndent(),
                    null
                )
            }
        }

        // Hardware back button navigation in web history
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (customView != null) {
                    webView.webChromeClient?.onHideCustomView()
                } else {
                    webView.evaluateJavascript(
                        "(function() { if (window.location.hash && window.location.hash !== '#/' && window.location.hash !== '#') { window.history.back(); return true; } return false; })()",
                    ) { result ->
                        if (result != "true") {
                            if (webView.canGoBack()) {
                                webView.goBack()
                            } else {
                                isEnabled = false
                                onBackPressedDispatcher.onBackPressed()
                            }
                        }
                    }
                }
            }
        })

        // Setup CookieManager with existing CF token and load server URL
        lifecycleScope.launch {
            val serverUrl = userPreferences.serverUrl.first()
            val cfToken = userPreferences.cfToken.first()

            val cookieManager = CookieManager.getInstance()
            cookieManager.setAcceptCookie(true)
            cookieManager.setAcceptThirdPartyCookies(webView, true)

            if (!cfToken.isNullOrBlank()) {
                val cookie = "CF_Authorization=$cfToken; Path=/; Domain=cinema.kanakjr.in; Secure; HttpOnly"
                cookieManager.setCookie("https://cinema.kanakjr.in", cookie)
                cookieManager.setCookie(serverUrl, cookie)
                cookieManager.flush()
            }

            webView.loadUrl(serverUrl)
        }
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
