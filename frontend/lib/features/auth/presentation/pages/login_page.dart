import 'dart:async';
import 'dart:convert';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../../../../core/constants/app_constants.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/ui/app_snack_bar.dart';
import '../../../../shared/widgets/premium_button.dart';
import '../../../../shared/widgets/premium_text_field.dart';
import '../../data/datasources/auth_remote_datasource.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({
    super.key,
    this.successRoute = '/home',
    this.requiredRole,
  });

  final String successRoute;
  final String? requiredRole;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _formKey = GlobalKey<FormState>();
  final _mobileController = TextEditingController();
  final _otpController = TextEditingController();
  final _referralCodeController = TextEditingController();
  final FocusNode _mobileFocusNode = FocusNode();
  final FocusNode _otpFocusNode = FocusNode();
  bool _isLoading = false;
  bool _otpSent = false;
  int _resendTimer = 0;
  String? _verificationId;
  String? _errorMessage;

  late final AuthRemoteDataSourceImpl _authDataSource;
  StreamSubscription<User?>? _authStateSubscription;

  @override
  void initState() {
    super.initState();
    _authDataSource = AuthRemoteDataSourceImpl();
    _authStateSubscription = FirebaseAuth.instance.authStateChanges().listen((
      user,
    ) {
      if (kDebugMode) {
        print('👤 authStateChanges => ${user?.uid ?? "signed_out"}');
      }
    });
  }

  @override
  void dispose() {
    _authStateSubscription?.cancel();
    _mobileController.dispose();
    _otpController.dispose();
    _referralCodeController.dispose();
    _mobileFocusNode.dispose();
    _otpFocusNode.dispose();
    super.dispose();
  }

  Future<void> _handleSendOtp() async {
    final mobileError = _validateMobileNumber(_mobileController.text);
    if (mobileError != null) {
      setState(() {
        _errorMessage = mobileError;
      });
      return;
    }

    // Dismiss keyboard
    FocusScope.of(context).unfocus();

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final phoneNumber = _mobileController.text;
      final stopwatch = Stopwatch()..start();
      if (kDebugMode) {
        print('📱 Sending OTP to: $phoneNumber');
        print('⏳ Waiting for Firebase phone auth callbacks...');
      }

      _verificationId = await _authDataSource.sendOtp(phoneNumber);

      if (kDebugMode) {
        print('✅ OTP sent successfully!');
        print('⏱️ OTP request completed in ${stopwatch.elapsedMilliseconds}ms');
        print(
            '📝 Verification ID received: ${_verificationId!.substring(0, 20)}...');
      }

      if (mounted) {
        setState(() {
          _isLoading = false;
          _otpSent = true;
          _resendTimer = 60; // 60 seconds countdown
        });

        // Start countdown timer
        _startResendTimer();

        // Auto focus OTP field
        Future.delayed(const Duration(milliseconds: 300), () {
          _otpFocusNode.requestFocus();
        });

        // Show success message
        AppSnackBar.show(context, 'OTP sent to +91 ${_mobileController.text}');
      }
    } catch (e, stackTrace) {
      if (kDebugMode) {
        print('❌ Error sending OTP: $e');
        print('❌ Stack trace: $stackTrace');
      }

      if (mounted) {
        setState(() {
          _isLoading = false;
          _errorMessage = e.toString().replaceAll('Exception: ', '');
        });
      }
    }
  }

  void _startResendTimer() {
    if (_resendTimer > 0) {
      Future.delayed(const Duration(seconds: 1), () {
        if (mounted && _otpSent) {
          setState(() {
            _resendTimer--;
          });
          _startResendTimer();
        }
      });
    }
  }

  Future<void> _handleVerifyOtp() async {
    final otpError = _validateOtp(_otpController.text);
    if (otpError != null) {
      setState(() {
        _errorMessage = otpError;
      });
      return;
    }

    // Dismiss keyboard
    FocusScope.of(context).unfocus();

    if (_verificationId == null || _verificationId!.isEmpty) {
      setState(() {
        _errorMessage = 'Please request OTP first.';
      });
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      if (kDebugMode) {
        print('🔐 Verifying OTP...');
        print('📝 Verification ID: ${_verificationId!.substring(0, 20)}...');
        print('🔢 OTP Code: ${_otpController.text}');
      }

      final credential = PhoneAuthProvider.credential(
        verificationId: _verificationId!,
        smsCode: _otpController.text,
      );

      if (kDebugMode) {
        print('✅ Credential created, signing in...');
      }

      await FirebaseAuth.instance.signInWithCredential(credential);

      if (kDebugMode) {
        print('✅ OTP verified successfully!');
      }

      if (mounted) {
        await _storeUserInFirestore();
        await _syncUserProfileToBackend();
        await _ensureRoleAccess();
        // Navigate to home page on success
        Navigator.of(context).pushReplacementNamed(widget.successRoute);
      }
    } on FirebaseAuthException catch (e) {
      if (kDebugMode) {
        print('❌ FirebaseAuthException: ${e.code}');
        print('❌ Error message: ${e.message}');
        print('❌ Stack trace: ${e.stackTrace}');
      }

      String errorMsg = 'Invalid OTP. Please try again.';
      if (e.code == 'invalid-verification-code') {
        errorMsg = 'Invalid OTP. Please check and try again.';
      } else if (e.code == 'session-expired') {
        errorMsg = 'Session expired. Please request a new OTP.';
      } else if (e.message != null) {
        errorMsg = e.message!;
      }

      if (mounted) {
        setState(() {
          _isLoading = false;
          _errorMessage = errorMsg;
        });
      }
    } catch (e, stackTrace) {
      if (kDebugMode) {
        print('❌ General Exception: $e');
        print('❌ Stack trace: $stackTrace');
      }

      if (mounted) {
        setState(() {
          _isLoading = false;
          _errorMessage = e.toString().replaceFirst('Exception: ', '');
        });
      }
    }
  }

  Future<void> _storeUserInFirestore() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;

    final payload = <String, dynamic>{
      'phone': (user.phoneNumber ?? '').trim(),
    };

    final displayName = (user.displayName ?? '').trim();
    if (displayName.isNotEmpty) {
      payload['name'] = displayName;
    }

    await FirebaseFirestore.instance
        .collection('users')
        .doc(user.uid)
        .set(payload, SetOptions(merge: true));
  }

  String _normalizedReferralCode() {
    return _referralCodeController.text
        .trim()
        .toUpperCase()
        .replaceAll(RegExp(r'[^A-Z0-9]'), '');
  }

  String _extractApiMessage(String body, {required int statusCode}) {
    final trimmed = body.trimLeft();
    if (trimmed.startsWith('{')) {
      try {
        final decoded = jsonDecode(body) as Map<String, dynamic>? ?? const {};
        final message = decoded['message']?.toString().trim() ?? '';
        if (message.isNotEmpty) return message;
      } catch (_) {}
    }
    return 'Unable to sync account (${statusCode})';
  }

  Future<void> _syncUserProfileToBackend() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;

    final referralCode = _normalizedReferralCode();
    final payload = <String, dynamic>{
      'phone_number': user.phoneNumber,
      'display_name': user.displayName,
      if (referralCode.isNotEmpty) 'referral_code': referralCode,
    };

    final response = await ApiClient.instance.post(
      '/api/users',
      authenticated: true,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(payload),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = _extractApiMessage(
        response.body,
        statusCode: response.statusCode,
      );
      throw Exception(message);
    }
  }

  Future<void> _ensureRoleAccess() async {
    final requiredRole = widget.requiredRole?.trim().toLowerCase();
    if (requiredRole == null || requiredRole.isEmpty) return;

    if (requiredRole == 'driver') {
      final response = await ApiClient.instance.get(
        '/api/driver/me',
        authenticated: true,
      );
      if (response.statusCode >= 200 && response.statusCode < 300) {
        return;
      }

      final fallbackMessage = response.statusCode == 403
          ? 'This phone number is not approved for driver access.'
          : 'Driver login is currently unavailable. Please try again.';
      await FirebaseAuth.instance.signOut();
      throw Exception(fallbackMessage);
    }
  }

  void _handleResendOtp() {
    if (_resendTimer > 0) return;

    setState(() {
      _otpSent = false;
      _otpController.clear();
      _verificationId = null;
      _resendTimer = 60;
      _errorMessage = null;
    });
    _handleSendOtp();
  }

  void _handleGoBack() {
    setState(() {
      _otpSent = false;
      _otpController.clear();
      _verificationId = null;
      _resendTimer = 0;
      _errorMessage = null;
      _isLoading = false;
    });
    // Timer will stop naturally when _resendTimer is set to 0
    _mobileFocusNode.requestFocus();
  }

  String? _validateMobileNumber(String? value) {
    if (value == null || value.isEmpty) {
      return 'Please enter your mobile number';
    }
    // Remove any spaces or special characters for validation
    final cleaned = value.replaceAll(RegExp(r'[^\d]'), '');
    if (!RegExp(r'^[6-9]\d{9}$').hasMatch(cleaned)) {
      return 'Please enter a valid Indian mobile number';
    }
    return null;
  }

  String? _validateOtp(String? value) {
    if (value == null || value.isEmpty) {
      return 'Please enter OTP';
    }
    if (value.length != 6 || !RegExp(r'^\d+$').hasMatch(value)) {
      return 'Please enter a valid 6-digit OTP';
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final backgroundColor = theme.colorScheme.background;
    final canNavigatorPop = Navigator.of(context).canPop();
    final canPopRoute = canNavigatorPop && !_otpSent;

    return PopScope(
      canPop: canPopRoute,
      onPopInvokedWithResult: (bool didPop, dynamic result) {
        if (didPop) return;
        if (_otpSent) {
          // Handle back gesture/button when in OTP screen.
          _handleGoBack();
          return;
        }
        if (!canNavigatorPop) {
          // Avoid popping the final route and tripping Navigator assertions.
          SystemNavigator.pop();
        }
      },
      child: GestureDetector(
        onTap: () {
          // Dismiss keyboard when tapping outside
          FocusScope.of(context).unfocus();
        },
        behavior: HitTestBehavior.opaque,
        child: Scaffold(
          appBar: _otpSent
              ? AppBar(
                  backgroundColor: theme.colorScheme.surface,
                  elevation: 0,
                  leading: IconButton(
                    icon: Icon(
                      Icons.arrow_back,
                      color: theme.colorScheme.onBackground,
                    ),
                    onPressed: _handleGoBack,
                  ),
                )
              : null,
          body: Container(
            color: backgroundColor,
            child: SafeArea(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  return SingleChildScrollView(
                    keyboardDismissBehavior:
                        ScrollViewKeyboardDismissBehavior.onDrag,
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppConstants.defaultPadding,
                      vertical: 12,
                    ),
                    child: ConstrainedBox(
                      constraints:
                          BoxConstraints(minHeight: constraints.maxHeight - 24),
                      child: Form(
                        key: _formKey,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            SizedBox(height: constraints.maxHeight * 0.2),
                            Center(
                              child: Image.asset(
                                AppConstants.logoPath,
                                width: 72,
                                height: 72,
                                fit: BoxFit.contain,
                              ),
                            ),
                            const SizedBox(height: 12),
                            Padding(
                              padding: const EdgeInsets.all(16),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  if (!_otpSent) ...[
                                    _FrostedPhoneField(
                                      label: 'Mobile Number',
                                      hint: 'Enter mobile number',
                                      controller: _mobileController,
                                      errorText: _errorMessage,
                                      focusNode: _mobileFocusNode,
                                      onChanged: (value) {
                                        final cleaned = value.replaceAll(
                                            RegExp(r'[^\d]'), '');
                                        if (cleaned.length <= 10) {
                                          final formatted = cleaned.length > 5
                                              ? '${cleaned.substring(0, 5)} ${cleaned.substring(5)}'
                                              : cleaned;
                                          if (formatted != value) {
                                            _mobileController.value =
                                                TextEditingValue(
                                              text: formatted,
                                              selection:
                                                  TextSelection.collapsed(
                                                offset: formatted.length,
                                              ),
                                            );
                                          }
                                        } else {
                                          _mobileController.value =
                                              TextEditingValue(
                                            text: value.substring(
                                                0, value.length - 1),
                                            selection: TextSelection.collapsed(
                                              offset: value.length - 1,
                                            ),
                                          );
                                        }
                                        if (_errorMessage != null) {
                                          setState(() {
                                            _errorMessage = null;
                                          });
                                        }
                                      },
                                    ),
                                    const SizedBox(height: 12),
                                    PremiumTextField(
                                      label: 'Referral Code (Optional)',
                                      hint: 'Enter invite code',
                                      keyboardType: TextInputType.text,
                                      textInputAction: TextInputAction.done,
                                      controller: _referralCodeController,
                                      prefixIcon: Icon(
                                        Icons.card_giftcard_rounded,
                                        color: theme.colorScheme.primary,
                                      ),
                                      inputFormatters: [
                                        FilteringTextInputFormatter.allow(
                                          RegExp(r'[a-zA-Z0-9]'),
                                        ),
                                        LengthLimitingTextInputFormatter(16),
                                      ],
                                      onChanged: (value) {
                                        final normalized = value
                                            .toUpperCase()
                                            .replaceAll(
                                                RegExp(r'[^A-Z0-9]'), '');
                                        if (normalized != value) {
                                          _referralCodeController.value =
                                              TextEditingValue(
                                            text: normalized,
                                            selection: TextSelection.collapsed(
                                              offset: normalized.length,
                                            ),
                                          );
                                        }
                                      },
                                    ),
                                    const SizedBox(height: 24),
                                    PremiumButton(
                                      text: 'Send OTP',
                                      onPressed: _handleSendOtp,
                                      isLoading: _isLoading,
                                    ),
                                  ] else ...[
                                    Text(
                                      'Enter the 6-digit OTP sent to +91 ${_mobileController.text}',
                                      style:
                                          theme.textTheme.bodySmall?.copyWith(
                                        color: theme.colorScheme.onSurface
                                            .withOpacity(0.72),
                                      ),
                                    ),
                                    const SizedBox(height: 12),
                                    PremiumTextField(
                                      label: 'OTP',
                                      hint: 'Enter 6-digit OTP',
                                      keyboardType: TextInputType.number,
                                      textInputAction: TextInputAction.done,
                                      controller: _otpController,
                                      focusNode: _otpFocusNode,
                                      prefixIcon: Icon(
                                        Icons.lock_outlined,
                                        color: theme.colorScheme.primary,
                                      ),
                                      inputFormatters: [
                                        FilteringTextInputFormatter.digitsOnly,
                                        LengthLimitingTextInputFormatter(6),
                                      ],
                                      onChanged: (value) {
                                        if (_errorMessage != null) {
                                          setState(() {
                                            _errorMessage = null;
                                          });
                                        }
                                      },
                                    ),
                                    if (_errorMessage != null) ...[
                                      const SizedBox(height: 8),
                                      _InlineFieldError(
                                          message: _errorMessage!),
                                    ],
                                    const SizedBox(height: 10),
                                    Row(
                                      mainAxisAlignment:
                                          MainAxisAlignment.center,
                                      children: [
                                        Text(
                                          "Didn't receive OTP? ",
                                          style: theme.textTheme.bodyMedium
                                              ?.copyWith(
                                            color: theme
                                                .colorScheme.onBackground
                                                .withOpacity(0.7),
                                          ),
                                        ),
                                        TextButton(
                                          onPressed: _resendTimer > 0
                                              ? null
                                              : _handleResendOtp,
                                          child: Text(
                                            _resendTimer > 0
                                                ? 'Resend OTP in ${_resendTimer}s'
                                                : 'Resend OTP',
                                            style: theme.textTheme.bodyMedium
                                                ?.copyWith(
                                              color: _resendTimer > 0
                                                  ? theme
                                                      .colorScheme.onBackground
                                                      .withOpacity(0.5)
                                                  : theme.colorScheme.primary,
                                              fontWeight: FontWeight.w600,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 14),
                                    PremiumButton(
                                      text: 'Verify OTP',
                                      onPressed: _handleVerifyOtp,
                                      isLoading: _isLoading,
                                    ),
                                  ],
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _FrostedPhoneField extends StatelessWidget {
  const _FrostedPhoneField({
    required this.label,
    required this.hint,
    required this.controller,
    required this.errorText,
    required this.focusNode,
    required this.onChanged,
  });

  final String label;
  final String hint;
  final TextEditingController controller;
  final String? errorText;
  final FocusNode focusNode;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final isDark = theme.brightness == Brightness.dark;

    return AnimatedBuilder(
      animation: Listenable.merge([focusNode, controller]),
      builder: (context, _) {
        final isFocused = focusNode.hasFocus;
        final hasText = controller.text.trim().isNotEmpty;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: theme.textTheme.titleSmall?.copyWith(
                color: isFocused
                    ? colorScheme.primary
                    : colorScheme.onSurface.withOpacity(0.7),
              ),
            ),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
                child: Container(
                  height: 50,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(
                    color: colorScheme.surfaceContainerHighest.withOpacity(0.6),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                      color: isFocused
                          ? colorScheme.primary.withOpacity(0.8)
                          : colorScheme.outlineVariant.withOpacity(0.75),
                      width: isFocused ? 1.2 : 1,
                    ),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.phone_outlined,
                        size: 20,
                        color: colorScheme.primary,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        '+91',
                        style: theme.textTheme.bodyLarge?.copyWith(
                          color: colorScheme.onSurface,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        width: 1,
                        height: 18,
                        color: colorScheme.outlineVariant.withOpacity(0.6),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: TextFormField(
                          controller: controller,
                          focusNode: focusNode,
                          keyboardType: TextInputType.phone,
                          textInputAction: TextInputAction.done,
                          showCursor: true,
                          cursorColor:
                              isDark ? Colors.white : colorScheme.onSurface,
                          cursorWidth: 2,
                          cursorHeight: 20,
                          style: theme.textTheme.bodyLarge?.copyWith(
                            color: colorScheme.onSurface,
                          ),
                          inputFormatters: [
                            FilteringTextInputFormatter.allow(
                              RegExp(r'[0-9 ]'),
                            ),
                          ],
                          decoration: InputDecoration(
                            isCollapsed: true,
                            isDense: true,
                            filled: false,
                            fillColor: Colors.transparent,
                            border: InputBorder.none,
                            enabledBorder: InputBorder.none,
                            focusedBorder: InputBorder.none,
                            disabledBorder: InputBorder.none,
                            errorBorder: InputBorder.none,
                            focusedErrorBorder: InputBorder.none,
                            hintText: hint,
                            hintStyle: theme.textTheme.bodyMedium?.copyWith(
                              color: colorScheme.onSurface.withOpacity(0.58),
                            ),
                          ),
                          onChanged: onChanged,
                        ),
                      ),
                      if (hasText)
                        IconButton(
                          padding: EdgeInsets.zero,
                          visualDensity: VisualDensity.compact,
                          icon: Icon(
                            Icons.close_rounded,
                            size: 20,
                            color: colorScheme.onSurface.withOpacity(0.75),
                          ),
                          onPressed: () {
                            controller.clear();
                            onChanged('');
                            focusNode.requestFocus();
                          },
                        ),
                    ],
                  ),
                ),
              ),
            ),
            if (errorText != null && errorText!.trim().isNotEmpty) ...[
              const SizedBox(height: 8),
              _InlineFieldError(message: errorText!),
            ],
          ],
        );
      },
    );
  }
}

class _InlineFieldError extends StatelessWidget {
  const _InlineFieldError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Icon(
          Icons.error_outline_rounded,
          size: 16,
          color: theme.colorScheme.error,
        ),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            message,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.error,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      ],
    );
  }
}
