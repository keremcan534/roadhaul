# R8 rules for the release build (android/app/build.gradle). Capacitor, Play Billing and AdMob ship their own
# consumer rules; these cover what they leave to the app.

# Capacitor finds plugins by class name (capacitor.plugins.json) and their methods by annotation, and reads the
# annotations' values (the plugin's name, a method's return type) at run time: keep the annotation types whole.
-keep @interface com.getcapacitor.annotation.** { *; }
-keep @interface com.getcapacitor.PluginMethod { *; }
-keep @interface com.getcapacitor.NativePlugin { *; }

# Crash reports with line numbers; the file names are not needed.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
