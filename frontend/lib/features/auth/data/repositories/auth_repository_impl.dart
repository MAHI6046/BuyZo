import 'package:firebase_auth/firebase_auth.dart';
import '../../domain/repositories/auth_repository.dart';
import '../datasources/auth_remote_datasource.dart';

class AuthRepositoryImpl implements AuthRepository {
  final AuthRemoteDataSource _remoteDataSource;

  AuthRepositoryImpl(this._remoteDataSource);

  String? _verificationId;

  @override
  Future<void> sendOtp(String phoneNumber) async {
    _verificationId = await _remoteDataSource.sendOtp(phoneNumber);
  }

  @override
  Future<UserCredential> verifyOtp(String otp) async {
    if (_verificationId == null || _verificationId!.isEmpty) {
      throw Exception('Please request OTP first.');
    }
    return await _remoteDataSource.verifyOtp(_verificationId!, otp);
  }

  @override
  Future<void> signOut() async {
    await _remoteDataSource.signOut();
    _verificationId = null;
  }

  @override
  User? getCurrentUser() {
    return _remoteDataSource.getCurrentUser();
  }

  String? get verificationId => _verificationId;
}
