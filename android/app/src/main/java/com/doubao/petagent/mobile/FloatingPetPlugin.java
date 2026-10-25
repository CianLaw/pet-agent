package com.doubao.petagent.mobile;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 悬浮窗桌宠插件（v5.9.3）：开启/关闭悬浮窗、授权检测与引导。
 * 主 App（mobile/app.js）通过 Capacitor.Plugins.FloatingPet 调用。
 */
@CapacitorPlugin(name = "FloatingPet")
public class FloatingPetPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        if (!Settings.canDrawOverlays(getContext())) {
            JSObject err = new JSObject();
            err.put("message", "need_permission");
            call.reject("OVERLAY_PERMISSION_REQUIRED", "need_permission");
            return;
        }
        FloatingPetService.start(getContext());
        JSObject ok = new JSObject();
        ok.put("open", true);
        call.resolve(ok);
    }

    @PluginMethod
    public void close(PluginCall call) {
        FloatingPetService.stop(getContext());
        JSObject ok = new JSObject();
        ok.put("open", false);
        call.resolve(ok);
    }

    @PluginMethod
    public void isOpen(PluginCall call) {
        JSObject o = new JSObject();
        o.put("open", FloatingPetService.isRunning());
        call.resolve(o);
    }

    @PluginMethod
    public void hasPermission(PluginCall call) {
        JSObject o = new JSObject();
        o.put("granted", Settings.canDrawOverlays(getContext()));
        call.resolve(o);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(getContext())) {
            try {
                Intent intent = new Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } catch (Exception e) {
                try {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(intent);
                } catch (Exception e2) {
                    call.reject("CANNOT_OPEN_SETTINGS", e2.getMessage());
                    return;
                }
            }
        }
        call.resolve();
    }
}
