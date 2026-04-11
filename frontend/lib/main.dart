import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'firebase_options.dart';
import 'core/app/app.dart';
import 'core/app/app_check_bootstrap.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  FlutterError.onError = (FlutterErrorDetails details) {
    FlutterError.presentError(details);
    if (kDebugMode) {
      print('❌ FlutterError: ${details.exceptionAsString()}');
      print('❌ FlutterError stack: ${details.stack}');
    }
  };

  if (kDebugMode) {
    print('🚀 App startup: initializing Firebase...');
    print(
        '📦 Target Firebase project: ${DefaultFirebaseOptions.currentPlatform.projectId}');
    print(
        '🆔 Target Firebase appId: ${DefaultFirebaseOptions.currentPlatform.appId}');
  }

  // Initialize Firebase with options from flutterfire configure
  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );

    if (kDebugMode) {
      print('✅ Firebase initialized successfully');
      print(
          '📚 Firebase apps loaded: ${Firebase.apps.map((e) => e.name).toList()}');
      print(
          '👤 Current user on startup: ${FirebaseAuth.instance.currentUser?.uid ?? "none"}');
    }
  } catch (e) {
    if (kDebugMode) {
      print('❌ Firebase initialization failed: $e');
    }
    rethrow;
  }

  await activateFirebaseAppCheck();

  // Set preferred orientations
  SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // Set system UI overlay style
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
      systemNavigationBarColor: Colors.transparent,
    ),
  );

  runApp(const FestiveFlavoursApp());
}
