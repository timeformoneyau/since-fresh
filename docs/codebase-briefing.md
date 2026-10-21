# Since — Codebase & Product Briefing

> Audience: an LLM or developer picking this up to help build it, working alongside a product manager.
> Everything here is pulled from the code — no assumptions. Keep it updated as the app evolves.

---

## 1. What it is

**Since** is a mobile app (Expo / React Native, Android-first) that tracks **things you
don't do often enough** and quietly reminds you when they're due.

- Tagline: **"Know how long it's been."**
- Empty-state pitch: *"Track the things you don't do often enough and we'll keep count for you."*

The mental model is deliberately **not** a calendar or to-do app. There are no appointments and
no hard deadlines — just recurring real-life maintenance (dentist, car service, smoke-alarm
battery, air filter) where the value is knowing **how long it's been** and getting a gentle nudge,
not being nagged.

Food tracking (scanning use-by dates) used to live here and was removed in October 2026; it now
belongs to a separate app, UseBy.

---

## 2. Repos

| Repo | Path | Role |
|---|---|---|
| **since-fresh** | this repo | The Expo/RN mobile app. Local-first storage; optional Supabase account, sync and households. |

There is also an older `timeformoneyau/since` repo — the original version this project is a
rebuild of. Its auth, cloud sync, category grouping and completion-history work was consolidated
into `since-fresh` in August 2026; `since-fresh` is the surviving codebase. Note `since` still
holds an unmerged `sdk51-clean` branch (event logging, OCR, Hedera proofs) that was deliberately
deferred, not ported.

---

## 3. Tech stack

- **Expo SDK 54**, React Native 0.81, React 19, new architecture enabled.
- **React Navigation** (native-stack) — 10 screens (section 6).
- **AsyncStorage** for persistence — the source of truth. Every write lands locally first and
  works offline. Keys: `@since_v1_items` (the list, storage version 3), `@since_sync_queue_v1`
  (changes waiting to sync), `@since_sync_cursor_v1`, `@since_last_synced_v1`, `@since_owner_v1`
  (which account owns this phone's list), `@since_household_v1` (cached household),
  `@since_snoozes_v1` (snoozes, this phone only), `@since_reminder_time_v1` (reminder time,
  this phone only).
- **Supabase** (`@supabase/supabase-js`) for the optional account (emailed code), sync and
  households. Absent credentials means the app runs purely local-only, with no sign-in.
- **expo-notifications** for **local** (not push) reminders.
- **date-fns** for all date math; **expo-crypto** for UUIDs.
- **expo-file-system**, **expo-sharing**, **expo-document-picker** for the backup file.
- **expo-updates** for over-the-air updates (EAS Update, fingerprint runtime version).
- **expo-constants** to read config from `extra` (Supabase keys from `app.json`).
- Fonts Instrument Sans / Instrument Serif; design tokens in `src/theme/tokens.ts`.

---

## 4. Core data model (exact)

`src/types/index.ts` — the single domain entity is `SinceItem`:

```ts
type RepeatUnit = 'days' | 'weeks' | 'months' | 'years';

interface CompletionEvent {      // one history entry
  id: string;
  date: string;                  // YYYY-MM-DD, a local calendar date
  note?: string;
  createdAt?: string;
  createdBy?: string;            // account that recorded it, for "Done by"
}

interface SinceItem {
  id: string;
  name: string;
  category: string;
  lastDoneDate: string;          // YYYY-MM-DD; always history[0].date, kept for older builds
  history: CompletionEvent[];    // newest first, never empty
  repeatValue: number | null;    // null = "Once off" (no reminders)
  repeatUnit: RepeatUnit | null;
  createdAt: string;
  updatedAt: string;
  ownerId?: string;              // set only on another member's shared item
  householdId?: string;          // set only on shared items
}

const DEFAULT_CATEGORIES =
  ['Household','Health','Auto','Family','Admin','Finance','Purchases','Other'];
```

Due date: `nextDueDate = lastDoneDate + repeatValue · repeatUnit`. Items with no repeat are
"Once off" (formerly "Tracked only"). Storage v3 converted any leftover scanned-food items to
once off. Stored data changes are additive only (rollbacks run older code on newer data); every
new shape gets a case in `src/domain/items/migrations.test.ts`.

Cloud (`supabase/schema.sql`, migrations `002`–`004`): `items` (server-set `server_updated_at`,
`kind`, `household_id`), `deleted_items` (tombstones), `completion_events` (one row per entry,
soft deleted), `households`, `household_members`, `household_invites`, `item_mutes`.
Membership changes only through database functions (`create_household`, `create_invite`,
`join_household`, `leave_household`, `remove_member`, `transfer_ownership`,
`delete_household`, `delete_user`).

---

## 5. The status system (the heart of the product)

`src/utils/statusUtils.ts` → `computeItemStatus()` converts days-until-due into one of six labels.
This wording is central to the product's voice.

| Label | When (days until due) | Card accent |
|---|---|---|
| `All good` | beyond the "coming up" window | neutral grey |
| `Coming up` | within advance-notice window (1–45 days by interval) | amber |
| `About now` | −2 to 0 | amber |
| `It's been a while` | −3 to −14 | rust |
| `Getting overdue` | −15 to −45 | red |
| `Long overdue` | beyond −45 | dark red |
| `null` → shown as **"Once off"** | item has no repeat interval | muted |

- Secondary line per card: "Next in N days" / "Tomorrow" / "Due today" / "Overdue by N days".
- Each card also shows "Done today" / "Last done yesterday" / "Last done N days ago".
- List is sorted most-urgent-first (`sortItems`): overdue groups first (most overdue first),
  then upcoming (nearest first), non-repeating last.

---

## 6. Screens & navigation (`App.tsx`)

One stack, `AppNavigator`: `Main`, `Add`, `Edit`, `Detail`, `EditEntry`, `Account`, `SignIn`,
`EnterCode`, `ChangeEmail`, `HouseholdSetup`. Signing in is optional: the list always opens first. `Account` (titled
"Backup" in a local-only build) offers "Back up and sync" when cloud sync is configured, and always
offers a backup file: export a JSON file through the share sheet, or restore one, which only adds
what's missing (`domain/backup/backup.ts`). Sign-in is by emailed code only,
no passwords (`domain/auth/codes.ts`); the same code creates an account for a new address.

- **Main** (`MainListScreen`) — one `FlatList`, sorted most-urgent-first (`sortItems`). Each
  `ItemCard` has a "Done" button (marks done today), Edit and Delete buttons, a progress bar
  through the interval, and a Household tag on shared items. In a household, an
  All / Just me / Household filter sits above the list. Done and Delete each show a toast with **Undo**
  (`undoMarkDone` / `restoreDeletedItem` in `service.ts`; a restored item takes a new id
  because the old one is tombstoned in the cloud). A one-line `SystemStatus` summary sits under the header
  ("All good. Nothing needs attention." / "A few things might need attention." …). Header has
  the Account button and **＋** (add). Empty state shows "Add something" and a list of
  **starters** (smoke alarm battery, dentist, car service, car rego, air-con filter, gutters,
  pest inspection, eye test) from `suggestions.ts`: a tap opens Add filled in with the name,
  category and usual gap; nothing is saved until "Track this". A snoozed card adds
  "Snoozed until Tuesday" under its (unchanged) status. Opening the list (on focus) runs a
  sync, and so does coming back to the app from the background (`useSyncOnResume`).
- **Add** (`AddItemScreen`) and **Edit** (`EditItemScreen`) share `ItemForm`: name, "Who is
  this for?" (Just me / Household; only in a household, only for the item's creator), "Repeats"
  (every N days/weeks/months/years) or "Once off", last-done date, category. Add shows a keyword
  **suggestion** (`suggestions.ts`). Save buttons: "Track this" / "Save changes". Edit also has
  Delete (no confirm; Undo toast), offered only where the household rules allow it.
- **Detail** (`DetailScreen`) — status card, "Mark done today", **"Not yet"** (only when due
  or overdue: snooze reminders for 3 days, 1 week or 1 month, with Undo), "Add a past entry",
  "Remind me about this" switch (shared items), and the history; each entry shows "Done by {name}" on shared
  items and opens **EditEntry** (`EditHistoryEntryScreen`: change date or note, or delete).
- **Account** (titled "Settings" in a local-only build) — always: **Reminders** (the time of
  day reminders come: 7 am, 8 am, 9 am (default), 12 pm, 6 pm or 8 pm). Signed out: "Back up and sync" (→ `SignIn` → `EnterCode`). Signed in: email,
  last backup and Sync now, the Household section (create / join via `HouseholdSetup`, invite
  and share the code, members, make owner, remove, leave, delete), change email, sign out
  (warns if changes haven't synced), delete account. Always: the backup file section.

---

## 7. Notifications (`src/notifications/plan.ts`, `engine.ts`, `scheduler.ts`)

Stated design philosophy (in the code): **"a quiet, reliable system that only speaks up when it
matters."** Local notifications only (no server push). What to schedule is worked out by
`plan.ts`, which is pure and unit tested (`plan.test.ts`); `engine.ts` only cancels and
schedules. Per repeating item, up to 3 lifecycle notifications fire at the **reminder time**
(9 am unless changed in Account/Settings; kept on the phone):

1. **Coming up** — interval-aware advance notice ("Dentist due in 7 days").
2. **Due today** — "Dentist due today".
3. **7-days-overdue** — "Dentist overdue by 7 days".

Items 21+ days overdue graduate to **grouped** notifications ("3 things might need attention")
every 14 days, to avoid per-item noise. A hard cap of **2 notifications per calendar day** applies,
resolved by priority (grouped > 7-day overdue > due today > coming up). Wording deliberately avoids
appointment-style phrasing.

**Snooze ("Not yet", `domain/snooze/`)**: a snoozed item sends nothing up to and including the
day its snooze ends, and isn't counted in grouped notices on those days, so it takes no place in
the cap. On the end day it sends one normal reminder ("Gutters overdue by 17 days", same
priority as the 7-day one); after that the usual schedule (7-day overdue, grouped) carries on.
A snooze only quiets reminders: due date, history, status and sort order are untouched. It is
per person and kept on this phone only (`@since_snoozes_v1`, not synced, not in the backup
file), so it doesn't follow you to a second phone. It is recorded against the item's
last-done date and repeat: marking done (here or synced from another phone), changing the
repeat, or deleting ends it; ended snoozes are pruned at every reschedule.

Every change reschedules **everything** (there is no one-item reschedule), so the cap and the
grouped counts always hold across items. Notifications recompute on app start, after any change
and after every sync that changes items, and when the reminder time changes. Items the member
muted (`item_mutes`) are skipped (`scheduler.ts`).

> Expo Go (SDK 53+) prints a harmless console warning about push notifications. Local notifications
> still work; the warning disappears in a real (EAS) build.

---

## 8. Food tracking (removed)

Removed in October 2026 (`docs/Minded Plan.txt`, an earlier plan; "Minded" is an old working
name): the scan screen, camera, proxy calls and expiry mode are gone, and `since-proxy` now
serves UseBy only. Any `expiry_date` / `source` columns left in the database are ignored.

---

## 9. Voice & wording (keep new copy consistent)

Tone: **calm, plain, non-nagging, slightly warm.** Examples to match:

- Tagline: "Know how long it's been."
- Reassurance over alarm: "All good. Nothing needs attention." / "Something's coming up soon."
- Never "You forgot!" or "Overdue!!" — it's "It's been a while", "might need attention",
  "due in N days".
- No-repeat items are "Once off", not "incomplete".
- Buttons: "Add something", "Track this", "Save changes", "Done".

---

## 10. Architecture / file map

```
src/
  types/index.ts          SinceItem, CompletionEvent, RepeatUnit, StatusLabel, DEFAULT_CATEGORIES, nav params
  domain/items/
    types.ts              CreateItemInput, UpdateItemInput, DerivedItem
    service.ts            ⭐ ONLY entry point for item changes (create/update/markDone/delete,
                             entries, undo, backup restore). Keeps storage, reminders and the
                             sync queue in step. Screens MUST go through this.
    storage.ts            AsyncStorage load/save (via the migrations envelope)
    migrations.ts         versioned storage envelope + upgrades of old items
    cloudStorage.ts       Supabase reads/writes for items, entries and tombstones
    history.ts, undo.ts, display.ts, derive.ts   pure helpers
  domain/sync/
    engine.ts             syncNow(): household refresh, push queue, pull, merge, reschedule
    runSync.ts            ⭐ pure merge and push rules
    queue.ts, queueOps.ts sync queue (items, entries, deletes)
    cursor.ts, ownership.ts, owner.ts, lastSynced.ts, classify.ts, backupStatus.ts
  domain/household/       rules.ts (pure, mirrors the database rules), service.ts, cloud.ts, store.ts
  domain/auth/            emailed-code sign-in, email change, sign out, delete account
  domain/backup/          backup.ts (file format, restore that only adds), files.ts
  utils/
    dateUtils.ts          all date math (getNextDueDate, getDaysUntilDue, comingUpThreshold, …)
    statusUtils.ts        ⭐ computeItemStatus, sortItems, secondaryLine
    suggestions.ts        keyword → repeat-interval rules (14, English-only); the 8 starters come
                          from the same table
  domain/snooze/          rules.ts (pure: when offered, how long, when it ends), store.ts
  notifications/
    plan.ts               ⭐ what to schedule and when: lifecycle, grouped overdue, snoozes,
                             reminder time, per-day cap (pure, tested)
    engine.ts             cancels and schedules the plan
    scheduler.ts          public API, permissions, Android channel, skips muted items, prunes snoozes
    reminderTime.ts, reminderTimeStore.ts   the one reminder time (default 9 am)
  screens/                MainList, AddItem, EditItem, Detail, EditHistoryEntry, Account,
                          ChangeEmail, HouseholdSetup, auth/SignIn, auth/EnterCode
  components/             ItemCard, ItemForm, SystemStatus, StatusChip, CategoryTile,
                          DatePickerModal, Toast, HouseholdSection, useHousehold, LogoMark,
                          ReminderTimeSection, useSyncOnResume
  theme/tokens.ts         colours, type, spacing
  lib/supabase.ts         Supabase client (absent config → local-only)
App.tsx                   navigation, startup (reschedule reminders), auth events
app.json                  extra.{supabaseUrl, supabaseAnonKey, eas.projectId} (public: no secrets)
app.config.js             hook for injecting env secrets (none currently)
supabase/                 schema.sql, migrations/, tests/ (SQL access-rule tests)
.maestro/                 Android UI flows
```

**Invariant that matters:** screens never touch storage, Supabase or notifications directly — all
item changes go through `domain/items/service.ts`, the one place that keeps persistence,
scheduling and sync in step.

---

## 11. Known gaps / tech debt / not-built-yet

- **Old proxy secret is in this repo's public git history.** No longer used by this app, but
  rotate it on `since-proxy` (which UseBy now uses) if that hasn't been done.
- **Households** (`domain/household/`, migration 004). One household per account. Each item is
  "Just me" (default) or shared with the household; shared items carry `ownerId` (their owner's
  account, absent for this account's own) and `householdId`, and entries carry `createdBy` for
  "Done by". Membership changes go through database functions and need a connection; before each
  sync the engine re-reads the household and applies changes (leaving drops its items from the
  phone, joining pulls everything). The phone mirrors the server's rules (`household/rules.ts`) so
  it never queues a change the server would refuse. Reminders skip items a member muted.
- **How sync resolves conflicts** (`domain/sync/runSync.ts`). History entries sync one by one
  (`completion_events`, migration 003), so two phones marking the same item done both keep their
  entries, and a deleted entry is soft deleted and goes everywhere. Item fields: a change still to
  push from this phone wins, otherwise the cloud's copy; the last phone to push a field change wins
  it. Pulls fetch only rows changed since a per-account cursor, by the server's change time; phone
  clocks are never compared. Marking done doesn't push the item's fields, so the old
  `items.history` copy in the cloud (kept for older builds) only updates on field edits.
- **Deletes are final in the cloud** (tombstones). Undo-delete and backup restore bring an item
  back under a new id.
- **Sync runs** when the list comes into view, on Sync now, after household actions, and when
  the app returns from the background (at most once every 5 minutes after the last sync, quiet
  unless a real error, which shows one calm line per session; `domain/sync/resume.ts`).
- **Time zones:** entry dates are local calendar dates; members in different time zones can see
  an entry on different days. Not handled yet.
- **Supabase is configured** (`extra.supabaseUrl` / publishable `extra.supabaseAnonKey` in
  `app.json`; schema in `supabase/schema.sql`; migrations 003 and 004 applied 20 Oct 2026).
  Sign-in, sync, the backup file and households pass automated tests but haven't been
  exercised on a real phone or with two real accounts yet.
- **No iOS path exercised** (package/bundle id `com.since.app`; EAS project `since-fresh`, 3c35d81c).
- **Suggestions are English keyword-only**, 14 hardcoded rules (8 of them are also the
  empty-list starters). Gaps are neutral memory aids, not advice.
- **Snoozes and the reminder time live on one phone only.** Not synced and not in the backup
  file; a second phone has its own.
- **No dark mode.**
- **Not built yet, by design:** notifications about other members' actions, live updates,
  iOS / Sign in with Apple, more than one household per person, assigning items to a person,
  purging long-deleted rows.
- **Tests** (all in CI, see `TESTING.md`): `npx tsc --noEmit`; `npm test` (Node's test runner,
  `src/**/*.test.ts`: sync, entries, ownership, migrations, backup, household rules, history,
  display, undo, auth); `npm run test:ui` (Jest + jest-expo, `*.ui.test.tsx`); database tests
  (`supabase/tests/run.sh`, access rules as owner, member and outsider); Maestro flows in
  `.maestro/` on an emulator. Notification scheduling has unit tests (`plan.test.ts`);
  status/date logic still has none of its own.

---

## 12. How to run / deploy / update

- **App locally:** `npm install && npx expo start` → scan QR with Expo Go (same WiFi).
- **Release is automatic** (`RELEASING.md`): every merge to `main` with all checks green
  publishes to the preview app, then production. A JavaScript-only change goes out as an EAS
  Update (open the app twice to get it); a native change starts an EAS build and the install
  link is posted on the PR. Never publish by hand. Rollback: GitHub Actions → **Rollback**.

---

*Generated 2026-06-29. Updated 2026-08-22 for the since/since-fresh consolidation; 2026-10-02 to
reflect the secret move, tests and committed Supabase config; 2026-10-20 for emailed-code
sign-in, entry-by-entry sync, the backup file, households and automatic releases; 2026-10-21
for sync on return, snooze ("Not yet"), reminder time and empty-list starters.
Pull directly from code — no assumptions.*
