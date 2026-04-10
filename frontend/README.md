# Festive Flavours - Flutter Mobile & Web App

Production-grade e-commerce application for homemade foods built with Flutter.

## Features

- ✅ Premium UI/UX with Material Design 3
- ✅ Light & Dark Mode Support
- ✅ Clean Architecture
- ✅ Production-ready code structure
- ✅ Scalable and maintainable
- ✅ DOTBOT assistant (text + voice) for quick add-to-cart actions

## Getting Started

### Prerequisites

- Flutter SDK (3.0.0 or higher)
- Dart SDK (3.0.0 or higher)

### Installation

1. Install dependencies:
```bash
flutter pub get
```

2. Run the app:
```bash
flutter run
```

For this backend, prefer:

```bash
./scripts/run_main.sh
```

### Driver App With Env Auto-Load

To run the driver app without manually passing `--dart-define` each time:

```bash
./scripts/run_driver.sh
```

This script reads `APP_CLIENT_KEY` from `backend/.env` and sets:
- `BACKEND_BASE_URL` (default: `https://anydot-backend.vercel.app`)
- `APP_CLIENT_KEY`
- `USE_APP_CHECK=true`

Optional overrides:

```bash
BACKEND_BASE_URL=https://your-backend-url.vercel.app ./scripts/run_driver.sh
BACKEND_ENV_FILE=/path/to/backend/.env ./scripts/run_driver.sh
USE_APP_CHECK=false ./scripts/run_driver.sh
```

### Main App With Env Auto-Load

To run the customer/main app with backend URL and app key from `backend/.env`:

```bash
./scripts/run_main.sh
```

Optional overrides:

```bash
BACKEND_BASE_URL=https://your-backend-url.vercel.app ./scripts/run_main.sh
BACKEND_ENV_FILE=/path/to/backend/.env ./scripts/run_main.sh
USE_APP_CHECK=true ./scripts/run_main.sh
```

## Project Structure

```
lib/
├── core/                    # Core functionality
│   ├── app/                # App configuration
│   ├── constants/          # App constants
│   ├── theme/              # Theme configuration
│   └── utils/              # Utility functions
├── features/               # Feature modules (Clean Architecture)
│   ├── auth/              # Authentication feature
│   │   ├── data/          # Data layer
│   │   ├── domain/        # Domain layer
│   │   └── presentation/  # Presentation layer
│   └── home/              # Home feature
│       ├── data/
│       ├── domain/
│       └── presentation/
├── shared/                 # Shared widgets and utilities
│   └── widgets/           # Reusable widgets
```

## Architecture

The project follows Clean Architecture principles:

- **Presentation Layer**: UI components, widgets, pages
- **Domain Layer**: Business logic, entities, use cases
- **Data Layer**: Data sources, repositories implementation

## Theme

The app includes a comprehensive theme system with:
- Light mode theme
- Dark mode theme
- Material Design 3 color scheme
- Custom typography using Google Fonts (Poppins)

## Building for Production

### Android
```bash
flutter build apk --release
# or
flutter build appbundle --release
```

For this backend, build customer APK with env-loaded defines:

```bash
./scripts/build_main_apk.sh
```

This sets:
- `BACKEND_BASE_URL` (default: `https://anydot-backend.vercel.app`)
- `APP_CLIENT_KEY` (from `backend/.env`)
- `USE_APP_CHECK` (default: `false`)

### iOS
```bash
flutter build ios --release
```

### Web
```bash
flutter build web --release
```

## License

Copyright © 2024 Festive Flavours
