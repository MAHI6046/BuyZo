import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart';
import 'package:provider/provider.dart';
import 'l10n/app_localizations.dart';
import 'core/di/injection_container.dart';
import 'presentation/providers/language_provider.dart';
import 'presentation/providers/theme_provider.dart';
import 'screens/splash_screen.dart';
import 'utils/deep_link_navigator.dart';
import 'utils/referral_link_handler.dart';

// Global navigator key for deep link navigation
final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // Initialize Firebase
  try {
    await Firebase.initializeApp();
    
    // Initialize Crashlytics
    FlutterError.onError = (errorDetails) {
      FirebaseCrashlytics.instance.recordFlutterFatalError(errorDetails);
    };
    
    // Pass non-fatal errors from the framework to Crashlytics
    PlatformDispatcher.instance.onError = (error, stack) {
      FirebaseCrashlytics.instance.recordError(error, stack, fatal: true);
      return true;
    };
    
    if (kDebugMode) {
      print('✅ Firebase initialized successfully');
    }
  } catch (e) {
    if (kDebugMode) {
      print('❌ Firebase initialization failed: $e');
    }
    rethrow;
  }
  
  // Initialize location cache service (loads persisted cache from storage)
  try {
    await injectionContainer.taskProvider.initializeCache();
    if (kDebugMode) {
      print('✅ Location cache initialized');
    }
  } catch (e) {
    if (kDebugMode) {
      print('⚠️ Location cache initialization failed: $e');
    }
    // Don't fail app startup if cache initialization fails
  }
  
  runApp(const BucketOutApp());
}

class BucketOutApp extends StatefulWidget {
  const BucketOutApp({super.key});

  @override
  State<BucketOutApp> createState() => _BucketOutAppState();
}

class _BucketOutAppState extends State<BucketOutApp> {
  @override
  void initState() {
    super.initState();
    // Initialize deep link navigator and referral link handler after first frame
    WidgetsBinding.instance.addPostFrameCallback((_) {
      DeepLinkNavigator.initialize(navigatorKey.currentContext);
      ReferralLinkHandler.initialize(); // Initialize global referral link handler
    });
  }

  @override
  Widget build(BuildContext context) {
    // Dark Mode Color Palette
    const darkColorScheme = ColorScheme.dark(
      // Primary colors
      primary: Color(0xFFF59A2A), // Primary Button
      onPrimary: Color(0xFF0B0B0D), // Inverted Text (on orange)
      primaryContainer: Color(0xFFD97F16), // Button Hover
      onPrimaryContainer: Color(0xFF0B0B0D),
      
      // Secondary colors (using muted variants)
      secondary: Color(0xFFB3B3B8), // Secondary Text
      onSecondary: Color(0xFF0B0B0D),
      secondaryContainer: Color(0xFF7A7A80), // Muted / Hint
      onSecondaryContainer: Color(0xFFFFFFFF),
      
      // Surface colors
      surface: Color(0xFF16161A), // Surface / Card
      onSurface: Color(0xFFFFFFFF), // Primary Text
      surfaceContainerHighest: Color(0xFF1E1E24), // Elevated Surface
      onSurfaceVariant: Color(0xFFB3B3B8), // Secondary Text
      
      // Background
      background: Color(0xFF0B0B0D), // App Background
      onBackground: Color(0xFFFFFFFF), // Primary Text
      
      // Error, Warning, Success, Info
      error: Color(0xFFFF5A5F), // Error
      onError: Color(0xFFFFFFFF),
      errorContainer: Color(0xFFFF5A5F),
      onErrorContainer: Color(0xFFFFFFFF),
      
      // Outline/Border
      outline: Color(0xFF26262C), // Divider / Border
      outlineVariant: Color(0xFF3A3A40), // Disabled
      
      // Shadow
      shadow: Color(0xFF000000),
      scrim: Color(0xFF000000),
      
      // Inverse
      inverseSurface: Color(0xFFFFFFFF),
      onInverseSurface: Color(0xFF0B0B0D),
      inversePrimary: Color(0xFFF59A2A),
    );

    // Light Mode Color Palette
    const lightColorScheme = ColorScheme.light(
      // Primary colors
      primary: Color(0xFFF59A2A), // Primary Button
      onPrimary: Color(0xFFFFFFFF), // Inverted Text (on orange)
      primaryContainer: Color(0xFFD97F16), // Button Hover
      onPrimaryContainer: Color(0xFFFFFFFF),
      
      // Secondary colors
      secondary: Color(0xFF4A4A55), // Secondary Text
      onSecondary: Color(0xFFFFFFFF),
      secondaryContainer: Color(0xFF7A7A80), // Muted / Hint
      onSecondaryContainer: Color(0xFF0B0B0D),
      
      // Surface colors
      surface: Color(0xFFF7F7FA), // Surface / Card
      onSurface: Color(0xFF0B0B0D), // Primary Text
      surfaceContainerHighest: Color(0xFFEFEFF4), // Elevated Surface
      onSurfaceVariant: Color(0xFF4A4A55), // Secondary Text
      
      // Background
      background: Color(0xFFFFFFFF), // App Background
      onBackground: Color(0xFF0B0B0D), // Primary Text
      
      // Error, Warning, Success, Info
      error: Color(0xFFE14C4C), // Error
      onError: Color(0xFFFFFFFF),
      errorContainer: Color(0xFFE14C4C),
      onErrorContainer: Color(0xFFFFFFFF),
      
      // Outline/Border
      outline: Color(0xFFE1E1E8), // Divider / Border
      outlineVariant: Color(0xFFCFCFD6), // Disabled
      
      // Shadow
      shadow: Color(0xFF000000),
      scrim: Color(0xFF000000),
      
      // Inverse
      inverseSurface: Color(0xFF0B0B0D),
      onInverseSurface: Color(0xFFFFFFFF),
      inversePrimary: Color(0xFFF59A2A),
    );

    final darkTheme = ThemeData(
      colorScheme: darkColorScheme,
      useMaterial3: true,
      scaffoldBackgroundColor: const Color(0xFF0B0B0D), // App Background
      textTheme: Typography.whiteCupertino,
      // Card theme
      cardTheme: CardThemeData(
        color: const Color(0xFF16161A), // Surface / Card
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(
            color: darkColorScheme.outline.withOpacity(0.1),
            width: 1,
          ),
        ),
      ),
      // Elevated button theme
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: const Color(0xFFF59A2A), // Primary Button
          foregroundColor: const Color(0xFF0B0B0D), // Inverted Text
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      // Divider theme
      dividerTheme: DividerThemeData(
        color: const Color(0xFF26262C), // Divider / Border
        thickness: 1,
        space: 1,
      ),
    );

    final lightTheme = ThemeData(
      colorScheme: lightColorScheme,
      useMaterial3: true,
      scaffoldBackgroundColor: const Color(0xFFFFFFFF), // App Background
      // Card theme
      cardTheme: CardThemeData(
        color: const Color(0xFFF7F7FA), // Surface / Card
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(
            color: lightColorScheme.outline.withOpacity(0.1),
            width: 1,
          ),
        ),
      ),
      // Elevated button theme
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: const Color(0xFFF59A2A), // Primary Button
          foregroundColor: const Color(0xFFFFFFFF), // Inverted Text
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      // Divider theme
      dividerTheme: DividerThemeData(
        color: const Color(0xFFE1E1E8), // Divider / Border
        thickness: 1,
        space: 1,
      ),
    );

    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: injectionContainer.authProvider),
        ChangeNotifierProvider.value(value: injectionContainer.languageProvider),
        ChangeNotifierProvider.value(value: injectionContainer.locationProvider),
        ChangeNotifierProvider.value(value: injectionContainer.themeProvider),
        ChangeNotifierProvider.value(value: injectionContainer.taskProvider),
        ChangeNotifierProvider.value(value: injectionContainer.messageProvider),
      ],
      child: Consumer2<ThemeProvider, LanguageProvider>(
        builder: (context, themeProvider, languageProvider, _) {
          return MaterialApp(
            title: 'BucketOut',
            debugShowCheckedModeBanner: false,
            navigatorKey: navigatorKey,
            theme: lightTheme,
            darkTheme: darkTheme,
            themeMode: themeProvider.themeMode,
            locale: languageProvider.locale,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: const [
              Locale('en'), // English
              Locale('hi'), // Hindi
              Locale('te'), // Telugu
            ],
            home: const SplashScreen(),
          );
        },
      ),
    );
  }
}
