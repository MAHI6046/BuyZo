import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'app_colors.dart';
import '../constants/app_constants.dart';

class AppTheme {
  AppTheme._();

  static ThemeData get lightTheme {
    return ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.light(
        primary: AppColors.lightPrimary,
        primaryContainer: AppColors.lightPrimaryVariant,
        secondary: AppColors.lightSecondary,
        secondaryContainer: AppColors.lightSecondaryVariant,
        surface: AppColors.lightSurface,
        background: AppColors.lightBackground,
        error: AppColors.lightError,
        onPrimary: AppColors.lightOnPrimary,
        onSecondary: AppColors.lightOnSecondary,
        onSurface: AppColors.lightOnSurface,
        onBackground: AppColors.lightOnBackground,
        onError: AppColors.lightOnError,
        outline: AppColors.lightOutline,
        outlineVariant: AppColors.lightOutlineVariant,
        surfaceVariant: AppColors.lightSurfaceVariant,
      ),
      scaffoldBackgroundColor: AppColors.lightBackground,
      textTheme: _textTheme(AppColors.lightOnBackground),
      inputDecorationTheme: _inputDecorationTheme(
        AppColors.lightOutline,
        AppColors.lightPrimary,
        AppColors.lightSurfaceVariant,
      ),
      elevatedButtonTheme: _elevatedButtonTheme(),
      cardTheme: _cardTheme(),
      appBarTheme: _appBarTheme(
        AppColors.lightBackground,
        AppColors.lightOnSurface,
      ),
      snackBarTheme: _snackBarTheme(
        isDark: false,
        surface: AppColors.lightSurface,
        onSurface: AppColors.lightOnSurface,
        outline: AppColors.lightOutline,
      ),
    );
  }

  static ThemeData get darkTheme {
    return ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.dark(
        primary: AppColors.darkPrimary,
        primaryContainer: AppColors.darkPrimaryVariant,
        secondary: AppColors.darkSecondary,
        secondaryContainer: AppColors.darkSecondaryVariant,
        surface: AppColors.darkSurface,
        background: AppColors.darkBackground,
        error: AppColors.darkError,
        onPrimary: AppColors.darkOnPrimary,
        onSecondary: AppColors.darkOnSecondary,
        onSurface: AppColors.darkOnSurface,
        onBackground: AppColors.darkOnBackground,
        onError: AppColors.darkOnError,
        outline: AppColors.darkOutline,
        outlineVariant: AppColors.darkOutlineVariant,
        surfaceVariant: AppColors.darkSurfaceVariant,
      ),
      scaffoldBackgroundColor: AppColors.darkBackground,
      textTheme: _textTheme(AppColors.darkOnBackground),
      inputDecorationTheme: _inputDecorationTheme(
        AppColors.darkOutline,
        AppColors.darkPrimary,
        AppColors.darkSurfaceVariant,
      ),
      elevatedButtonTheme: _elevatedButtonTheme(),
      cardTheme: _cardTheme(),
      appBarTheme: _appBarTheme(
        AppColors.darkBackground,
        AppColors.darkOnSurface,
      ),
      snackBarTheme: _snackBarTheme(
        isDark: true,
        surface: AppColors.darkSurface,
        onSurface: AppColors.darkOnSurface,
        outline: AppColors.darkOutline,
      ),
    );
  }

  static TextTheme _textTheme(Color textColor) {
    return TextTheme(
      displayLarge: GoogleFonts.poppins(
        fontSize: 57,
        fontWeight: FontWeight.w400,
        letterSpacing: -0.25,
        color: textColor,
      ),
      displayMedium: GoogleFonts.poppins(
        fontSize: 45,
        fontWeight: FontWeight.w400,
        letterSpacing: 0,
        color: textColor,
      ),
      displaySmall: GoogleFonts.poppins(
        fontSize: 36,
        fontWeight: FontWeight.w400,
        letterSpacing: 0,
        color: textColor,
      ),
      headlineLarge: GoogleFonts.poppins(
        fontSize: 32,
        fontWeight: FontWeight.w600,
        letterSpacing: 0,
        color: textColor,
      ),
      headlineMedium: GoogleFonts.poppins(
        fontSize: 28,
        fontWeight: FontWeight.w600,
        letterSpacing: 0,
        color: textColor,
      ),
      headlineSmall: GoogleFonts.poppins(
        fontSize: 24,
        fontWeight: FontWeight.w600,
        letterSpacing: 0,
        color: textColor,
      ),
      titleLarge: GoogleFonts.poppins(
        fontSize: 22,
        fontWeight: FontWeight.w600,
        letterSpacing: 0,
        color: textColor,
      ),
      titleMedium: GoogleFonts.poppins(
        fontSize: 16,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.15,
        color: textColor,
      ),
      titleSmall: GoogleFonts.poppins(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.1,
        color: textColor,
      ),
      bodyLarge: GoogleFonts.poppins(
        fontSize: 16,
        fontWeight: FontWeight.w400,
        letterSpacing: 0.5,
        color: textColor,
      ),
      bodyMedium: GoogleFonts.poppins(
        fontSize: 14,
        fontWeight: FontWeight.w400,
        letterSpacing: 0.25,
        color: textColor,
      ),
      bodySmall: GoogleFonts.poppins(
        fontSize: 12,
        fontWeight: FontWeight.w400,
        letterSpacing: 0.4,
        color: textColor,
      ),
      labelLarge: GoogleFonts.poppins(
        fontSize: 14,
        fontWeight: FontWeight.w500,
        letterSpacing: 0.1,
        color: textColor,
      ),
      labelMedium: GoogleFonts.poppins(
        fontSize: 12,
        fontWeight: FontWeight.w500,
        letterSpacing: 0.5,
        color: textColor,
      ),
      labelSmall: GoogleFonts.poppins(
        fontSize: 11,
        fontWeight: FontWeight.w500,
        letterSpacing: 0.5,
        color: textColor,
      ),
    );
  }

  static InputDecorationTheme _inputDecorationTheme(
    Color borderColor,
    Color focusedBorderColor,
    Color backgroundColor,
  ) {
    return InputDecorationTheme(
      filled: true,
      fillColor: backgroundColor,
      contentPadding: const EdgeInsets.symmetric(
        horizontal: AppConstants.defaultPadding,
        vertical: 16,
      ),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppConstants.defaultBorderRadius),
        borderSide: BorderSide(color: borderColor, width: 1.5),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppConstants.defaultBorderRadius),
        borderSide: BorderSide(color: borderColor, width: 1.5),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppConstants.defaultBorderRadius),
        borderSide: BorderSide(color: focusedBorderColor, width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppConstants.defaultBorderRadius),
        borderSide: const BorderSide(color: AppColors.lightError, width: 1.5),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppConstants.defaultBorderRadius),
        borderSide: const BorderSide(color: AppColors.lightError, width: 2),
      ),
      labelStyle: GoogleFonts.poppins(
        fontSize: 14,
        fontWeight: FontWeight.w400,
      ),
    );
  }

  static ElevatedButtonThemeData _elevatedButtonTheme() {
    return ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        elevation: 0,
        padding: const EdgeInsets.symmetric(
          horizontal: 24,
          vertical: 16,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppConstants.defaultBorderRadius),
        ),
        textStyle: GoogleFonts.poppins(
          fontSize: 16,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.1,
        ),
      ),
    );
  }

  static CardThemeData _cardTheme() {
    return CardThemeData(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppConstants.defaultBorderRadius),
        side: BorderSide.none,
      ),
      margin: EdgeInsets.zero,
    );
  }

  static AppBarTheme _appBarTheme(
      Color backgroundColor, Color foregroundColor) {
    return AppBarTheme(
      elevation: 0,
      centerTitle: false,
      backgroundColor: backgroundColor,
      foregroundColor: foregroundColor,
      titleTextStyle: GoogleFonts.poppins(
        fontSize: 22,
        fontWeight: FontWeight.w600,
        color: foregroundColor,
      ),
    );
  }

  static SnackBarThemeData _snackBarTheme({
    required bool isDark,
    required Color surface,
    required Color onSurface,
    required Color outline,
  }) {
    final blendedBackground = Color.alphaBlend(
      (isDark ? Colors.white : Colors.black).withOpacity(isDark ? 0.14 : 0.08),
      surface,
    );

    return SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: blendedBackground.withOpacity(isDark ? 0.9 : 0.94),
      elevation: 0,
      insetPadding: const EdgeInsets.fromLTRB(12, 0, 12, 18),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(
          color: outline.withOpacity(isDark ? 0.62 : 0.42),
          width: 1.1,
        ),
      ),
      contentTextStyle: GoogleFonts.poppins(
        fontSize: 13.5,
        fontWeight: FontWeight.w500,
        color: onSurface.withOpacity(0.96),
      ),
    );
  }
}
