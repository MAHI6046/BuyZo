import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:firebase_auth/firebase_auth.dart';

abstract class AuthRemoteDataSource {
  Future<String> sendOtp(String phoneNumber);
  Future<UserCredential> verifyOtp(String verificationId, String otp);
  Future<void> signOut();
  User? getCurrentUser();
}

class AuthRemoteDataSourceImpl implements AuthRemoteDataSource {
  final FirebaseAuth _firebaseAuth;

  AuthRemoteDataSourceImpl({FirebaseAuth? firebaseAuth})
      : _firebaseAuth = firebaseAuth ?? FirebaseAuth.instance;

  @override
  Future<String> sendOtp(String phoneNumber) async {
    // Normalize number to E.164, defaulting to India (+91) for local input.
    final rawPhone = phoneNumber.trim();
    final cleanedPhone = rawPhone.replaceAll(RegExp(r'[^\d]'), '');
    late final String formattedPhone;

    if (rawPhone.startsWith('+')) {
      formattedPhone = '+$cleanedPhone';
    } else if (cleanedPhone.startsWith('0') && cleanedPhone.length == 11) {
      // India local mobile with leading 0, e.g. 09876543210 -> +919876543210
      formattedPhone = '+91${cleanedPhone.substring(1)}';
    } else if (cleanedPhone.startsWith('91') && cleanedPhone.length == 12) {
      formattedPhone = '+$cleanedPhone';
    } else if (cleanedPhone.length == 10 && RegExp(r'^[6-9]').hasMatch(cleanedPhone)) {
      // India mobile without country code.
      formattedPhone = '+91$cleanedPhone';
    } else {
      formattedPhone = '+91$cleanedPhone';
    }

    final completer = Completer<String>();

    if (kDebugMode) {
      print('📲 Requesting OTP for formatted number: $formattedPhone');
      print('🔥 FirebaseAuth app: ${_firebaseAuth.app.name}');
      print('🔥 FirebaseAuth project: ${_firebaseAuth.app.options.projectId}');
      print('🔥 FirebaseAuth appId: ${_firebaseAuth.app.options.appId}');
      print('📞 Calling verifyPhoneNumber...');
    }

    unawaited(
      _firebaseAuth
          .verifyPhoneNumber(
            phoneNumber: formattedPhone,
            verificationCompleted: (PhoneAuthCredential credential) {
              // Auto-verification completed (Android only)
              if (kDebugMode) {
                print('✅ verificationCompleted callback received.');
              }
            },
            verificationFailed: (FirebaseAuthException e) {
              if (kDebugMode) {
                print('❌ verificationFailed: ${e.code} | ${e.message}');
              }
              if (!completer.isCompleted) {
                completer.completeError(_handleAuthException(e));
              }
            },
            codeSent: (String verificationId, int? resendToken) {
              if (kDebugMode) {
                print('📨 codeSent callback received.');
              }
              if (!completer.isCompleted) {
                completer.complete(verificationId);
              }
            },
            codeAutoRetrievalTimeout: (String verificationId) {
              if (kDebugMode) {
                print('⏱️ codeAutoRetrievalTimeout callback received.');
              }
              if (!completer.isCompleted) {
                completer.complete(verificationId);
              }
            },
            timeout: const Duration(seconds: 60),
          )
          .catchError((error) {
            if (kDebugMode) {
              print('❌ verifyPhoneNumber threw error: $error');
            }
            if (!completer.isCompleted) {
              completer.completeError(
                Exception('Failed to start phone verification. Please try again.'),
              );
            }
          }),
    );

    return completer.future.timeout(
      const Duration(seconds: 75),
      onTimeout: () {
        if (kDebugMode) {
          print('❌ OTP request timed out without Firebase callbacks.');
        }
        throw Exception(
          'OTP request timed out. Please verify phone auth setup and try again.',
        );
      },
    );
  }

  @override
  Future<UserCredential> verifyOtp(String verificationId, String otp) async {
    try {
      final credential = PhoneAuthProvider.credential(
        verificationId: verificationId,
        smsCode: otp,
      );

      return await _firebaseAuth.signInWithCredential(credential);
    } on FirebaseAuthException catch (e) {
      throw _handleAuthException(e);
    }
  }

  @override
  Future<void> signOut() async {
    await _firebaseAuth.signOut();
  }

  @override
  User? getCurrentUser() {
    return _firebaseAuth.currentUser;
  }

  Exception _handleAuthException(FirebaseAuthException e) {
    switch (e.code) {
      case 'invalid-phone-number':
        return Exception('Invalid phone number. Please check and try again.');
      case 'too-many-requests':
        return Exception('Too many requests. Please try again later.');
      case 'operation-not-allowed':
        return Exception('Phone authentication is not enabled.');
      case 'session-expired':
        return Exception('Session expired. Please request a new OTP.');
      case 'invalid-verification-code':
        return Exception('Invalid OTP. Please check and try again.');
      case 'invalid-verification-id':
        return Exception('Invalid verification. Please request a new OTP.');
      default:
        return Exception(e.message ?? 'An error occurred. Please try again.');
    }
  }
}
