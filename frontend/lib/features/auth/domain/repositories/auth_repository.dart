import 'package:firebase_auth/firebase_auth.dart';

abstract class AuthRepository {
  Future<void> sendOtp(String phoneNumber);
  Future<UserCredential> verifyOtp(String otp);
  Future<void> signOut();
  User? getCurrentUser();
}

