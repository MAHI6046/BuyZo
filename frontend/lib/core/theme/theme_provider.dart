import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class ThemeNotifier extends ChangeNotifier {
  static const String _themeModeKey = 'app_theme_mode';
  ThemeMode _themeMode = ThemeMode.system;

  ThemeNotifier() {
    _loadSavedThemeMode();
  }

  ThemeMode get themeMode => _themeMode;

  bool get isDarkMode {
    if (_themeMode == ThemeMode.system) {
      return WidgetsBinding.instance.platformDispatcher.platformBrightness ==
          Brightness.dark;
    }
    return _themeMode == ThemeMode.dark;
  }

  void setThemeMode(ThemeMode mode) {
    if (_themeMode != mode) {
      _themeMode = mode;
      unawaited(_persistThemeMode(mode));
      notifyListeners();
    }
  }

  void toggleTheme() {
    if (_themeMode == ThemeMode.light) {
      setThemeMode(ThemeMode.dark);
    } else if (_themeMode == ThemeMode.dark) {
      setThemeMode(ThemeMode.light);
    } else {
      // If system, toggle to opposite of current system preference
      final currentBrightness =
          WidgetsBinding.instance.platformDispatcher.platformBrightness;
      setThemeMode(
        currentBrightness == Brightness.dark ? ThemeMode.light : ThemeMode.dark,
      );
    }
  }

  Future<void> _loadSavedThemeMode() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_themeModeKey);
      if (raw == null || raw.isEmpty) return;
      final loadedMode = _themeModeFromString(raw);
      if (loadedMode == null || loadedMode == _themeMode) return;
      _themeMode = loadedMode;
      notifyListeners();
    } catch (_) {}
  }

  Future<void> _persistThemeMode(ThemeMode mode) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_themeModeKey, _themeModeToString(mode));
    } catch (_) {}
  }

  ThemeMode? _themeModeFromString(String value) {
    switch (value.trim().toLowerCase()) {
      case 'light':
        return ThemeMode.light;
      case 'dark':
        return ThemeMode.dark;
      case 'system':
        return ThemeMode.system;
      default:
        return null;
    }
  }

  String _themeModeToString(ThemeMode mode) {
    switch (mode) {
      case ThemeMode.light:
        return 'light';
      case ThemeMode.dark:
        return 'dark';
      case ThemeMode.system:
        return 'system';
    }
  }
}

class ThemeProvider extends InheritedNotifier<ThemeNotifier> {
  const ThemeProvider({
    super.key,
    required super.notifier,
    required super.child,
  });

  static ThemeProvider? of(BuildContext context) {
    return context.dependOnInheritedWidgetOfExactType<ThemeProvider>();
  }

  static ThemeNotifier? themeNotifier(BuildContext context) {
    return of(context)?.notifier;
  }
}
