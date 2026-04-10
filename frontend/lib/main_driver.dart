import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';

import 'core/app/driver_app.dart';
import 'core/app/app_check_bootstrap.dart';
import 'firebase_options.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  FlutterError.onError = (FlutterErrorDetails details) {
    FlutterError.presentError(details);
    if (kDebugMode) {
      print('DOTDRIVER FlutterError: ${details.exceptionAsString()}');
      print('DOTDRIVER FlutterError stack: ${details.stack}');
    }
  };

  if (kDebugMode) {
    print('DOTDRIVER startup: initializing Firebase...');
    print(
        'DOTDRIVER project: ${DefaultFirebaseOptions.currentPlatform.projectId}');
    print('DOTDRIVER appId: ${DefaultFirebaseOptions.currentPlatform.appId}');
  }

  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
    if (kDebugMode) {
      print('DOTDRIVER Firebase initialized successfully');
      print(
          'DOTDRIVER current user: ${FirebaseAuth.instance.currentUser?.uid ?? "none"}');
    }
  } catch (error) {
    if (kDebugMode) {
      print('DOTDRIVER Firebase initialization failed: $error');
    }
    rethrow;
  }

  await activateFirebaseAppCheck();

  SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
      systemNavigationBarColor: Colors.transparent,
    ),
  );

  runApp(const DotDriverApp());
}
