import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../network/api_client.dart';
import '../theme/app_theme.dart';
import '../theme/theme_provider.dart';
import '../../features/auth/presentation/pages/login_page.dart';
import '../../features/driver/presentation/pages/driver_home_page.dart';

class DotDriverApp extends StatefulWidget {
  const DotDriverApp({super.key});

  @override
  State<DotDriverApp> createState() => _DotDriverAppState();
}

class _DotDriverAppState extends State<DotDriverApp> {
  late final ThemeNotifier _themeNotifier;

  @override
  void initState() {
    super.initState();
    _themeNotifier = ThemeNotifier();
  }

  @override
  void dispose() {
    _themeNotifier.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ThemeProvider(
      notifier: _themeNotifier,
      child: AnimatedBuilder(
        animation: _themeNotifier,
        builder: (context, child) {
          return MaterialApp(
            title: 'RocketMart Driver',
            debugShowCheckedModeBanner: false,
            theme: AppTheme.lightTheme,
            darkTheme: AppTheme.darkTheme,
            themeMode: _themeNotifier.themeMode,
            home: const _DriverSessionBootstrapPage(),
            routes: {
              '/driver-home': (context) => const DriverHomePage(),
            },
            builder: (context, child) {
              return GestureDetector(
                behavior: HitTestBehavior.translucent,
                onTap: () {
                  final currentFocus = FocusScope.of(context);
                  if (!currentFocus.hasPrimaryFocus &&
                      currentFocus.focusedChild != null) {
                    currentFocus.unfocus();
                  }
                },
                child: MediaQuery(
                  data: MediaQuery.of(context).copyWith(textScaleFactor: 1.0),
                  child: child ?? const SizedBox.shrink(),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class _DriverSessionBootstrapPage extends StatefulWidget {
  const _DriverSessionBootstrapPage();

  @override
  State<_DriverSessionBootstrapPage> createState() =>
      _DriverSessionBootstrapPageState();
}

class _DriverSessionBootstrapPageState
    extends State<_DriverSessionBootstrapPage> {
  bool _loading = true;
  String? _error;
  bool _showDriverHome = false;

  @override
  void initState() {
    super.initState();
    _bootstrapSession();
  }

  Future<void> _bootstrapSession() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _showDriverHome = false;
      });
      return;
    }

    try {
      final response = await ApiClient.instance.get(
        '/api/driver/me',
        authenticated: true,
      );

      if (response.statusCode >= 200 && response.statusCode < 300) {
        if (!mounted) return;
        setState(() {
          _loading = false;
          _showDriverHome = true;
          _error = null;
        });
        return;
      }

      if (response.statusCode == 401 || response.statusCode == 403) {
        await FirebaseAuth.instance.signOut();
        if (!mounted) return;
        setState(() {
          _loading = false;
          _showDriverHome = false;
          _error = null;
        });
        return;
      }

      throw Exception('Driver session check failed (${response.statusCode})');
    } catch (error) {
      if (!mounted) return;
      if (error is SessionExpiredException) {
        setState(() {
          _loading = false;
          _showDriverHome = false;
          _error = null;
        });
        return;
      }
      setState(() {
        _loading = false;
        _showDriverHome = false;
        _error = error.toString().replaceFirst('Exception: ', '').trim();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }
    if (_showDriverHome) {
      return const DriverHomePage();
    }
    if (_error != null) {
      return Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(_error!, textAlign: TextAlign.center),
                const SizedBox(height: 10),
                FilledButton(
                  onPressed: () {
                    setState(() {
                      _loading = true;
                      _error = null;
                    });
                    _bootstrapSession();
                  },
                  child: const Text('Retry'),
                ),
              ],
            ),
          ),
        ),
      );
    }
    return const LoginPage(
      successRoute: '/driver-home',
      requiredRole: 'driver',
    );
  }
}
