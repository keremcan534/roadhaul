package com.keremcan534.roadhaul;

import android.os.Bundle;
import android.view.WindowManager;
import androidx.activity.EdgeToEdge;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * The game, full screen: the status and navigation bars stay hidden. A swipe
 * from the edge shows them for a moment, and they hide again by themselves,
 * so a thumb that slips off the wheel or the pedals does not leave them over
 * the controls. Hidden again whenever the game comes back into focus. The
 * screen stays on while the game is in front: a drive steered by tilting the
 * phone touches nothing, and the screen would dim and lock mid-drive. The
 * game asks for the screen's refresh rate through DisplayRatePlugin.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // The game's own plugin: the screen's refresh rate (90 or 120 Hz where the phone has it).
        registerPlugin(DisplayRatePlugin.class);
        super.onCreate(savedInstanceState);
        // Edge to edge on every Android, as Android 15 and later draw an app targeting them anyway: behind the hidden
        // bars and into the camera's notch, the interface kept clear of it by the page's safe-area insets.
        EdgeToEdge.enable(this);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            bars.hide(WindowInsetsCompat.Type.systemBars());
        }
    }
}
