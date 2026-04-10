import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:flutter/foundation.dart';

Future<void> activateFirebaseAppCheck() async {
  const useAppCheck =
      bool.fromEnvironment('USE_APP_CHECK', defaultValue: false);
  if (!useAppCheck) {
    if (kDebugMode) {
      print('APP_CHECK disabled by --dart-define=USE_APP_CHECK=false');
    }
    return;
  }

  const disableAppCheck =
      bool.fromEnvironment('DISABLE_APP_CHECK', defaultValue: false);
  if (disableAppCheck) {
    if (kDebugMode) {
      print('APP_CHECK disabled by --dart-define=DISABLE_APP_CHECK=true');
    }
    return;
  }

  try {
    if (kIsWeb) {
      const webSiteKey =
          String.fromEnvironment('APP_CHECK_WEB_RECAPTCHA_SITE_KEY');
      if (webSiteKey.trim().isEmpty) {
        if (kDebugMode) {
          print(
            'APP_CHECK web site key not set; skipping App Check activation for web.',
          );
        }
        return;
      }
      await FirebaseAppCheck.instance.activate(
        webProvider: ReCaptchaV3Provider(webSiteKey),
      );
    } else {
      await FirebaseAppCheck.instance.activate(
        androidProvider:
            kDebugMode ? AndroidProvider.debug : AndroidProvider.playIntegrity,
        appleProvider: kDebugMode
            ? AppleProvider.debug
            : AppleProvider.appAttestWithDeviceCheckFallback,
      );
    }

    if (kDebugMode) {
      final debugToken = await FirebaseAppCheck.instance.getToken(true);
      if (debugToken != null && debugToken.isNotEmpty) {
        print('APP_CHECK token: $debugToken');
      }
    }
  } catch (error) {
    if (kDebugMode) {
      print('APP_CHECK activation failed: $error');
    }
  }
}
