class AppConstants {
  AppConstants._();

  // Platform currency (single-country deployment)
  static const String platformCurrency = 'inr';
  static const String platformCurrencySymbol = '₹';

  // Asset paths
  static const String logoPath = 'assets/images/Logo.PNG';

  // Animation durations
  static const Duration shortAnimationDuration = Duration(milliseconds: 200);
  static const Duration mediumAnimationDuration = Duration(milliseconds: 300);
  static const Duration longAnimationDuration = Duration(milliseconds: 500);

  // UI Constants
  static const double defaultPadding = 16.0;
  static const double defaultBorderRadius = 12.0;
  static const double largeBorderRadius = 24.0;
  static const double smallBorderRadius = 8.0;
}
