package com.metti.app;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.Locale;

public final class MainActivity extends Activity {
    private static final int METTI_BG = Color.rgb(251, 239, 238);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(METTI_BG);
        getWindow().setNavigationBarColor(METTI_BG);
        getWindow().getDecorView().setBackgroundColor(METTI_BG);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);

        WebView webView = new WebView(this);
        webView.setBackgroundColor(METTI_BG);
        // With targetSdk 34 the WebView is laid out below the native status
        // bar, so no extra CSS inset is needed inside the prototype.
        String nativeInsetsCss = String.format(Locale.US, ".app-scroll{padding-top:0!important}");
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                view.evaluateJavascript(
                        "(function(){"
                                + "var l=document.createElement('link');l.rel='stylesheet';l.href='native.css';document.head.appendChild(l);"
                                + "var old=document.getElementById('native-insets');if(old)old.remove();"
                                + "var s=document.createElement('style');s.id='native-insets';s.textContent='"
                                + nativeInsetsCss
                                + "';document.head.appendChild(s);"
                                + "})();",
                        null
                );
            }
        });
        webView.setWebChromeClient(new WebChromeClient());

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setDefaultTextEncodingName("UTF-8");

        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }
}
