package com.metti.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.Locale;

public final class MainActivity extends Activity {
    private static final int METTI_BG = Color.rgb(251, 239, 238);
    private WebView webView;
    private int nativeTopInset;
    private int nativeBottomInset;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(METTI_BG);
        getWindow().setNavigationBarColor(METTI_BG);
        getWindow().getDecorView().setBackgroundColor(METTI_BG);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);

        webView = new WebView(this);
        webView.setBackgroundColor(METTI_BG);
        // Android 15+ enforces edge-to-edge for apps targeting recent API
        // levels. Keep the WebView content clear of the system bars while
        // retaining the full-screen layout on older Android versions.
        webView.setOnApplyWindowInsetsListener((view, insets) -> {
            int top = 0;
            int bottom = 0;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets stableBars = insets.getInsetsIgnoringVisibility(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                if (bars.top == 0) bars = stableBars;
                if (bars.bottom == 0) bars = android.graphics.Insets.of(bars.left, bars.top, bars.right, stableBars.bottom);
                top = bars.top;
                bottom = bars.bottom;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
            }
            nativeTopInset = top;
            nativeBottomInset = bottom;
            view.setPadding(0, 0, 0, 0);
            view.post(this::applyNativeInsetsToWeb);
            return insets;
        });
        String nativeInsetsCss = String.format(Locale.US,
                ".app-scroll{padding-top:0!important;padding-bottom:calc(112px + var(--metti-native-bottom-inset,0px))!important}.auth-gate-scroll{padding-top:calc(20px + var(--metti-native-top-inset,0px))!important}.bottom-nav{bottom:calc(var(--metti-native-bottom-inset,0px) - 44px)!important}");
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url != null && url.startsWith("metti://")) {
                    handleAuthRedirect(Uri.parse(url));
                    return true;
                }
                if (url != null && url.startsWith("https://" + "fkicjvawvaddjdmcpiei.supabase.co/auth/v1/authorize")) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
                    catch (Exception ignored) { view.loadUrl(url); }
                    return true;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                view.evaluateJavascript(
                        "(function(){"
                                + "var l=document.createElement('link');l.rel='stylesheet';l.href='native.css';document.head.appendChild(l);"
                                + "var old=document.getElementById('native-insets');if(old)old.remove();"
                                + "var s=document.createElement('style');s.id='native-insets';s.textContent='"
                                + nativeInsetsCss
                                + "';document.head.appendChild(s);"
                                + "document.documentElement.style.setProperty('--metti-native-top-inset','" + nativeTopInset + "px');"
                                + "document.documentElement.style.setProperty('--metti-native-bottom-inset','" + nativeBottomInset + "px');"
                                + "})();",
                        null
                );
            }
        });
        webView.setWebChromeClient(new WebChromeClient());

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setDefaultTextEncodingName("UTF-8");

        setContentView(webView);
        if (!handleAuthRedirect(getIntent().getData())) webView.loadUrl("file:///android_asset/index.html");
    }

    private void applyNativeInsetsToWeb() {
        if (webView == null) return;
        webView.evaluateJavascript(
                "(function(){var r=document.documentElement;"
                        + "r.style.setProperty('--metti-native-top-inset','" + nativeTopInset + "px');"
                        + "r.style.setProperty('--metti-native-bottom-inset','" + nativeBottomInset + "px');})();",
                null
        );
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleAuthRedirect(intent.getData());
    }

    private boolean handleAuthRedirect(Uri uri) {
        if (uri == null || !"metti".equalsIgnoreCase(uri.getScheme()) || webView == null) return false;
        StringBuilder url = new StringBuilder("file:///android_asset/index.html");
        if (uri.getEncodedQuery() != null) url.append('?').append(uri.getEncodedQuery());
        if (uri.getEncodedFragment() != null) url.append('#').append(uri.getEncodedFragment());
        webView.loadUrl(url.toString());
        return true;
    }
}
