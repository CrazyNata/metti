package com.metti.app;

import android.app.Activity;
import android.content.ContentValues;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.net.Uri;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.RadialGradient;
import android.graphics.Shader;
import android.media.ExifInterface;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.speech.RecognizerIntent;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.WebChromeClient;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation;
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentationResult;
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenter;
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions;
import com.google.mediapipe.framework.image.BitmapImageBuilder;
import com.google.mediapipe.framework.image.ByteBufferExtractor;
import com.google.mediapipe.framework.image.MPImage;
import com.google.mediapipe.tasks.components.containers.NormalizedKeypoint;
import com.google.mediapipe.tasks.core.BaseOptions;
import com.google.mediapipe.tasks.vision.interactivesegmenter.InteractiveSegmenter;
import com.google.mediapipe.tasks.vision.interactivesegmenter.InteractiveSegmenterOptions;
import com.google.mediapipe.tasks.vision.interactivesegmenter.Stroke;
import org.opencv.android.OpenCVLoader;
import org.opencv.android.Utils;
import org.opencv.core.Core;
import org.opencv.core.CvType;
import org.opencv.core.Mat;
import org.opencv.core.Scalar;
import org.opencv.core.Size;
import org.opencv.imgproc.Imgproc;
import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.nio.FloatBuffer;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int METTI_BG = Color.rgb(251, 239, 238);
    private static final int METTI_LOADING_BG = Color.rgb(23, 21, 15);
    private static final int FILE_CHOOSER_REQUEST_CODE = 1001;
    private static final int VOICE_REQUEST_CODE = 1002;
    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri pendingCameraUri;
    private int nativeTopInset;
    private int nativeBottomInset;
    private final ExecutorService imageExecutor = Executors.newSingleThreadExecutor();
    private SubjectSegmenter subjectSegmenter;
    private InteractiveSegmenter interactiveSegmenter;
    private Boolean interactiveSegmenterAvailable;
    private Boolean openCvAvailable;
    private int debugMaskSequence;
    private static final int MAX_IMAGE_EDGE = 1400;
    private static final String INTERACTIVE_MODEL_ASSET = "interactive_segmentation.task";
    private static final int EDITORIAL_BACKGROUND = Color.rgb(240, 233, 223);
    private static final int EDITORIAL_BACKGROUND_TOP = Color.rgb(250, 246, 239);
    private static final int EDITORIAL_BACKGROUND_BOTTOM = Color.rgb(225, 216, 204);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyLoadingSystemBars(true);

        webView = new WebView(this);
        webView.setBackgroundColor(METTI_LOADING_BG);
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
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse response = openProcessedImage(request.getUrl());
                return response != null ? response : super.shouldInterceptRequest(view, request);
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                WebResourceResponse response = openProcessedImage(Uri.parse(url));
                return response != null ? response : super.shouldInterceptRequest(view, url);
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
                                + "if(window.MettiAndroid&&window.MettiAndroid.debugSaveSession)window.MettiAndroid.debugSaveSession(localStorage.getItem('metti.supabase.session')||'');"
                                + "})();",
                        null
                );
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                Log.d("MettiWeb", message.message() + " @" + message.lineNumber());
                return true;
            }

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

    private void applyLoadingSystemBars(boolean loading) {
        int color = loading ? METTI_LOADING_BG : METTI_BG;
        getWindow().setStatusBarColor(color);
        getWindow().setNavigationBarColor(color);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setNavigationBarDividerColor(color);
        }
        getWindow().getDecorView().setBackgroundColor(color);
        getWindow().getDecorView().setSystemUiVisibility(loading
                ? 0
                : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        if (webView != null) webView.setBackgroundColor(color);
    }

    private final class MettiAndroidBridge {
        @JavascriptInterface
        public void setLoadingSystemBars(boolean loading) {
            runOnUiThread(() -> applyLoadingSystemBars(loading));
        }

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

        @JavascriptInterface
        public void removeImageBackground(String dataUrl, String callbackId) {
            removeImageBackground(dataUrl, callbackId, "");
        }

        @JavascriptInterface
        public void removeImageBackground(String dataUrl, String callbackId, String itemType) {
            Log.i("MettiImageProcessing", "Request " + callbackId + " type=" + itemType + " data=" + (dataUrl == null ? 0 : dataUrl.length()));
            if (!isNativeImageProcessingAvailable()) {
                dispatchImageProcessingResult(callbackId, "", "");
                return;
            }
            imageExecutor.execute(() -> {
                Bitmap source = null;
                try {
                    source = decodeImage(dataUrl);
                    if (source == null) throw new IOException("Не удалось декодировать фотографию.");
                    if (isLocalSegmentationDevice()) {
                        processWithInteractiveSegmenter(source, callbackId, itemType);
                        source = null;
                        return;
                    }
                    Bitmap sourceBitmap = source;
                    runOnUiThread(() -> runSubjectSegmentation(sourceBitmap, callbackId));
                } catch (Exception error) {
                    if (source != null) source.recycle();
                    dispatchImageProcessingResult(callbackId, "", error.getMessage());
                }
            });
        }

        @JavascriptInterface
        public boolean isNativeImageProcessingAvailable() {
            return MainActivity.this.isNativeImageProcessingAvailable();
        }

        @JavascriptInterface
        public void releaseProcessedImage(String processedUrl) {
            imageExecutor.execute(() -> {
                File file = processedImageFile(processedUrl);
                if (file != null) file.delete();
            });
        }

        @JavascriptInterface
        public String readProcessedImage(String processedUrl) {
            File file = processedImageFile(processedUrl);
            if (file == null || !file.isFile()) return "";
            try (FileInputStream input = new FileInputStream(file);
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[16 * 1024];
                int count;
                while ((count = input.read(buffer)) >= 0) {
                    if (count > 0) output.write(buffer, 0, count);
                }
                return Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
            } catch (IOException error) {
                Log.w("MettiImageProcessing", "Could not read processed image", error);
                return "";
            }
        }

        @JavascriptInterface
        public void debugSaveSession(String session) {
            if (session == null || session.isEmpty()) return;
            File file = new File(getCacheDir(), "metti-debug-session.json");
            try (FileOutputStream output = new FileOutputStream(file)) {
                output.write(session.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            } catch (IOException error) {
                Log.w("MettiImageProcessing", "Could not save debug session", error);
            }
        }
    }

    private boolean isNativeImageProcessingAvailable() {
        if (isLocalSegmentationDevice()) return ensureInteractiveSegmenterAvailable();
        return true;
    }

    private boolean isLocalSegmentationDevice() {
        String device = ((Build.MANUFACTURER == null ? "" : Build.MANUFACTURER) + " "
                + (Build.BRAND == null ? "" : Build.BRAND) + " "
                + (Build.MODEL == null ? "" : Build.MODEL)).toLowerCase(Locale.US);
        // The Play-services subject-segmentation beta crashes in its native
        // Drishti worker on this Android 15 Motorola family. Use the local
        // general-object model there instead of returning a broken WebView
        // flood-fill mask or the old rectangle-based GrabCut result.
        return Build.VERSION.SDK_INT >= 35 && (device.contains("motorola") || device.contains("moto"));
    }

    private boolean ensureInteractiveSegmenterAvailable() {
        if (interactiveSegmenterAvailable != null) return interactiveSegmenterAvailable;
        synchronized (this) {
            if (interactiveSegmenterAvailable != null) return interactiveSegmenterAvailable;
            try {
                BaseOptions baseOptions = BaseOptions.builder()
                        .setModelAssetPath(INTERACTIVE_MODEL_ASSET)
                        .build();
                InteractiveSegmenterOptions options = InteractiveSegmenterOptions.builder()
                        .setBaseOptions(baseOptions)
                        .build();
                interactiveSegmenter = InteractiveSegmenter.createFromOptions(this, options);
                interactiveSegmenterAvailable = true;
            } catch (Throwable error) {
                Log.e("MettiImageProcessing", "Interactive segmenter failed to initialize", error);
                if (interactiveSegmenter != null) {
                    try {
                        interactiveSegmenter.close();
                    } catch (Exception ignored) {
                        // Ignore cleanup failures while reporting unavailable state.
                    }
                    interactiveSegmenter = null;
                }
                interactiveSegmenterAvailable = false;
            }
        }
        return interactiveSegmenterAvailable;
    }

    private void processWithInteractiveSegmenter(Bitmap source, String callbackId, String itemType) {
        try {
            if (!ensureInteractiveSegmenterAvailable()) {
                throw new IOException("Локальный обработчик фотографий недоступен.");
            }
            Bitmap editorial = createInteractiveEditorialImage(source, itemType);
            if (editorial == null) {
                throw new IOException("Не удалось аккуратно выделить предмет на фотографии.");
            }
            try {
                File outputFile = writeEditorialImage(editorial);
                dispatchImageProcessingResult(callbackId, processedImageUrl(outputFile), "");
            } finally {
                if (!editorial.isRecycled()) editorial.recycle();
            }
        } catch (Exception error) {
            dispatchImageProcessingResult(callbackId, "", error.getMessage());
        } finally {
            if (source != null && !source.isRecycled()) source.recycle();
        }
    }

    /**
     * Uses a positive point in the middle of the wardrobe photo to select the
     * item itself. This is deliberately prompt-based: salient-object models
     * often include a cup, table or box when it touches the item, while the
     * interactive model can keep those neighbouring objects out of the mask.
     */
    private Bitmap createInteractiveEditorialImage(Bitmap source) {
        return createInteractiveEditorialImage(source, "");
    }

    private Bitmap createInteractiveEditorialImage(Bitmap source, String itemType) {
        if (source == null || interactiveSegmenter == null) return null;
        MPImage inputImage = null;
        MPImage maskImage = null;
        Bitmap maskBitmap = null;
        Bitmap masked = null;
        try {
            inputImage = new BitmapImageBuilder(source).build();
            interactiveSegmenter.setImage(inputImage);

            List<Stroke> prompts;
            GlassesGeometry glassesGeometry = null;
            float centerY = 0.64f;
            if ("glasses".equalsIgnoreCase(String.valueOf(itemType))) {
                glassesGeometry = estimateGlassesGeometry(source);
                centerY = glassesGeometry.centerY;
                // Keep the lasso broad. Hough circles are useful for the
                // vertical prior, but reflections can place one circle on a
                // case and a narrow horizontal lasso would crop the frame.
                float leftX = 0.04f;
                float rightX = 0.96f;
                float halfWidth = rightX - leftX;
                float halfHeight = 0.19f;
                float topY = Math.max(0.18f, centerY - halfHeight);
                float bottomY = Math.min(0.96f, centerY + halfHeight);
                // Keep the original lasso prior, then explicitly mark the
                // strips immediately outside the glasses as background. Do
                // not add positive points: they can make a whole tabletop a
                // foreground region when the lens is transparent.
                List<Stroke> glassesPrompts = new ArrayList<>();
                float[] lassoX = {
                        leftX,
                        leftX + halfWidth * 0.14f,
                        leftX + halfWidth * 0.32f,
                        leftX + halfWidth * 0.50f,
                        leftX + halfWidth * 0.68f,
                        leftX + halfWidth * 0.86f,
                        rightX
                };
                List<NormalizedKeypoint> lassoPoints = Arrays.asList(
                        NormalizedKeypoint.create(lassoX[0], topY + 0.03f),
                        NormalizedKeypoint.create(lassoX[1], topY),
                        NormalizedKeypoint.create(lassoX[2], topY - 0.01f),
                        NormalizedKeypoint.create(lassoX[3], topY + 0.01f),
                        NormalizedKeypoint.create(lassoX[4], topY - 0.01f),
                        NormalizedKeypoint.create(lassoX[5], topY),
                        NormalizedKeypoint.create(lassoX[6], topY + 0.03f),
                        NormalizedKeypoint.create(lassoX[6], bottomY - 0.03f),
                        NormalizedKeypoint.create(lassoX[5], bottomY),
                        NormalizedKeypoint.create(lassoX[4], bottomY + 0.01f),
                        NormalizedKeypoint.create(lassoX[3], bottomY - 0.01f),
                        NormalizedKeypoint.create(lassoX[2], bottomY + 0.01f),
                        NormalizedKeypoint.create(lassoX[1], bottomY),
                        NormalizedKeypoint.create(lassoX[0], bottomY - 0.03f)
                );
                glassesPrompts.add(Stroke.builder()
                        .setBrushMode(Stroke.BrushMode.LASSO)
                        .setPoints(lassoPoints)
                        .setCompleted(true)
                        .build());
                float[] negativeX = {
                        Math.max(0.03f, leftX - 0.08f),
                        (leftX + rightX) * 0.5f,
                        Math.min(0.97f, rightX + 0.08f)
                };
                float[] negativeY = {
                        Math.max(0.08f, topY - 0.06f),
                        Math.min(0.98f, bottomY + 0.06f)
                };
                for (float y : negativeY) {
                    for (float x : negativeX) {
                        glassesPrompts.add(Stroke.builder()
                                .setBrushMode(Stroke.BrushMode.NEGATIVE)
                                .setPoints(Collections.singletonList(NormalizedKeypoint.create(x, y)))
                                .setCompleted(true)
                                .build());
                    }
                }
                prompts = glassesPrompts;
            } else if ("shoes".equalsIgnoreCase(String.valueOf(itemType))) {
                // A pair has empty space in the middle. Use two independent
                // positive taps so the model selects both objects, not the
                // background between them.
                prompts = Arrays.asList(
                        Stroke.builder()
                                .setBrushMode(Stroke.BrushMode.POSITIVE)
                                .setPoints(Collections.singletonList(NormalizedKeypoint.create(0.32f, 0.5f)))
                                .setCompleted(true)
                                .build(),
                        Stroke.builder()
                                .setBrushMode(Stroke.BrushMode.POSITIVE)
                                .setPoints(Collections.singletonList(NormalizedKeypoint.create(0.68f, 0.5f)))
                                .setCompleted(true)
                                .build()
                );
            } else if ("jewelry".equalsIgnoreCase(String.valueOf(itemType))
                    || "earrings".equalsIgnoreCase(String.valueOf(itemType))) {
                // Earrings are rings, so their geometric centre is background.
                // Tap the gold stud and the outer ring on each side instead.
                prompts = Arrays.asList(
                        Stroke.builder()
                                .setBrushMode(Stroke.BrushMode.POSITIVE)
                                .setPoints(Arrays.asList(
                                        NormalizedKeypoint.create(0.27f, 0.43f),
                                        NormalizedKeypoint.create(0.22f, 0.55f)))
                                .setCompleted(true)
                                .build(),
                        Stroke.builder()
                                .setBrushMode(Stroke.BrushMode.POSITIVE)
                                .setPoints(Arrays.asList(
                                        NormalizedKeypoint.create(0.65f, 0.43f),
                                        NormalizedKeypoint.create(0.60f, 0.55f)))
                                .setCompleted(true)
                                .build()
                );
            } else {
                prompts = Collections.singletonList(Stroke.builder()
                        .setBrushMode(Stroke.BrushMode.POSITIVE)
                        .setPoints(Collections.singletonList(NormalizedKeypoint.create(0.5f, 0.5f)))
                        .setCompleted(true)
                        .build());
            }
            maskImage = interactiveSegmenter.segment(prompts);
            if (maskImage == null || maskImage.getWidth() <= 0 || maskImage.getHeight() <= 0) return null;

            int maskWidth = maskImage.getWidth();
            int maskHeight = maskImage.getHeight();
            int pixelCount = maskWidth * maskHeight;
            FloatBuffer buffer = ByteBufferExtractor.extract(maskImage).asFloatBuffer();
            if (buffer.remaining() < pixelCount) return null;
            float[] values = new float[pixelCount];
            buffer.get(values);
            float minimum = Float.MAX_VALUE;
            float maximum = -Float.MAX_VALUE;
            double average = 0d;
            int[] maskPixels = new int[pixelCount];
            for (int index = 0; index < pixelCount; index++) {
                float confidence = values[index];
                minimum = Math.min(minimum, confidence);
                maximum = Math.max(maximum, confidence);
                average += confidence;
                // Keep the hard background out while preserving antialiased
                // edges around thin spectacle frames, straps and sleeves.
                float alpha = (confidence - 0.20f) / 0.62f;
                alpha = Math.max(0f, Math.min(1f, alpha));
                maskPixels[index] = Color.argb(Math.round(alpha * 255f), 255, 255, 255);
            }
            int debugSequence = ++debugMaskSequence;
            writeDebugMask(maskPixels, maskWidth, maskHeight, "raw-" + debugSequence);
            if ("glasses".equalsIgnoreCase(String.valueOf(itemType))) {
                refineGlassesMask(source, maskPixels, maskWidth, maskHeight, glassesGeometry);
            }
            writeDebugMask(maskPixels, maskWidth, maskHeight, "refined-" + debugSequence);
            Log.i("MettiImageProcessing", "Interactive mask " + maskWidth + "x" + maskHeight
                    + " min=" + minimum + " max=" + maximum + " avg=" + (average / pixelCount));
            maskBitmap = Bitmap.createBitmap(maskWidth, maskHeight, Bitmap.Config.ARGB_8888);
            maskBitmap.setPixels(maskPixels, 0, maskWidth, 0, 0, maskWidth, maskHeight);
            if (maskWidth != source.getWidth() || maskHeight != source.getHeight()) {
                Bitmap scaledMask = Bitmap.createScaledBitmap(
                        maskBitmap, source.getWidth(), source.getHeight(), true);
                maskBitmap.recycle();
                maskBitmap = scaledMask;
            }

            int width = source.getWidth();
            int height = source.getHeight();
            int[] sourcePixels = new int[width * height];
            int[] maskAtSourceSize = new int[width * height];
            int[] maskedPixels = new int[width * height];
            source.getPixels(sourcePixels, 0, width, 0, 0, width, height);
            maskBitmap.getPixels(maskAtSourceSize, 0, width, 0, 0, width, height);
            for (int index = 0; index < sourcePixels.length; index++) {
                int sourcePixel = sourcePixels[index];
                int alpha = (Color.alpha(sourcePixel) * Color.alpha(maskAtSourceSize[index])) / 255;
                maskedPixels[index] = Color.argb(
                        alpha,
                        Color.red(sourcePixel),
                        Color.green(sourcePixel),
                        Color.blue(sourcePixel)
                );
            }
            masked = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            masked.setPixels(maskedPixels, 0, width, 0, 0, width, height);
            return compositeEditorialImage(masked, width, height);
        } catch (Throwable error) {
            Log.e("MettiImageProcessing", "Interactive segmentation failed", error);
            return null;
        } finally {
            if (masked != null && !masked.isRecycled()) masked.recycle();
            if (maskBitmap != null && !maskBitmap.isRecycled()) maskBitmap.recycle();
            if (maskImage != null) maskImage.close();
            if (inputImage != null) inputImage.close();
        }
    }

    private static final class GlassesGeometry {
        final float centerY;
        final float leftX;
        final float rightX;
        final float halfHeight;

        GlassesGeometry(float centerY, float leftX, float rightX, float halfHeight) {
            this.centerY = centerY;
            this.leftX = leftX;
            this.rightX = rightX;
            this.halfHeight = halfHeight;
        }
    }

    private GlassesGeometry estimateGlassesGeometry(Bitmap source) {
        if (source == null || !ensureOpenCvAvailable()) {
            return new GlassesGeometry(0.64f, 0.08f, 0.92f, 0.23f);
        }
        Bitmap working = source;
        Mat rgba = new Mat();
        Mat gray = new Mat();
        Mat edges = new Mat();
        Mat circles = new Mat();
        try {
            int targetWidth = Math.min(320, source.getWidth());
            if (source.getWidth() > targetWidth) {
                working = Bitmap.createScaledBitmap(source, targetWidth,
                        Math.max(1, Math.round(source.getHeight() * targetWidth / (float) source.getWidth())), true);
            }
            Utils.bitmapToMat(working, rgba);
            Imgproc.cvtColor(rgba, gray, Imgproc.COLOR_BGRA2GRAY);
            Imgproc.GaussianBlur(gray, gray, new Size(5, 5), 0);
            int width = gray.cols();
            int height = gray.rows();
            Imgproc.HoughCircles(
                    gray,
                    circles,
                    Imgproc.HOUGH_GRADIENT,
                    1.2,
                    Math.max(24, width * 0.16),
                    100,
                    16,
                    Math.max(12, Math.round(width * 0.07f)),
                    Math.max(24, Math.round(width * 0.30f))
            );
            double bestPairScore = Double.NEGATIVE_INFINITY;
            float bestPairCenter = -1f;
            float bestPairLeft = -1f;
            float bestPairRight = -1f;
            float bestPairHalfHeight = 0.23f;
            for (int leftIndex = 0; leftIndex < circles.cols(); leftIndex++) {
                double[] left = circles.get(0, leftIndex);
                if (left == null || left.length < 3) continue;
                if (left[1] < height * 0.24 || left[1] > height * 0.90) continue;
                for (int rightIndex = leftIndex + 1; rightIndex < circles.cols(); rightIndex++) {
                    double[] right = circles.get(0, rightIndex);
                    if (right == null || right.length < 3) continue;
                    if (right[1] < height * 0.24 || right[1] > height * 0.90) continue;
                    double separation = right[0] - left[0];
                    if (separation < width * 0.22 || separation > width * 0.72) continue;
                    if (Math.abs(right[1] - left[1]) > height * 0.13) continue;
                    double radiusDifference = Math.abs(right[2] - left[2]);
                    if (radiusDifference > width * 0.10) continue;
                    double score = left[2] + right[2]
                            - radiusDifference * 1.5
                            - Math.abs(separation - width * 0.42) * 0.20
                            + (left[1] + right[1]) * 0.12;
                    if (score > bestPairScore) {
                        bestPairScore = score;
                        bestPairCenter = (float) ((left[1] + right[1]) / (2d * height));
                        bestPairLeft = (float) left[0] / width;
                        bestPairRight = (float) right[0] / width;
                        bestPairHalfHeight = Math.max(0.17f, Math.min(0.28f,
                                (float) (Math.max(left[2], right[2]) / height * 1.55d)));
                    }
                }
            }
            if (bestPairCenter > 0f) {
                Log.i("MettiImageProcessing", "Glasses Hough pair center=" + bestPairCenter
                        + " x=" + bestPairLeft + "," + bestPairRight + " score=" + bestPairScore);
                // The glasses in wardrobe photos occupy the lower half. A
                // Hough pair detected above that zone is usually the cup or
                // the storage case, so keep a conservative lower bound.
                float center = Math.max(0.52f, Math.min(0.84f, bestPairCenter));
                float lensHalfWidth = 0.22f;
                return new GlassesGeometry(
                        center,
                        Math.max(0.03f, bestPairLeft - lensHalfWidth),
                        Math.min(0.97f, bestPairRight + lensHalfWidth),
                        0.19f
                );
            }
            Imgproc.Canny(gray, edges, 65, 145);
            width = edges.cols();
            height = edges.rows();
            byte[] pixels = new byte[width * height];
            edges.get(0, 0, pixels);
            int halfWindow = Math.max(8, Math.round(height * 0.14f));
            int minCenter = Math.round(height * 0.36f);
            int maxCenter = Math.round(height * 0.84f);
            double bestScore = Double.NEGATIVE_INFINITY;
            float bestCenter = 0.64f;
            for (int center = minCenter; center <= maxCenter; center += 2) {
                int top = Math.max(0, center - halfWindow);
                int bottom = Math.min(height - 1, center + halfWindow);
                int leftEdges = 0;
                int rightEdges = 0;
                int centralEdges = 0;
                for (int y = top; y <= bottom; y++) {
                    int row = y * width;
                    for (int x = 0; x < width; x++) {
                        if ((pixels[row + x] & 0xff) < 100) continue;
                        if (x < Math.round(width * 0.43f)) leftEdges++;
                        else if (x > Math.round(width * 0.57f)) rightEdges++;
                        else centralEdges++;
                    }
                }
                double symmetry = Math.min(leftEdges, rightEdges);
                double score = symmetry * 2.0 + centralEdges * 0.35;
                score *= 0.78 + 0.44 * (center / (double) height);
                if (score > bestScore) {
                    bestScore = score;
                    bestCenter = center / (float) height;
                }
            }
            Log.i("MettiImageProcessing", "Glasses center estimate=" + bestCenter + " edgeScore=" + bestScore);
            return new GlassesGeometry(
                    Math.max(0.52f, Math.min(0.84f, bestCenter)),
                    0.08f,
                    0.92f,
                    0.23f
            );
        } catch (Throwable error) {
            Log.w("MettiImageProcessing", "Glasses center estimate skipped", error);
            return new GlassesGeometry(0.64f, 0.08f, 0.92f, 0.23f);
        } finally {
            if (working != source && working != null && !working.isRecycled()) working.recycle();
            rgba.release();
            gray.release();
            edges.release();
            circles.release();
        }
    }

    /**
     * The interactive mask is a useful semantic starting point, but a pair of
     * dark glasses can touch a bright cup in a phone photo. GrabCut refines
     * that local boundary using the actual colours while keeping the model's
     * item selection as the prior.
     */
    private void refineGlassesMask(Bitmap source, int[] maskPixels, int maskWidth, int maskHeight, GlassesGeometry geometry) {
        if (source == null || maskPixels == null || !ensureOpenCvAvailable()) return;
        float centerY = geometry == null ? 0.64f : geometry.centerY;
        Bitmap working = source;
        Mat bgra = new Mat();
        Mat bgr = new Mat();
        Mat grabMask = new Mat();
        Mat foregroundMask = new Mat();
        Mat componentLabels = new Mat();
        Mat componentStats = new Mat();
        Mat componentCentroids = new Mat();
        Mat closeKernel = new Mat();
        Mat backgroundModel = new Mat();
        Mat foregroundModel = new Mat();
        try {
            if (source.getWidth() != maskWidth || source.getHeight() != maskHeight) {
                working = Bitmap.createScaledBitmap(source, maskWidth, maskHeight, true);
            }
            Utils.bitmapToMat(working, bgra);
            Imgproc.cvtColor(bgra, bgr, Imgproc.COLOR_BGRA2BGR);

            // Interactive segmentation is the semantic prior. Keep GrabCut
            // near the detected lens centres so the case, cup and table do not
            // become part of the catalogue image.
            float roiTop = Math.max(0.12f, centerY - 0.24f);
            float roiBottom = Math.min(0.98f, centerY + 0.24f);
            float seedTop = Math.max(0.10f, centerY - 0.13f);
            float seedBottom = Math.min(0.98f, centerY + 0.13f);
            int[] sourcePixels = new int[maskPixels.length];
            working.getPixels(sourcePixels, 0, maskWidth, 0, 0, maskWidth, maskHeight);
            byte[] labels = new byte[maskPixels.length];
            int definiteForeground = 0;
            int definiteBackground = 0;
            for (int index = 0; index < maskPixels.length; index++) {
                int alpha = Color.alpha(maskPixels[index]);
                int y = index / maskWidth;
                float normalizedY = y / (float) maskHeight;
                int sourcePixel = sourcePixels[index];
                int red = Color.red(sourcePixel);
                int green = Color.green(sourcePixel);
                int blue = Color.blue(sourcePixel);
                int luminance = (299 * red + 587 * green + 114 * blue) / 1000;
                int chroma = Math.max(red, Math.max(green, blue))
                        - Math.min(red, Math.min(green, blue));
                int gradient = 0;
                if (index > 0 && index + 1 < sourcePixels.length
                        && index / maskWidth == (index - 1) / maskWidth
                        && index / maskWidth == (index + 1) / maskWidth) {
                    int left = sourcePixels[index - 1];
                    int right = sourcePixels[index + 1];
                    int leftLuminance = (299 * Color.red(left)
                            + 587 * Color.green(left)
                            + 114 * Color.blue(left)) / 1000;
                    int rightLuminance = (299 * Color.red(right)
                            + 587 * Color.green(right)
                            + 114 * Color.blue(right)) / 1000;
                    gradient = Math.abs(luminance - leftLuminance)
                            + Math.abs(luminance - rightLuminance);
                }
                boolean insideRoi = normalizedY >= roiTop && normalizedY <= roiBottom;
                boolean centralBand = normalizedY >= seedTop && normalizedY <= seedBottom;
                // Dark frames/lenses, coloured tortoiseshell and sharp frame
                // edges are useful definite seeds. Pale frames remain
                // probable foreground through the interactive mask.
                boolean glassesLike = luminance < 135 || chroma > 40 || gradient > 52;
                byte label;
                if (!insideRoi || alpha < 24) {
                    label = (byte) Imgproc.GC_BGD;
                    definiteBackground++;
                } else if (centralBand && alpha > 155 && glassesLike) {
                    label = (byte) Imgproc.GC_FGD;
                    definiteForeground++;
                } else if (alpha > 28) {
                    label = (byte) Imgproc.GC_PR_FGD;
                } else {
                    label = (byte) Imgproc.GC_PR_BGD;
                }
                labels[index] = label;
            }
            if (definiteForeground < 20 || definiteBackground < 20) return;

            grabMask.create(maskHeight, maskWidth, CvType.CV_8UC1);
            grabMask.put(0, 0, labels);
            Imgproc.grabCut(
                    bgr,
                    grabMask,
                    new org.opencv.core.Rect(0, 0, maskWidth, maskHeight),
                    backgroundModel,
                    foregroundModel,
                    5,
                    Imgproc.GC_INIT_WITH_MASK
            );
            grabMask.get(0, 0, labels);
            foregroundMask.create(maskHeight, maskWidth, CvType.CV_8UC1);
            byte[] foregroundPixels = new byte[labels.length];
            for (int index = 0; index < labels.length; index++) {
                int label = labels[index] & 0xff;
                foregroundPixels[index] = (byte) ((label == Imgproc.GC_FGD
                        || label == Imgproc.GC_PR_FGD) ? 255 : 0);
            }
            foregroundMask.put(0, 0, foregroundPixels);
            closeKernel = Imgproc.getStructuringElement(
                    Imgproc.MORPH_ELLIPSE,
                    new Size(5, 5)
            );
            Imgproc.morphologyEx(foregroundMask, foregroundMask, Imgproc.MORPH_CLOSE, closeKernel);

            // Never flood-fill a spectacle lens. Its transparent centre is
            // exactly where the old implementation pulled in cases and
            // tabletops. Select the compact component around the lens pair.
            int components = Imgproc.connectedComponentsWithStats(
                    foregroundMask,
                    componentLabels,
                    componentStats,
                    componentCentroids,
                    8,
                    CvType.CV_32S
            );
            int primary = -1;
            double primaryScore = Double.NEGATIVE_INFINITY;
            double[] componentAreas = new double[components];
            double[] componentLefts = new double[components];
            double[] componentTops = new double[components];
            double[] componentWidths = new double[components];
            double[] componentHeights = new double[components];
            boolean[] plausibleComponents = new boolean[components];
            for (int label = 1; label < components; label++) {
                double[] areaValue = componentStats.get(label, Imgproc.CC_STAT_AREA);
                double[] leftValue = componentStats.get(label, Imgproc.CC_STAT_LEFT);
                double[] topValue = componentStats.get(label, Imgproc.CC_STAT_TOP);
                double[] widthValue = componentStats.get(label, Imgproc.CC_STAT_WIDTH);
                double[] heightValue = componentStats.get(label, Imgproc.CC_STAT_HEIGHT);
                if (areaValue == null || leftValue == null || topValue == null
                        || widthValue == null || heightValue == null
                        || areaValue.length == 0 || leftValue.length == 0
                        || topValue.length == 0 || widthValue.length == 0
                        || heightValue.length == 0) continue;
                double area = areaValue[0];
                if (area < maskPixels.length * 0.0015d) continue;
                double left = leftValue[0];
                double top = topValue[0];
                double componentWidth = widthValue[0];
                double componentHeight = heightValue[0];
                double componentCenterY = (top + componentHeight * 0.5d) / maskHeight;
                double areaFraction = area / maskPixels.length;
                double widthFraction = componentWidth / maskWidth;
                double heightFraction = componentHeight / maskHeight;
                double centerDistance = Math.abs(componentCenterY - centerY);
                if (areaFraction > 0.62d || widthFraction < 0.035d
                        || heightFraction < 0.025d || centerDistance > 0.34d) {
                    continue;
                }
                componentAreas[label] = area;
                componentLefts[label] = left;
                componentTops[label] = top;
                componentWidths[label] = componentWidth;
                componentHeights[label] = componentHeight;
                plausibleComponents[label] = true;
                double topExcess = Math.max(0d, centerY - 0.17d - top / maskHeight);
                double bottomExcess = Math.max(0d,
                        (top + componentHeight) / maskHeight - centerY - 0.20d);
                double sidePenalty = Math.max(0d, 0.18d - left / maskWidth)
                        + Math.max(0d, (left + componentWidth) / maskWidth - 0.82d);
                double score = areaFraction * 2.1d
                        + widthFraction * 1.7d
                        - heightFraction * 1.5d
                        - centerDistance * 5.5d
                        - topExcess * 7.5d
                        - bottomExcess * 4.0d
                        - sidePenalty * 2.0d;
                if (widthFraction > 0.35d && widthFraction < 0.92d) score += 0.35d;
                if (heightFraction < 0.42d) score += 0.25d;
                if (areaFraction > 0.58d) score -= 2.5d;
                if (score > primaryScore) {
                    primaryScore = score;
                    primary = label;
                }
            }
            if (primary < 1) return;

            // A spectacle frame is frequently split into two components by a
            // reflection or by a transparent bridge. Keeping only the largest
            // component drops one lens; keeping every component brings back
            // the case/table. Prefer a plausible, horizontally aligned pair
            // and then add only tiny bridge/temple pieces between them.
            int pairLeft = -1;
            int pairRight = -1;
            double pairScore = Double.NEGATIVE_INFINITY;
            for (int first = 1; first < components; first++) {
                if (!plausibleComponents[first]) continue;
                double firstCenterX = (componentLefts[first] + componentWidths[first] * 0.5d) / maskWidth;
                double firstCenterY = (componentTops[first] + componentHeights[first] * 0.5d) / maskHeight;
                double firstAreaFraction = componentAreas[first] / maskPixels.length;
                double firstHeightFraction = componentHeights[first] / maskHeight;
                for (int second = first + 1; second < components; second++) {
                    if (!plausibleComponents[second]) continue;
                    double secondCenterX = (componentLefts[second] + componentWidths[second] * 0.5d) / maskWidth;
                    double secondCenterY = (componentTops[second] + componentHeights[second] * 0.5d) / maskHeight;
                    double secondAreaFraction = componentAreas[second] / maskPixels.length;
                    double secondHeightFraction = componentHeights[second] / maskHeight;
                    double separation = Math.abs(secondCenterX - firstCenterX);
                    double verticalDifference = Math.abs(secondCenterY - firstCenterY);
                    double areaRatio = Math.min(firstAreaFraction, secondAreaFraction)
                            / Math.max(firstAreaFraction, secondAreaFraction);
                    double left = Math.min(componentLefts[first], componentLefts[second]);
                    double right = Math.max(
                            componentLefts[first] + componentWidths[first],
                            componentLefts[second] + componentWidths[second]
                    );
                    double unionWidth = (right - left) / maskWidth;
                    if (separation < 0.10d || separation > 0.82d
                            || verticalDifference > 0.16d
                            || areaRatio < 0.16d
                            || unionWidth < 0.28d || unionWidth > 0.96d
                            || firstHeightFraction > 0.48d || secondHeightFraction > 0.48d) {
                        continue;
                    }
                    double centreY = (firstCenterY + secondCenterY) * 0.5d;
                    double score = (firstAreaFraction + secondAreaFraction) * 3.4d
                            + unionWidth * 1.3d
                            + areaRatio * 0.55d
                            - verticalDifference * 5.0d
                            - Math.abs(centreY - centerY) * 4.5d;
                    if (unionWidth > 0.42d && unionWidth < 0.92d) score += 0.25d;
                    if (score > pairScore) {
                        pairScore = score;
                        if (firstCenterX <= secondCenterX) {
                            pairLeft = first;
                            pairRight = second;
                        } else {
                            pairLeft = second;
                            pairRight = first;
                        }
                    }
                }
            }

            boolean[] keepComponents = new boolean[components];
            double pairLeftX = 0d;
            double pairRightX = 1d;
            if (pairLeft > 0 && pairRight > 0 && pairScore > primaryScore - 0.15d) {
                keepComponents[pairLeft] = true;
                keepComponents[pairRight] = true;
                pairLeftX = componentLefts[pairLeft] / maskWidth;
                pairRightX = (componentLefts[pairRight] + componentWidths[pairRight]) / maskWidth;
                double pairCenterY = ((componentTops[pairLeft] + componentHeights[pairLeft] * 0.5d)
                        + (componentTops[pairRight] + componentHeights[pairRight] * 0.5d)) * 0.5d / maskHeight;
                for (int label = 1; label < components; label++) {
                    if (!plausibleComponents[label] || keepComponents[label]) continue;
                    double componentCenterX = (componentLefts[label] + componentWidths[label] * 0.5d) / maskWidth;
                    double componentCenterY = (componentTops[label] + componentHeights[label] * 0.5d) / maskHeight;
                    double areaFraction = componentAreas[label] / maskPixels.length;
                    boolean betweenLenses = componentCenterX >= pairLeftX - 0.02d
                            && componentCenterX <= pairRightX + 0.02d;
                    if (betweenLenses && areaFraction < 0.16d
                            && Math.abs(componentCenterY - pairCenterY) < 0.14d) {
                        keepComponents[label] = true;
                    }
                }
                Log.i("MettiImageProcessing", "Glasses components pair=" + pairLeft + "+" + pairRight
                        + " score=" + pairScore + " primary=" + primaryScore);
            } else {
                keepComponents[primary] = true;
                Log.i("MettiImageProcessing", "Glasses component=" + primary + " score=" + primaryScore);
            }

            byte[] selectedPixels = new byte[foregroundPixels.length];
            foregroundMask.get(0, 0, selectedPixels);
            int[] componentValues = new int[maskPixels.length];
            componentLabels.get(0, 0, componentValues);
            for (int index = 0; index < maskPixels.length; index++) {
                int component = componentValues[index];
                if (component < 1 || !keepComponents[component]
                        || (selectedPixels[index] & 0xff) == 0) {
                    maskPixels[index] = Color.TRANSPARENT;
                } else {
                    int alpha = Color.alpha(maskPixels[index]);
                    maskPixels[index] = Color.argb(
                            Math.round(alpha * 0.88f),
                            255,
                            255,
                            255
                    );
                }
            }
        } catch (Throwable error) {
            Log.w("MettiImageProcessing", "Glasses colour refinement skipped", error);
        } finally {
            if (working != source && working != null && !working.isRecycled()) working.recycle();
            bgra.release();
            bgr.release();
            grabMask.release();
            foregroundMask.release();
            componentLabels.release();
            componentStats.release();
            componentCentroids.release();
            closeKernel.release();
            backgroundModel.release();
            foregroundModel.release();
        }
    }

    private void writeDebugMask(int[] maskPixels, int width, int height, String name) {
        if (maskPixels == null || width <= 0 || height <= 0) return;
        Bitmap debug = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        int[] pixels = new int[maskPixels.length];
        for (int index = 0; index < maskPixels.length; index++) {
            int alpha = Color.alpha(maskPixels[index]);
            pixels[index] = Color.rgb(alpha, alpha, alpha);
        }
        debug.setPixels(pixels, 0, width, 0, 0, width, height);
        File file = new File(getCacheDir(), "metti-debug-mask-" + name + ".png");
        try (FileOutputStream output = new FileOutputStream(file)) {
            debug.compress(Bitmap.CompressFormat.PNG, 100, output);
        } catch (IOException error) {
            Log.w("MettiImageProcessing", "Could not save debug mask", error);
        } finally {
            debug.recycle();
        }
    }

    private boolean ensureOpenCvAvailable() {
        if (openCvAvailable != null) return openCvAvailable;
        synchronized (this) {
            if (openCvAvailable == null) {
                try {
                    openCvAvailable = OpenCVLoader.initLocal();
                } catch (Throwable ignored) {
                    openCvAvailable = false;
                }
            }
        }
        return openCvAvailable;
    }

    private SubjectSegmenter getSubjectSegmenter() {
        if (subjectSegmenter == null) {
            SubjectSegmenterOptions options = new SubjectSegmenterOptions.Builder()
                    .enableForegroundBitmap()
                    // The multi-subject beta path is unstable on some Android 15
                    // devices. Wardrobe photos contain one foreground object, so
                    // use the simpler foreground result and a single worker.
                    .setExecutor(imageExecutor)
                    .build();
            subjectSegmenter = SubjectSegmentation.getClient(options);
        }
        return subjectSegmenter;
    }

    private void runSubjectSegmentation(Bitmap source, String callbackId) {
        final SubjectSegmenter segmenter;
        try {
            segmenter = getSubjectSegmenter();
        } catch (Exception error) {
            source.recycle();
            dispatchImageProcessingResult(callbackId, "", error.getMessage());
            return;
        }
        final InputImage input = InputImage.fromBitmap(source, 0);
        segmenter.getInitTask()
                .addOnSuccessListener(ignored -> segmenter.process(input)
                        .addOnSuccessListener(result -> {
                            Bitmap editorial = null;
                            try {
                                editorial = createEditorialImage(result, source);
                                if (editorial == null) throw new IOException("Модель не вернула маску предмета.");
                                File outputFile = writeEditorialImage(editorial);
                                dispatchImageProcessingResult(callbackId, processedImageUrl(outputFile), "");
                            } catch (Exception error) {
                                dispatchImageProcessingResult(callbackId, "", error.getMessage());
                            } finally {
                                if (editorial != null && !editorial.isRecycled()) editorial.recycle();
                                source.recycle();
                            }
                        })
                        .addOnFailureListener(error -> {
                            source.recycle();
                            dispatchImageProcessingResult(callbackId, "", error.getMessage());
                        }))
                .addOnFailureListener(error -> {
                    source.recycle();
                    dispatchImageProcessingResult(callbackId, "", error.getMessage());
                });
    }

    private Bitmap createEditorialImage(SubjectSegmentationResult result, Bitmap source) {
        Bitmap foreground = result.getForegroundBitmap();
        if (foreground == null) return null;
        Bitmap masked = foreground.copy(Bitmap.Config.ARGB_8888, true);
        if (masked == null) return null;
        try {
            return compositeEditorialImage(masked, source.getWidth(), source.getHeight());
        } finally {
            masked.recycle();
        }
    }

    private Bitmap compositeEditorialImage(Bitmap foreground, int width, int height) {
        Bitmap output = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);

        Paint backgroundPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.DITHER_FLAG);
        backgroundPaint.setShader(new LinearGradient(
                0f,
                0f,
                0f,
                height,
                EDITORIAL_BACKGROUND_TOP,
                EDITORIAL_BACKGROUND_BOTTOM,
                Shader.TileMode.CLAMP
        ));
        canvas.drawRect(0f, 0f, width, height, backgroundPaint);

        // A very soft central highlight gives the same quiet studio-paper feel
        // as the catalogue mockup without introducing a visible hard shape.
        backgroundPaint.setShader(new RadialGradient(
                width * 0.5f,
                height * 0.28f,
                Math.max(width, height) * 0.82f,
                0x42FFFFFF,
                0x00FFFFFF,
                Shader.TileMode.CLAMP
        ));
        canvas.drawRect(0f, 0f, width, height, backgroundPaint);

        Rect visibleBounds = findVisibleBounds(foreground);
        float maxItemWidth = width * 0.82f;
        float maxItemHeight = height * 0.82f;
        float scale = Math.min(
                maxItemWidth / Math.max(1f, visibleBounds.width()),
                maxItemHeight / Math.max(1f, visibleBounds.height())
        );
        if (!Float.isFinite(scale) || scale <= 0f) scale = 1f;
        // Keep small accessories readable, but avoid blowing up a bad mask.
        scale = Math.min(1.35f, Math.max(0.72f, scale));
        float itemWidth = visibleBounds.width() * scale;
        float itemHeight = visibleBounds.height() * scale;
        float left = (width - itemWidth) * 0.5f;
        float top = (height - itemHeight) * 0.48f;
        RectF destination = new RectF(left, top, left + itemWidth, top + itemHeight);

        // Ground the garment/accessory with a subtle soft shadow, like the
        // reference card. It is deliberately below the item, not a dark halo.
        float shadowX = destination.centerX();
        float shadowY = Math.min(height - 5f, destination.bottom + Math.max(7f, height * 0.025f));
        float shadowRadius = Math.max(24f, Math.min(width * 0.42f, itemWidth * 0.46f));
        Paint shadowPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.DITHER_FLAG);
        shadowPaint.setShader(new RadialGradient(
                shadowX,
                shadowY,
                shadowRadius,
                new int[]{0x3B66574B, 0x1D66574B, 0x0066554A},
                new float[]{0f, 0.48f, 1f},
                Shader.TileMode.CLAMP
        ));
        float shadowHeight = Math.max(5f, height * 0.022f);
        canvas.drawOval(
                new RectF(
                        shadowX - shadowRadius,
                        shadowY - shadowHeight,
                        shadowX + shadowRadius,
                        shadowY + shadowHeight
                ),
                shadowPaint
        );

        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG | Paint.DITHER_FLAG);
        canvas.drawBitmap(foreground, visibleBounds, destination, paint);
        return output;
    }

    private Rect findVisibleBounds(Bitmap bitmap) {
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        int[] pixels = new int[width * height];
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height);
        int left = width;
        int top = height;
        int right = -1;
        int bottom = -1;
        for (int y = 0; y < height; y++) {
            int row = y * width;
            for (int x = 0; x < width; x++) {
                if (Color.alpha(pixels[row + x]) <= 12) continue;
                if (x < left) left = x;
                if (x > right) right = x;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
            }
        }
        if (right < left || bottom < top) return new Rect(0, 0, width, height);
        return new Rect(
                Math.max(0, left - 2),
                Math.max(0, top - 2),
                Math.min(width, right + 3),
                Math.min(height, bottom + 3)
        );
    }

    private Bitmap decodeImage(String dataUrl) throws IOException {
        if (dataUrl == null) return null;
        int comma = dataUrl.indexOf(',');
        if (comma < 0) return null;
        byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
        File inputFile = new File(getCacheDir(), "metti-input-" + UUID.randomUUID() + ".image");
        try (FileOutputStream stream = new FileOutputStream(inputFile)) {
            stream.write(bytes);
        }
        int orientation = ExifInterface.ORIENTATION_NORMAL;
        try {
            orientation = new ExifInterface(inputFile.getAbsolutePath()).getAttributeInt(
                    ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
        } catch (IOException ignored) {
            // Some PNG/WebP files do not carry EXIF data.
        }
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(inputFile.getAbsolutePath(), bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            inputFile.delete();
            return null;
        }
        int sampleSize = 1;
        int longestSide = Math.max(bounds.outWidth, bounds.outHeight);
        while ((longestSide / sampleSize) > MAX_IMAGE_EDGE) sampleSize *= 2;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sampleSize;
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap bitmap = BitmapFactory.decodeFile(inputFile.getAbsolutePath(), options);
        inputFile.delete();
        if (bitmap == null) return null;
        android.graphics.Matrix matrix = new android.graphics.Matrix();
        switch (orientation) {
            case ExifInterface.ORIENTATION_FLIP_HORIZONTAL:
                matrix.setScale(-1f, 1f);
                break;
            case ExifInterface.ORIENTATION_ROTATE_180:
                matrix.setRotate(180f);
                break;
            case ExifInterface.ORIENTATION_FLIP_VERTICAL:
                matrix.setScale(1f, -1f);
                break;
            case ExifInterface.ORIENTATION_TRANSPOSE:
                matrix.setRotate(90f);
                matrix.postScale(-1f, 1f);
                break;
            case ExifInterface.ORIENTATION_ROTATE_90:
                matrix.setRotate(90f);
                break;
            case ExifInterface.ORIENTATION_TRANSVERSE:
                matrix.setRotate(-90f);
                matrix.postScale(-1f, 1f);
                break;
            case ExifInterface.ORIENTATION_ROTATE_270:
                matrix.setRotate(-90f);
                break;
            default:
                break;
        }
        if (!matrix.isIdentity()) {
            Bitmap oriented = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
            if (oriented != bitmap) bitmap.recycle();
            bitmap = oriented;
        }
        int longestDecodedSide = Math.max(bitmap.getWidth(), bitmap.getHeight());
        if (longestDecodedSide <= MAX_IMAGE_EDGE) return bitmap;
        float scale = (float) MAX_IMAGE_EDGE / longestDecodedSide;
        Bitmap scaled = Bitmap.createScaledBitmap(bitmap,
                Math.max(1, Math.round(bitmap.getWidth() * scale)),
                Math.max(1, Math.round(bitmap.getHeight() * scale)), true);
        if (scaled != bitmap) bitmap.recycle();
        return scaled;
    }

    private File writeEditorialImage(Bitmap foreground) throws IOException {
        Bitmap output = Bitmap.createBitmap(foreground.getWidth(), foreground.getHeight(), Bitmap.Config.ARGB_8888);
        try {
            Canvas canvas = new Canvas(output);
            canvas.drawColor(EDITORIAL_BACKGROUND);
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG | Paint.DITHER_FLAG);
            canvas.drawBitmap(foreground, 0f, 0f, paint);
            File file = new File(getCacheDir(), "metti-processed-" + UUID.randomUUID() + ".jpg");
            try (FileOutputStream stream = new FileOutputStream(file)) {
                if (!output.compress(Bitmap.CompressFormat.JPEG, 90, stream)) {
                    throw new IOException("Не удалось сохранить обработанную фотографию.");
                }
            }
            return file;
        } finally {
            output.recycle();
        }
    }

    private static String processedImageUrl(File file) {
        return "metti-image://processed/" + file.getName();
    }

    private File processedImageFile(String url) {
        if (url == null) return null;
        Uri uri = Uri.parse(url);
        if (!"metti-image".equalsIgnoreCase(uri.getScheme()) || !"processed".equalsIgnoreCase(uri.getHost())) return null;
        String name = uri.getLastPathSegment();
        if (name == null || !name.matches("metti-processed-[A-Za-z0-9-]+\\.jpg")) return null;
        return new File(getCacheDir(), name);
    }

    private WebResourceResponse openProcessedImage(Uri uri) {
        File file = processedImageFile(uri == null ? null : uri.toString());
        if (file == null || !file.isFile()) return null;
        try {
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-store");
            return new WebResourceResponse("image/jpeg", null, 200, "OK", headers, new FileInputStream(file));
        } catch (IOException error) {
            return null;
        }
    }

    private void dispatchImageProcessingResult(String callbackId, String processedUrl, String errorMessage) {
        if (webView == null) return;
        Log.i("MettiImageProcessing", "Dispatch " + callbackId + " url=" + (processedUrl == null ? "" : processedUrl) + " error=" + (errorMessage == null ? "" : errorMessage));
        String script = "window.MettiImageProcessing && window.MettiImageProcessing.resolve("
                + JSONObject.quote(callbackId == null ? "" : callbackId) + ","
                + JSONObject.quote(processedUrl == null ? "" : processedUrl) + ","
                + JSONObject.quote(errorMessage == null ? "" : errorMessage) + ");";
        runOnUiThread(() -> webView.evaluateJavascript(script, null));
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
    protected void onDestroy() {
        if (subjectSegmenter != null) subjectSegmenter.close();
        if (interactiveSegmenter != null) interactiveSegmenter.close();
        imageExecutor.shutdownNow();
        super.onDestroy();
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
