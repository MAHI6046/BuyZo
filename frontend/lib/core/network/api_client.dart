import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:http/http.dart' as http;

class SessionExpiredException implements Exception {
  SessionExpiredException(
      [this.message = 'Session expired. Please login again.']);
  final String message;

  @override
  String toString() => message;
}

class ApiClient {
  ApiClient._();

  static final ApiClient instance = ApiClient._();
  static bool _missingAppKeyWarned = false;

  String get _backendBaseUrl {
    const configured = String.fromEnvironment('BACKEND_BASE_URL');
    if (configured.isNotEmpty) return configured;
    return 'https://anydot-backend.vercel.app';
  }

  String get _appClientKey {
    const configured = String.fromEnvironment('APP_CLIENT_KEY');
    final trimmed = configured.trim();
    if (trimmed.isNotEmpty) return trimmed;

    // Local/dev safety fallback so app remains usable if --dart-define is skipped.
    return 'rm_mart_app_key_2026_secure_abc123xyz789';
  }

  Uri uri(String path, [Map<String, String>? queryParameters]) {
    final base = _backendBaseUrl.endsWith('/')
        ? _backendBaseUrl.substring(0, _backendBaseUrl.length - 1)
        : _backendBaseUrl;
    return Uri.parse('$base$path').replace(queryParameters: queryParameters);
  }

  Future<http.Response> get(
    String path, {
    Map<String, String>? queryParameters,
    Map<String, String>? headers,
    bool authenticated = false,
  }) {
    return _request(
      'GET',
      path,
      queryParameters: queryParameters,
      headers: headers,
      authenticated: authenticated,
    );
  }

  Future<http.Response> post(
    String path, {
    Map<String, String>? queryParameters,
    Map<String, String>? headers,
    Object? body,
    bool authenticated = false,
  }) {
    return _request(
      'POST',
      path,
      queryParameters: queryParameters,
      headers: headers,
      body: body,
      authenticated: authenticated,
    );
  }

  Future<http.Response> patch(
    String path, {
    Map<String, String>? queryParameters,
    Map<String, String>? headers,
    Object? body,
    bool authenticated = false,
  }) {
    return _request(
      'PATCH',
      path,
      queryParameters: queryParameters,
      headers: headers,
      body: body,
      authenticated: authenticated,
    );
  }

  Future<http.Response> delete(
    String path, {
    Map<String, String>? queryParameters,
    Map<String, String>? headers,
    Object? body,
    bool authenticated = false,
  }) {
    return _request(
      'DELETE',
      path,
      queryParameters: queryParameters,
      headers: headers,
      body: body,
      authenticated: authenticated,
    );
  }

  Future<http.Response> _request(
    String method,
    String path, {
    Map<String, String>? queryParameters,
    Map<String, String>? headers,
    Object? body,
    bool authenticated = false,
  }) async {
    final requestHeaders = <String, String>{...?headers};
    final requestUri = uri(path, queryParameters);
    User? user;
    final appKey = _appClientKey;

    if (appKey.isEmpty && path.startsWith('/api/')) {
      if (!_missingAppKeyWarned) {
        _missingAppKeyWarned = true;
        throw Exception(
          'APP_CLIENT_KEY missing. Run with --dart-define=APP_CLIENT_KEY=<key> '
          'or use ./scripts/run_main.sh',
        );
      }
      throw Exception('APP_CLIENT_KEY missing');
    }

    if (appKey.isNotEmpty) {
      requestHeaders.putIfAbsent('x-app-client-key', () => appKey);
    }

    try {
      final appCheckToken = await FirebaseAppCheck.instance.getToken();
      if (appCheckToken != null && appCheckToken.isNotEmpty) {
        requestHeaders.putIfAbsent('x-firebase-appcheck', () => appCheckToken);
      }
    } catch (_) {
      // Backend will reject requests when App Check is enforced.
    }

    if (authenticated) {
      user = FirebaseAuth.instance.currentUser;
      if (user == null) {
        throw SessionExpiredException('Please login to continue.');
      }
      final token = await user.getIdToken();
      requestHeaders['Authorization'] = 'Bearer $token';
    }

    var response = await _send(
      method,
      requestUri,
      headers: requestHeaders,
      body: body,
    );

    if (authenticated && response.statusCode == 401) {
      final refreshedUser = FirebaseAuth.instance.currentUser;
      if (refreshedUser == null) {
        await FirebaseAuth.instance.signOut();
        throw SessionExpiredException();
      }
      final refreshedToken = await refreshedUser.getIdToken(true);
      requestHeaders['Authorization'] = 'Bearer $refreshedToken';
      response = await _send(
        method,
        requestUri,
        headers: requestHeaders,
        body: body,
      );
      if (response.statusCode == 401) {
        await FirebaseAuth.instance.signOut();
        throw SessionExpiredException();
      }
    }

    return response;
  }

  Future<http.Response> _send(
    String method,
    Uri requestUri, {
    required Map<String, String> headers,
    Object? body,
  }) {
    switch (method) {
      case 'GET':
        return http.get(requestUri, headers: headers);
      case 'POST':
        return http.post(requestUri, headers: headers, body: body);
      case 'PATCH':
        return http.patch(requestUri, headers: headers, body: body);
      case 'DELETE':
        return http.delete(requestUri, headers: headers, body: body);
      default:
        throw UnsupportedError('HTTP method not supported: $method');
    }
  }
}
