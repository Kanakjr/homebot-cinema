package com.homebot.cinema

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import com.homebot.cinema.data.preferences.ServerUrlConfig
import com.homebot.cinema.data.preferences.UserPreferences
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    companion object {
        const val ACTION_CHANGE_SERVER = "com.homebot.cinema.ACTION_CHANGE_SERVER"
        const val EXTRA_SHOW_SERVER_SETUP = "show_setup"
    }

    private lateinit var rootLayout: FrameLayout
    private lateinit var webView: WebView
    private lateinit var fullscreenContainer: FrameLayout
    private lateinit var setupOverlay: FrameLayout
    private lateinit var errorOverlay: FrameLayout
    private lateinit var serverInput: EditText
    private lateinit var setupErrorText: TextView
    private lateinit var errorDetailText: TextView

    private lateinit var userPreferences: UserPreferences
    private var activeServerUrl: String? = null
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private val transparentPoster: Bitmap by lazy {
        Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT)
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val app = application as CinemaApplication
        userPreferences = app.userPreferences

        val bgColor = ContextCompat.getColor(this, R.color.cinema_background)
        rootLayout = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(bgColor)
        }

        ViewCompat.setOnApplyWindowInsetsListener(rootLayout) { v, insets ->
            if (customView != null) {
                v.setPadding(0, 0, 0, 0)
            } else {
                val bars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
                )
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            }
            insets
        }

        fullscreenContainer = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
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
            setBackgroundColor(bgColor)
        }

        setupOverlay = buildSetupOverlay()
        errorOverlay = buildErrorOverlay()

        rootLayout.addView(webView)
        rootLayout.addView(errorOverlay)
        rootLayout.addView(setupOverlay)
        rootLayout.addView(fullscreenContainer)
        setContentView(rootLayout)

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            loadWithOverviewMode = true
            useWideViewPort = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = userAgentString.replace("; wv", "")
        }

        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)

        webView.webChromeClient = object : WebChromeClient() {
            override fun getDefaultVideoPoster(): Bitmap = transparentPoster

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
                ViewCompat.requestApplyInsets(rootLayout)
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
                ViewCompat.requestApplyInsets(rootLayout)
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                persistCfTokenIfTrusted(url)
                return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (url != null && url != "about:blank") {
                    persistCfTokenIfTrusted(url)
                    errorOverlay.visibility = View.GONE
                }

                view?.evaluateJavascript(
                    """
                    if (typeof window.qt === 'undefined') { window.qt = {}; }
                    document.documentElement.dataset.shell = 'android';
                    """.trimIndent(),
                    null
                )
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    val code = error?.errorCode ?: 0
                    // Skip intentional navigation aborts (ERROR_UNSUPPORTED_SCHEME / reload cancel = -1)
                    if (code != -1) {
                        val desc = error?.description?.toString()?.takeIf { it.isNotBlank() } ?: "Unable to reach server"
                        showErrorOverlay("$desc (${activeServerUrl ?: ""})")
                    }
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (customView != null) {
                    webView.webChromeClient?.onHideCustomView()
                } else if (setupOverlay.visibility == View.VISIBLE && activeServerUrl != null) {
                    setupOverlay.visibility = View.GONE
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

        lifecycleScope.launch {
            val saved = userPreferences.configuredServerUrl.first()
            val forceSetup = shouldForceSetup(intent)
            if (saved == null || forceSetup) {
                activeServerUrl = saved
                showSetupOverlay(saved)
            } else {
                connectToServer(saved)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (shouldForceSetup(intent)) {
            showSetupOverlay(activeServerUrl)
        }
    }

    private fun shouldForceSetup(intent: Intent?): Boolean {
        if (intent == null) return false
        return intent.action == ACTION_CHANGE_SERVER ||
            intent.getBooleanExtra(EXTRA_SHOW_SERVER_SETUP, false)
    }

    private fun persistCfTokenIfTrusted(url: String) {
        val configuredHost = ServerUrlConfig.hostOf(activeServerUrl) ?: return
        val currentHost = ServerUrlConfig.hostOf(url) ?: return
        if (configuredHost != currentHost) return
        val cookies = CookieManager.getInstance().getCookie(url) ?: return
        val cfMatch = Regex("CF_Authorization=([^;]+)").find(cookies) ?: return
        val token = cfMatch.groupValues[1]
        if (token.isNotBlank()) {
            lifecycleScope.launch {
                userPreferences.setCfToken(token)
            }
        }
    }

    private fun connectToServer(serverUrl: String) {
        activeServerUrl = serverUrl
        serverInput.clearFocus()
        val imm = getSystemService(INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.hideSoftInputFromWindow(serverInput.windowToken, 0)
        setupOverlay.visibility = View.GONE
        errorOverlay.visibility = View.GONE

        lifecycleScope.launch {
            val cfToken = userPreferences.cfToken.first()
            val cookieManager = CookieManager.getInstance()
            cookieManager.setAcceptCookie(true)
            cookieManager.setAcceptThirdPartyCookies(webView, false)

            if (!cfToken.isNullOrBlank()) {
                ServerUrlConfig.cookieSpec(serverUrl, cfToken)?.let { (origin, cookie) ->
                    cookieManager.setCookie(origin, cookie)
                    cookieManager.flush()
                }
            }

            webView.loadUrl(serverUrl)
        }
    }

    private fun showSetupOverlay(prefillUrl: String?) {
        serverInput.setText(prefillUrl ?: "")
        serverInput.setSelection(serverInput.text.length)
        setupErrorText.visibility = View.GONE
        errorOverlay.visibility = View.GONE
        setupOverlay.visibility = View.VISIBLE
    }

    private fun showErrorOverlay(message: String) {
        errorDetailText.text = message
        errorOverlay.visibility = View.VISIBLE
    }

    private fun buildSetupOverlay(): FrameLayout {
        val surfaceColor = ContextCompat.getColor(this, R.color.cinema_surface)
        val cardColor = ContextCompat.getColor(this, R.color.cinema_card_bg)
        val accentColor = ContextCompat.getColor(this, R.color.cinema_primary_accent)
        val textPrimary = ContextCompat.getColor(this, R.color.white)
        val textSecondary = ContextCompat.getColor(this, R.color.text_secondary)

        val backdrop = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(ContextCompat.getColor(context, R.color.cinema_background))
            setPadding(dp(24), dp(24), dp(24), dp(24))
            visibility = View.GONE
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
            )
            setPadding(dp(24), dp(24), dp(24), dp(24))
            background = GradientDrawable().apply {
                setColor(surfaceColor)
                cornerRadius = dp(16).toFloat()
                setStroke(dp(1), Color.argb(40, 255, 255, 255))
            }
        }

        val title = TextView(this).apply {
            setText(R.string.server_setup_title)
            setTextColor(textPrimary)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }

        val subtitle = TextView(this).apply {
            setText(R.string.server_setup_subtitle)
            setTextColor(textSecondary)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setPadding(0, dp(8), 0, dp(18))
        }

        val label = TextView(this).apply {
            setText(R.string.server_url)
            setTextColor(textPrimary)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setPadding(0, 0, 0, dp(6))
        }

        serverInput = EditText(this).apply {
            setHint(R.string.server_setup_hint)
            setTextColor(textPrimary)
            setHintTextColor(textSecondary)
            setSingleLine(true)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = GradientDrawable().apply {
                setColor(cardColor)
                cornerRadius = dp(10).toFloat()
                setStroke(dp(1), Color.argb(60, 255, 255, 255))
            }
        }

        setupErrorText = TextView(this).apply {
            setTextColor(Color.parseColor("#FF8A8A"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setPadding(0, dp(8), 0, 0)
            visibility = View.GONE
        }

        val connectBtn = Button(this).apply {
            setText(R.string.connect)
            setTextColor(textPrimary)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setPadding(dp(16), dp(12), dp(16), dp(12))
            val lp = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            lp.topMargin = dp(18)
            layoutParams = lp
            background = GradientDrawable().apply {
                setColor(accentColor)
                cornerRadius = dp(24).toFloat()
            }
            setOnClickListener {
                val normalized = ServerUrlConfig.normalizeServerUrl(serverInput.text.toString())
                if (normalized == null) {
                    setupErrorText.text = "Enter a valid http:// or https:// server address."
                    setupErrorText.visibility = View.VISIBLE
                } else {
                    setupErrorText.visibility = View.GONE
                    lifecycleScope.launch {
                        userPreferences.setServerUrl(normalized)
                        connectToServer(normalized)
                    }
                }
            }
        }

        card.addView(title)
        card.addView(subtitle)
        card.addView(label)
        card.addView(serverInput)
        card.addView(setupErrorText)
        card.addView(connectBtn)
        backdrop.addView(card)
        return backdrop
    }

    private fun buildErrorOverlay(): FrameLayout {
        val surfaceColor = ContextCompat.getColor(this, R.color.cinema_surface)
        val accentColor = ContextCompat.getColor(this, R.color.cinema_primary_accent)
        val textPrimary = ContextCompat.getColor(this, R.color.white)
        val textSecondary = ContextCompat.getColor(this, R.color.text_secondary)

        val container = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(ContextCompat.getColor(context, R.color.cinema_background))
            setPadding(dp(24), dp(24), dp(24), dp(24))
            visibility = View.GONE
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
            )
            setPadding(dp(24), dp(24), dp(24), dp(24))
            background = GradientDrawable().apply {
                setColor(surfaceColor)
                cornerRadius = dp(16).toFloat()
            }
        }

        val heading = TextView(this).apply {
            text = "Connection error"
            setTextColor(textPrimary)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 19f)
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }

        errorDetailText = TextView(this).apply {
            setTextColor(textSecondary)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setPadding(0, dp(8), 0, dp(18))
        }

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
        }

        val switchBtn = Button(this).apply {
            setText(R.string.switch_server)
            setTextColor(textPrimary)
            setPadding(dp(14), dp(10), dp(14), dp(10))
            background = GradientDrawable().apply {
                setColor(Color.argb(35, 255, 255, 255))
                cornerRadius = dp(20).toFloat()
            }
            setOnClickListener {
                showSetupOverlay(activeServerUrl)
            }
        }

        val retryBtn = Button(this).apply {
            text = "Retry"
            setTextColor(textPrimary)
            setPadding(dp(16), dp(10), dp(16), dp(10))
            val lp = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            lp.marginStart = dp(10)
            layoutParams = lp
            background = GradientDrawable().apply {
                setColor(accentColor)
                cornerRadius = dp(20).toFloat()
            }
            setOnClickListener {
                errorOverlay.visibility = View.GONE
                val target = activeServerUrl
                if (target != null) webView.loadUrl(target) else showSetupOverlay(null)
            }
        }

        actions.addView(switchBtn)
        actions.addView(retryBtn)
        card.addView(heading)
        card.addView(errorDetailText)
        card.addView(actions)
        container.addView(card)
        return container
    }

    private fun dp(value: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics
        ).toInt()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
