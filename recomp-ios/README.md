# Recomp for iPhone (SwiftUI)

Native iOS app with a separate bundle ID (`com.korakritinsa.recomp`). It runs alongside the web app and the original `Recomp Health` companion while sharing the same challenge data. The interface direction and feature rules are in [DESIGN.md](DESIGN.md).

The five tabs cover today's dashboard, the meal and daily journal, progress and comparison, strength and quick activity, and profile settings. Food capture supports the camera, photo library, typed descriptions, full-day text, manual input, and the same 65 food presets as the web app. Estimates are reviewed before saving. The Profile tab manages HealthKit sync, calorie target, local reminder schedules, and JSON export; the web app remains available for backup import and recovery.

## Connect

1. In the web app, sign in and open **Sync และการแจ้งเตือน → Recomp SwiftUI → สร้าง token สำหรับ SwiftUI**.
2. Open **โปรไฟล์** in the iPhone app, select the same profile, paste the endpoint and token, then connect.
3. Authorize Apple Health in the app and sync the latest 14 days. Apple Watch measurements arrive through HealthKit on the paired iPhone.

The pairing token is stored in iPhone Keychain. Creating a new token or revoking it on the web invalidates the old one. The iOS server endpoint checks the token and profile before reading or writing data. Gemini food/photo/text calls run through Cloud Functions; the AI key is never bundled into the app. AI estimates are drafts until the user confirms them.

## Build

Requires Xcode, XcodeGen, and iOS 17 or newer. HealthKit requires a physical iPhone for meaningful testing.

```bash
cd recomp-ios
xcodegen generate --spec project.yml
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project Recomp.xcodeproj -scheme Recomp \
  -destination 'platform=iOS Simulator,id=C715EC38-AA87-4AD5-A7D1-FC378DC9504D' \
  CODE_SIGNING_ALLOWED=NO build
```

Use an available simulator ID from `xcrun simctl list devices available` in place of the example. For a physical iPhone, select its device in Xcode and use the correct Development Team for signing.

The project imports `HealthKitManager.swift` and `Models.swift` from `../recomp-health-ios`. Keep both folders together. The decoder smoke check is `Tests/DecodingSmoke.swift`; it covers legacy string meal items and newer object meal items.
