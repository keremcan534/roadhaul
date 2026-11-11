package com.keremcan534.roadhaul;

import android.app.Activity;
import android.view.Display;
import android.view.Window;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The screen's refresh rate for the game (Settings: frame rate). Android shows
 * an app at 60 Hz on many phones whose screens can do 90 or 120 unless the app
 * asks; the game asks for the fastest mode at the screen's size up to the rate
 * it wants (`hz`), and 0 hands the choice back to the system. The WebView's
 * frames, and so the game's, follow the window's rate.
 */
@CapacitorPlugin(name = "DisplayRate")
public class DisplayRatePlugin extends Plugin {

    @PluginMethod
    public void setPreferredRate(PluginCall call) {
        final float wanted = call.getFloat("hz", 0f);
        final Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            WindowManager.LayoutParams params = window.getAttributes();
            Display display = activity.getWindowManager().getDefaultDisplay();
            Display.Mode current = display.getMode();
            int bestId = 0;
            float bestRate = 0f;
            if (wanted > 0f) {
                for (Display.Mode mode : display.getSupportedModes()) {
                    boolean sameSize = mode.getPhysicalWidth() == current.getPhysicalWidth()
                        && mode.getPhysicalHeight() == current.getPhysicalHeight();
                    float rate = mode.getRefreshRate();
                    // The fastest up to the rate wanted (a little over, for 59.94 and 120.0 screens).
                    if (sameSize && rate <= wanted + 1f && rate > bestRate) {
                        bestRate = rate;
                        bestId = mode.getModeId();
                    }
                }
            }
            params.preferredDisplayModeId = bestId;
            params.preferredRefreshRate = bestRate;
            window.setAttributes(params);
            JSObject result = new JSObject();
            result.put("hz", bestId == 0 ? display.getRefreshRate() : bestRate);
            call.resolve(result);
        });
    }
}
