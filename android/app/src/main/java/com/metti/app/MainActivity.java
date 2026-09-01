package com.metti.app;

import android.app.Activity;
import android.content.ContentValues;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.speech.RecognizerIntent;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.WebChromeClient;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Locale;

public final class MainActivity extends Activity {
    private static final int METTI_BG = Color.rgb(251, 239, 238);
    private static final int FILE_CHOOSER_REQUEST_CODE = 1001;
    private static final int VOICE_REQUEST_CODE = 1002;
    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri pendingCameraUri;
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
        webView.addJavascriptInterface(new MettiAndroidBridge(), "MettiAndroid");
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
                ".app-scroll{padding-top:0!important;padding-bottom:calc(88px + var(--metti-native-bottom-inset,0px))!important}.auth-gate-scroll{padding-top:calc(20px + var(--metti-native-top-inset,0px))!important}.bottom-nav{bottom:calc(var(--metti-native-bottom-inset,0px) - 44px)!important}");
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
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams fileChooserParams) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = callback;
                try {
                    if (fileChooserParams.isCaptureEnabled() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        ContentValues values = new ContentValues();
                        values.put(MediaStore.Images.Media.DISPLAY_NAME, "metti-photo-" + System.currentTimeMillis() + ".jpg");
                        values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                        values.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Metti");
                        Uri cameraUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                        Intent cameraIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        if (cameraUri != null && cameraIntent.resolveActivity(getPackageManager()) != null) {
                            pendingCameraUri = cameraUri;
                            cameraIntent.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                            cameraIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                            startActivityForResult(cameraIntent, FILE_CHOOSER_REQUEST_CODE);
                            return true;
                        }
                        if (cameraUri != null) getContentResolver().delete(cameraUri, null, null);
                    }
                    Intent intent = fileChooserParams.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("image/*");
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false);
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST_CODE);
                    return true;
                } catch (ActivityNotFoundException | SecurityException error) {
                    MainActivity.this.filePathCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
            }
        });

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        // Android's picker returns a content:// Uri. WebView must be allowed
        // to read that Uri when it populates the HTML file input.
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setDefaultTextEncodingName("UTF-8");

        setContentView(webView);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    this::handleBackPressed
            );
        }
        if (!handleAuthRedirect(getIntent().getData())) webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onBackPressed() {
        handleBackPressed();
    }

    private void handleBackPressed() {
        if (webView == null) {
            finish();
            return;
        }
        webView.evaluateJavascript(
                "(function(){try{return window.MettiNativeBack ? !!window.MettiNativeBack() : false;}catch(e){return false;}})()",
                value -> { if (!"true".equals(value)) finish(); }
        );
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == VOICE_REQUEST_CODE) {
            if (resultCode == RESULT_OK && data != null) {
                ArrayList<String> matches = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                if (matches != null && !matches.isEmpty()) dispatchVoiceEvent("metti:voice-result", matches.get(0));
                else dispatchVoiceEvent("metti:voice-error", "");
            } else {
                dispatchVoiceEvent("metti:voice-error", "");
            }
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        if (requestCode == FILE_CHOOSER_REQUEST_CODE && filePathCallback != null) {
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            if ((results == null || results.length == 0) && resultCode == RESULT_OK && pendingCameraUri != null) {
                results = new Uri[]{pendingCameraUri};
            }
            if (resultCode != RESULT_OK && pendingCameraUri != null) {
                getContentResolver().delete(pendingCameraUri, null, null);
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
            pendingCameraUri = null;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private void dispatchVoiceEvent(String eventName, String value) {
        if (webView == null) return;
        webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('" + eventName + "',{detail:" + JSONObject.quote(value == null ? "" : value) + "}));",
                null
        );
    }

    private final class MettiAndroidBridge {
        @JavascriptInterface
        public void startVoiceInput(String language) {
            runOnUiThread(() -> {
                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language == null || language.isEmpty() ? "ru-RU" : language);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Говорите");
                try {
                    startActivityForResult(intent, VOICE_REQUEST_CODE);
                } catch (ActivityNotFoundException | SecurityException error) {
                    dispatchVoiceEvent("metti:voice-error", "");
                }
            });
        }
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
