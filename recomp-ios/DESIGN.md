# Recomp iOS — native redesign

## Direction

An editorial, light-first health journal: calm spacing, strong type, few surfaces, and clear next actions. The app must feel like iOS, not a card-heavy copy of the website. Keep the existing web app and Health companion running alongside this app. Use the same Firebase challenge data and pairing token; do not fork user data.

### Visual system

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| Canvas | `#F7F5F2` | `#111522` | Main reading surface |
| Surface | `#FFFFFF` | `#1C2232` | Sheets and selected content |
| Ink | `#1B2235` | `#F4F5FA` | Primary text |
| Secondary | `#687184` | `#A9B1C0` | Captions and metadata |
| Brand | `#4557D8` | `#A6B1FF` | Selected controls and primary action |
| Food | `#EF8274` | `#FF9D91` | Nutrition only |
| Water | `#3D9BCB` | `#7BC8E9` | Hydration only |
| Activity | `#6F78D5` | `#A9AFF6` | Movement only |

No green theme, forced dark appearance, decorative gradients, or repeated equal-weight cards. Supply adaptive Color Sets; use semantic system colors where possible. SF Symbols, SF type, Dynamic Type, VoiceOver labels, and light/dark/high-contrast states are part of the implementation. Replace the green app icon with a minimal indigo/cream `r.` mark.

## Navigation and screens

Use native `TabView` with five stable tabs: **Today**, **Journal**, **Progress**, **Train**, **Profile**. Use `NavigationStack`, toolbar actions, system sheets with appropriate detents, and native pickers. Avoid custom tab bars and web views.

1. **Today** — one clear calorie summary (eaten vs target), protein and water progress, a contextual next step, Apple Health metrics with sync freshness, today's meal timeline, and a compact weight trend. Missing data is `—`, never `0` unless recorded.
2. **Journal** — date navigation and meals (breakfast, lunch, dinner, snacks). A prominent Add action opens a native sheet for **photo**, **typed food**, **full-day text**, **food library**, and **manual entry**. AI output is an editable draft with serving/quantity/nutrients and a separate Confirm action. Water shortcuts, weight, sleep, activity and notes stay easy to reach. Never save AI output before review.
3. **Progress** — Swift Charts for weight and adherence, 7/30-day filters, weekly evidence and one suggested action, 16-week roadmap, and comparison with the other challenge member. Round sleep to hours/minutes and other measurements to useful precision.
4. **Train** — strength plans A/B, quick activity entry, workout history, and Apple Health workouts. Preserve the web's workout records.
5. **Profile** — personal targets and plan adjustments, HealthKit access/sync status, secure pairing, reminders and data tools (export/import/reset) under secondary settings. Keep destructive actions behind confirmation.

## Feature/data rules

- Keep `com.korakritinsa.recomp` as the bundle ID so updates preserve the installed app and token. Do not change the old `recomp-health-ios` project or web routes.
- The web and native app share `recompChallenges/16-week-2026`. Read changes on launch/foreground and after writes; offer manual refresh. A write changes only explicitly edited fields and preserves unknown keys, meal history and HealthKit source metadata.
- The native API authenticates with the existing per-profile pairing token in Keychain. It must reject cross-profile writes. The web app remains the place to create/revoke the token.
- Keep legacy meal `items` that are strings as well as newer object items readable. Do not decode the whole snapshot as invalid because one optional item is malformed.
- Resize food photos on-device, send JPEG without original location metadata, cap payload size, and call the existing server-side Gemini model. Native screens must not contain an AI API key. Clearly label estimates and require review before saving.
- Apple Watch data arrives through HealthKit on the paired iPhone. Show sample freshness and source. Manual values continue to take precedence over HealthKit updates as implemented in the current merge logic.
- The first visible actions should be food capture and daily status. Advanced settings and backup tools should not dominate the main screens.

## Server/native contract for this redesign

The root agent owns `functions/recompNative.js`, `functions/index.js`, `RecompStore.swift`, and `NativePayload.swift`. The implementation agent owns SwiftUI views, adaptive theme assets, and the icon. Coordinate additional store methods through messages; do not edit the root-owned files concurrently.

Store-facing methods to use or request:

- Existing: `refresh()`, `save(date:fields:)`, `authorizeHealth()`, `syncHealth()` and connection methods.
- Planned: `estimateFood(description:imageJPEG:)`, `parseDailyText(_:)`, `addFoods(date:meal:foods:)`, `saveWorkout(_:)`, `updatePlan(_:)`, `updatePreferences(_:)`, and `exportSnapshot()`.
- Planned published state: full daily logs, workouts, Health workouts, preferences, plan, comparison summary, plus explicit loading/error states.

The backend validates every action, bounds all numeric/string/image inputs, scopes writes to the paired profile, and updates Firebase in transactions. Food/photo/text results must be drafts until the user confirms them.

## Acceptance

- Build and launch on iOS Simulator and the connected physical iPhone.
- Works in light and dark appearance; no green brand elements remain in the SwiftUI app.
- Core web journeys (food photo/text/full-day AI, meal log, water, workout, trends, comparison, Health sync, plan/profile) are native and use shared data. Peripheral export/import and reminders can live in Settings but must be reachable.
- A real snapshot with legacy string meal items decodes; manual/native writes do not erase unknown web fields or Apple Health metadata.
- No automatic saving of AI estimates. Error and empty states identify the next useful action.

## Apple design references

Apple recommends stable tab bars, adaptive semantic colors and dark mode, and short, forgiving data-entry flows: [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars), [Color](https://developer.apple.com/design/human-interface-guidelines/color), [Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode), [Entering data](https://developer.apple.com/design/human-interface-guidelines/entering-data).
