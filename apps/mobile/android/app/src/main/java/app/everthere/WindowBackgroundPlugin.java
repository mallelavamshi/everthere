package app.everthere;

import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.View;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Paints the window behind the WebView. Under Android 15 edge-to-edge on WebViews older than 140, Capacitor's
 * SystemBars pads the decor view for the status and navigation bars (and the display cutout in landscape), so those
 * strips show the window background, and StatusBar.setBackgroundColor is ignored. The app sets a top-to-bottom
 * gradient that matches the current screen, so no flat strip appears (device test M-4). On newer WebViews the page
 * draws under the bars itself and this background is simply covered.
 */
@CapacitorPlugin(name = "WindowBackground")
public class WindowBackgroundPlugin extends Plugin {

    @PluginMethod
    public void setColors(PluginCall call) {
        final int top;
        final int bottom;
        try {
            top = Color.parseColor(call.getString("top", "#FFF8EC"));
            bottom = Color.parseColor(call.getString("bottom", call.getString("top", "#FFF8EC")));
        } catch (IllegalArgumentException e) {
            call.reject("Invalid colour");
            return;
        }
        getActivity()
            .runOnUiThread(() -> {
                View decor = getActivity().getWindow().getDecorView();
                decor.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] { top, bottom }));
                call.resolve();
            });
    }
}
