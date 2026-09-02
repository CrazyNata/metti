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
import android.view.View;
import android.view.WindowInsets;
import android.webkit.WebChromeClient;
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
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int METTI_BG = Color.rgb(251, 239, 238);
    private static final int FILE_CHOOSER_REQUEST_CODE = 1001;
    private static final int VOICE_REQUEST_CODE = 1002;
    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri pendingCameraUri;
    private int nativeTopInset;
    private int nativeBottomInset;
    private final ExecutorService imageExecutor = Executors.newSingleThreadExecutor();
    private SubjectSegmenter subjectSegmenter;
    private static final int MAX_IMAGE_EDGE = 1400;
    private static final int EDITORIAL_BACKGROUND = Color.rgb(240, 233, 223);
    private static final int EDITORIAL_BACKGROUND_TOP = Color.rgb(250, 246, 239);
    private static final int EDITORIAL_BACKGROUND_BOTTOM = Color.rgb(225, 216, 204);

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

        @JavascriptInterface
        public void removeImageBackground(String dataUrl, String callbackId) {
            if (!isNativeImageProcessingAvailable()) {
                dispatchImageProcessingResult(callbackId, "", "");
                return;
            }
            imageExecutor.execute(() -> {
                Bitmap source = null;
                try {
                    source = decodeImage(dataUrl);
                    if (source == null) throw new IOException("Не удалось декодировать фотографию.");
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
    }

    private boolean isNativeImageProcessingAvailable() {
        String device = ((Build.MANUFACTURER == null ? "" : Build.MANUFACTURER) + " "
                + (Build.BRAND == null ? "" : Build.BRAND) + " "
                + (Build.MODEL == null ? "" : Build.MODEL)).toLowerCase(Locale.US);
        // The Play-services subject-segmentation beta currently crashes in its
        // native Drishti worker on this Android 15 Motorola family. Never enter
        // that native path there; the WebView fallback remains available.
        return !(Build.VERSION.SDK_INT >= 35 && (device.contains("motorola") || device.contains("moto")));
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
