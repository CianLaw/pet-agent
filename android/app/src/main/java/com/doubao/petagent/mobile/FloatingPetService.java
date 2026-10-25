package com.doubao.petagent.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.IBinder;
import android.view.Gravity;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.webkit.WebViewAssetLoader;

/**
 * 悬浮窗桌宠服务（v5.9.3）
 * 透明 WebView 加载 pet-float.html（与桌面同一套表演引擎），
 * 系统级悬浮窗：可拖动、置顶、JS 桥关闭。
 */
public class FloatingPetService extends Service {

    private static final String CHANNEL_ID = "floating_pet";
    private static final int NOTIF_ID = 1001;
    private static volatile boolean running = false;

    private WindowManager wm;
    private FrameLayout container;
    private WebView webView;
    private WindowManager.LayoutParams lp;

    public static void start(Context ctx) {
        if (running) return;
        running = true;
        Intent i = new Intent(ctx, FloatingPetService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(i);
        } else {
            ctx.startService(i);
        }
    }

    public static void stop(Context ctx) {
        running = false;
        ctx.stopService(new Intent(ctx, FloatingPetService.class));
    }

    public static boolean isRunning() {
        return running;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        createChannel();
        startForeground(NOTIF_ID, buildNotification());
        setupFloat();
    }

    @Override
    public void onDestroy() {
        running = false;
        if (webView != null) {
            try { webView.removeJavascriptInterface("FloatingPetBridge"); } catch (Exception ignored) {}
            try { webView.loadUrl("about:blank"); } catch (Exception ignored) {}
            try {
                ((WindowManager) getSystemService(WINDOW_SERVICE)).removeView(container);
            } catch (Exception ignored) {}
            try { webView.destroy(); } catch (Exception ignored) {}
            webView = null;
            container = null;
        }
        super.onDestroy();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "悬浮桌宠", NotificationManager.IMPORTANCE_MIN);
            ch.setShowBadge(false);
            ch.setSound(null, null);
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(ch);
        }
    }

    private Notification buildNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("豆包桌宠 · 悬浮中")
                .setContentText("团团在桌面上陪着你")
                .setSmallIcon(R.drawable.ic_launcher_foreground)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();
    }

    private void setupFloat() {
        int type;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            type = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
        } else {
            type = WindowManager.LayoutParams.TYPE_PHONE;
        }
        lp = new WindowManager.LayoutParams(
                Math.round(dp(200)), Math.round(dp(440)),
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        lp.x = Math.round(dp(24));
        lp.y = Math.round(dp(120));

        container = new FrameLayout(this);
        container.setBackgroundColor(Color.TRANSPARENT);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.TRANSPARENT);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }
        WebView.setWebContentsDebuggingEnabled(true);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }
        });

        // JS 桥：拖动窗口 + 关闭悬浮窗（与页面 float.js 配合）
        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void dragTo(int x, int y) {
                lp.x = x;
                lp.y = y;
                try {
                    wm.updateViewLayout(container, lp);
                } catch (Exception ignored) {
                }
            }

            @JavascriptInterface
            public String getPos() {
                return lp.x + "," + lp.y;
            }

            @JavascriptInterface
            public void hide() {
                FloatingPetService.this.stopSelf();
            }
        }, "FloatingPetBridge");

        container.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        wm.addView(container, lp);

        // 从主 App 传入的皮肤名：页面通过 localStorage 读取（主 App 与悬浮窗共享）
        webView.loadUrl("https://appassets.androidplatform.net/public/pet-float.html");
    }

    private int dp(float v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
