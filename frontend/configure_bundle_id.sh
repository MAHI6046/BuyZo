#!/bin/bash

# Script to configure bundle ID for iOS and Android
# Run this after: flutter create . --platforms=ios,android,web

BUNDLE_ID="com.anydot.app"

echo "Configuring bundle ID: $BUNDLE_ID"

# Android configuration
if [ -f "android/app/build.gradle" ]; then
    echo "Configuring Android bundle ID..."
    # Update applicationId in build.gradle
    sed -i '' "s/applicationId \"[^\"]*\"/applicationId \"$BUNDLE_ID\"/g" android/app/build.gradle
    echo "✓ Android bundle ID configured"
else
    echo "⚠ Android build.gradle not found. Run 'flutter create .' first."
fi

# iOS configuration
if [ -f "ios/Runner.xcodeproj/project.pbxproj" ]; then
    echo "Configuring iOS bundle ID..."
    # Update PRODUCT_BUNDLE_IDENTIFIER in project.pbxproj
    sed -i '' "s/PRODUCT_BUNDLE_IDENTIFIER = [^;]*/PRODUCT_BUNDLE_IDENTIFIER = $BUNDLE_ID/g" ios/Runner.xcodeproj/project.pbxproj
    echo "✓ iOS bundle ID configured"
else
    echo "⚠ iOS project.pbxproj not found. Run 'flutter create .' first."
fi

echo ""
echo "Bundle ID configuration complete!"
echo "Bundle ID set to: $BUNDLE_ID"
