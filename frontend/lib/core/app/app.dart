import 'package:flutter/material.dart';
import 'dart:convert';
import 'package:firebase_auth/firebase_auth.dart';
import '../theme/app_theme.dart';
import '../theme/theme_provider.dart';
import '../network/api_client.dart';
import '../../features/auth/presentation/pages/login_page.dart';
import '../../features/home/presentation/pages/home_page.dart';

class FestiveFlavoursApp extends StatefulWidget {
  const FestiveFlavoursApp({super.key});

  @override
  State<FestiveFlavoursApp> createState() => _FestiveFlavoursAppState();
}

class _FestiveFlavoursAppState extends State<FestiveFlavoursApp> {
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
            title: 'RocketMart',
            debugShowCheckedModeBanner: false,
            theme: AppTheme.lightTheme,
            darkTheme: AppTheme.darkTheme,
            themeMode: _themeNotifier.themeMode,
            home: const _SessionBootstrapPage(),
            routes: {
              '/home': (context) => const HomePage(),
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

class _SessionBootstrapPage extends StatefulWidget {
  const _SessionBootstrapPage();

  @override
  State<_SessionBootstrapPage> createState() => _SessionBootstrapPageState();
}

class _SessionBootstrapPageState extends State<_SessionBootstrapPage> {
  bool _loading = true;
  String? _error;
  bool _showHome = false;

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
        _showHome = false;
      });
      return;
    }

    try {
      final meRes = await ApiClient.instance.get(
        '/api/users/me',
        authenticated: true,
      );
      if (meRes.statusCode == 404) {
        final createRes = await ApiClient.instance.post(
          '/api/users',
          authenticated: true,
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({
            'firebase_uid': user.uid,
            'phone_number': user.phoneNumber,
            'display_name': user.displayName,
          }),
        );
        if (createRes.statusCode < 200 || createRes.statusCode >= 300) {
          if (createRes.statusCode >= 500) {
            if (!mounted) return;
            setState(() {
              _loading = false;
              _showHome = true;
              _error = null;
            });
            return;
          }
          throw Exception(
              'Failed to bootstrap user profile (${createRes.statusCode})');
        }
      } else if (meRes.statusCode >= 500) {
        if (!mounted) return;
        setState(() {
          _loading = false;
          _showHome = true;
          _error = null;
        });
        return;
      } else if (meRes.statusCode < 200 || meRes.statusCode >= 300) {
        throw Exception('Failed to fetch profile (${meRes.statusCode})');
      }

      if (!mounted) return;
      setState(() {
        _loading = false;
        _showHome = FirebaseAuth.instance.currentUser != null;
      });
    } catch (error) {
      if (!mounted) return;
      if (error is SessionExpiredException) {
        setState(() {
          _loading = false;
          _showHome = false;
          _error = null;
        });
        return;
      }
      setState(() {
        _loading = false;
        _showHome = false;
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
    if (_showHome) {
      return const HomePage();
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
    return const LoginPage();
  }
}
