# Recomp Health Companion

Native iPhone bridge from Apple Health/Apple Watch to the existing Recomp Firebase challenge. A separate watchOS target is not required because Apple Watch writes its samples to HealthKit on the paired iPhone.

## What it reads

- Step count and active energy
- Sleep duration (overlapping sources are merged to avoid double counting)
- Latest daily body mass, body-fat percentage, and lean body mass
- Workout type, duration, active energy, and distance

The server never replaces a manually entered Recomp value. It only fills an empty field or refreshes a value whose recorded source is already `appleHealth`.

## Run on an iPhone

1. Install the full Xcode application from Apple. Command Line Tools alone cannot sign or run HealthKit apps.
2. Open `RecompHealth.xcodeproj` and select your Apple Development Team under Signing & Capabilities.
3. Connect a physical iPhone; HealthKit background delivery must be tested on a device.
4. In the Recomp web app, sign in and open **Realtime sync & reminders → Apple Health · Beta → Create pairing token**.
5. Paste the endpoint, profile, and one-time token into the companion app, then tap **Save connection**.
6. Tap **Allow Apple Health**, choose the data types to share, and run the first 14-day sync.

The pairing token is stored in the iPhone Keychain. Generating a new token immediately invalidates the previous token. Disconnect from the web app to revoke server access.

## Regenerate the project

The checked-in Xcode project is generated from `project.yml`:

```bash
brew install xcodegen
xcodegen generate
```
