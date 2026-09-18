# Recomp notifications — proposed v1

Status: design for review; no push subscriptions, scheduled jobs or notifications have been created.

## Product direction

A quiet companion for daily logging. Notifications offer one useful next action, use neutral language, and never compare members or shame weight/food choices. Keep the journal visual style in the app. The operating system controls the appearance of notifications outside the app.

## Reminder catalogue

All initial schedules use Asia/Bangkok and can be changed by the account owner.

| Type | Proposed time | Eligibility | Example copy | Destination |
| --- | --- | --- | --- | --- |
| Morning weigh-in | 07:30 | No weight logged for today | เช้านี้มีเวลาสักนาทีไหม — บันทึกน้ำหนัก แล้วไปต่อกับวันของคุณ | Today's log, weight section |
| Evening check-in | 20:30 | Calories or protein has not been recorded | เก็บบันทึกวันนี้อีกนิด — เพิ่มมื้ออาหารที่ยังไม่ได้บันทึก | Today's log, nutrition section |
| Planned workout | 18:00, selected workout days | No strength session or manually completed workout; not a rest/sick/vacation day | วันนี้มีนัดกับตัวเอง — เปิดตารางฝึกของคุณเมื่อพร้อม | Workout |
| Weekly reflection | Sunday 19:00 | At least one eligible log in the last seven days | มองย้อนดูสัปดาห์นี้ — ดูสิ่งที่บันทึกไว้และแนวโน้มของคุณ | Progress, weekly summary |

After explicit opt-in, suggest morning and evening reminders. Workout and weekly reminders are optional. Do not enable remote push merely because old local notification preferences were enabled.

## Attention rules

- Maximum two scheduled notifications per member per local day; a test notification is an explicit exception, with a server-side rate limit.
- At most one notification of each type per day (weekly reflection once per calendar week).
- Quiet hours default to 21:30–07:00; allow an overnight interval. Drop reminders that fall inside quiet hours rather than delivering a backlog in the morning.
- Allow pause for today / seven days / until re-enabled. Pause scheduled reminders on sick or vacation days.
- Evaluate data again just before dispatch. If the action was completed and synced, suppress the reminder.
- On Sundays, an enabled and eligible weekly reflection replaces the evening check-in. All reminder types share the same daily budget; earlier reminders can exhaust it. Explain this limit in settings.
- Expire time-sensitive reminder messages after 15 minutes. Do not send yesterday's reminders after reconnecting.
- Decisions use the latest server-synced log. Offline edits cannot suppress a server reminder until sync completes; avoid accusatory claims in the copy.
- No weight, body-fat, calorie totals or member comparisons in lock-screen text by default.

## Settings and onboarding

The bell opens a dedicated “การแจ้งเตือน” sheet, separated from account sync and Apple Health pairing.

Order of content:

1. Device status: not installed / not enabled / permission denied / connected / subscription needs attention. Show the authenticated member receiving reminders.
2. Primary action: “เปิดแจ้งเตือนบนเครื่องนี้”. On iPhone, guide installation on the Home Screen and reopening from that icon first. Request OS permission only after the explicit button tap.
3. Four reminder rows: title, short purpose, switch, time, and weekday selector where relevant. Show an in-app preview of the proposed message before enabling.
4. Quiet hours and pause controls. Display the two-per-day limit alongside these controls.
5. Devices: this device, last registration, set primary device, disable a device. Default to one primary device to avoid duplicate alerts across a phone and laptop.
6. “ส่งแจ้งเตือนทดสอบ” and last attempt status. Label server acceptance as “ส่งให้ระบบแจ้งเตือนแล้ว”, not “ได้รับแล้ว”. A user confirms receipt on their device.

Do not immediately show the OS prompt on launch. First show a dismissible invitation after a successful daily log. A dismissed invitation remains dismissed; settings always provide a manual entry point.

If permission was denied, show instructions to change notification settings. Do not keep requesting permission or label an installed iPhone as unsupported merely because permission is denied.

## Opening a notification

- Push payload uses an allowlisted destination and event ID, not arbitrary external URLs.
- Reuse an existing app window when possible, otherwise open the PWA.
- After sign-in and membership verification, select the authenticated member's profile, route to the correct page and reveal the indicated section.
- A reminder is always owned by the signed-in member. Switching “Viewing as” must not subscribe a device to someone else's health reminders.
- If the reminder is from an earlier day, display the date and open the relevant past log where supported; do not silently write to today's log.
- No interactive notification action buttons are required for v1. The notification body itself is the cross-platform entry point.

## Implementation outline

Reuse Firebase Auth, Realtime Database and Cloud Functions. Add standards-based Web Push subscriptions, VAPID credentials stored as server secrets, and a scheduled function that evaluates due reminders. Extend the existing service worker with push handling and routing.

Proposed data, outside the existing shared backup/reset payload:

```text
recompChallenges/{challengeId}/notifications/{uid}/
  preferences       enabled types, schedules, timezone, quiet hours, pauseUntil
  devices/{id}      subscription, primary, enabled, registeredAt
  delivery/{key}    type, scheduledDate, state, leaseUntil, attempts, sentAt
```

Server endpoints derive the UID and profile from verified membership. Clients cannot choose a recipient UID, read another member's endpoints, modify delivery records or supply unrestricted push URLs. Validate endpoint destinations to prevent arbitrary server-side requests. Do not log subscription secrets or put them in exported health backups.

Remote reminder preferences become per-member; the current shared preferences remain available for unrelated settings. Migration can offer existing local times as a starting point, but starts push delivery disabled.

Use a transaction to reserve a delivery and daily budget before sending. Key by member, local date and reminder type. Store dispatch outcomes and expire invalid subscriptions. Treat ambiguous network results conservatively to limit duplicates; Web Push does not provide an exactly-once display guarantee. On supported clients use a stable notification tag and recent-event deduplication.

Once a device uses remote push, stop its current foreground timer from independently issuing the same reminders. Enabling/disabling, sign-out and changing the primary device must update server registration as well as local UI.

## Acceptance checks

- Installed iPhone PWA receives an opted-in notification while not open; tapping it reaches the intended page after authentication.
- Permission denied, unsupported browser and missing Home Screen installation have distinct useful UI.
- A synced completed action suppresses its reminder; overnight quiet hours, pauses and date rollover are respected.
- Repeated scheduler invocations do not reserve the same event twice or exceed the two-per-day budget.
- One member's device never receives another member's reminders, including after switching the viewed profile or signing out.
- Expired subscriptions and transient send failures are handled without retry storms; accepted delivery is not presented as confirmed receipt.
- Legacy foreground reminders do not duplicate server reminders.
- Physical iPhone verification is required before describing closed-app delivery as tested. Browser emulation alone does not verify iOS push delivery.

## Primary references

- [Apple: sending web push notifications](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)
- [WebKit: iPhone Home Screen push and permission requirements](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [Firebase: scheduled functions](https://firebase.google.com/docs/functions/schedule-functions)
