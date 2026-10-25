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
not being nagged. Some things do have a known date (car rego due 5 Dec, cancel a trial in 3
months): those are tracked **"Until it's due"** (section 4), with the same calm status and
reminders.

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
  (changes waiting to sync, and any parked by a size limit), `@since_sync_cursor_v1`, `@since_last_synced_v1`, `@since_owner_v1`
  (which account owns this phone's list), `@since_household_v1` (cached household),
  `@since_snoozes_v1` (snoozes, this phone only), `@since_reminder_time_v1` (reminder time,
  this phone only), `@since_list_view_v1` (list view, this phone only), `@since_reminder_prompt_v1` (whether the
  reminders explanation was answered and the "Reminders are off" notice hidden, this phone only).
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
  lastDoneDate: string;          // YYYY-MM-DD; history[0].date, kept for older builds (never null:
                                 // they drop an item without it). A date item not done yet: the day added
  history: CompletionEvent[];    // newest first; never empty, except a date item not done yet
  repeatValue: number | null;    // null = "Once off" (no reminders)
  repeatUnit: RepeatUnit | null;
  createdAt: string;
  updatedAt: string;
  ownerId?: string;              // set only on another member's shared item
  householdId?: string;          // set only on shared items
  lookedAfterBy?: string | null; // shared items: the member who looks after it; absent/null = Anyone
  dueDate?: string | null;       // "Until it's due" (YYYY-MM-DD); absent/null = "Since I last did it"
}

const DEFAULT_CATEGORIES =
  ['Household','Health','Auto','Family','Admin','Finance','Purchases','Other'];
```

Due date (`domain/items/due.ts`, `nextDueOf`): a **date item** (one with `dueDate`, "Until it's
due") is due on that date. Its history starts empty ("Last done: Not yet"). Done on a repeating
date item moves `dueDate` on by the repeat from the previous due date until it's after today, so
renewing early keeps the cycle; Done on a one-off date item clears `dueDate`, and it becomes a
once-off record. Undo puts the due date back. How an item is tracked can't be switched on Edit
(v1). Every other item: `nextDueDate = lastDoneDate + repeatValue · repeatUnit`. Items with no repeat are
"Once off" (formerly "Tracked only"). Storage v3 converted any leftover scanned-food items to
once off. Stored data changes are additive only (rollbacks run older code on newer data); every
new shape gets a case in `src/domain/items/migrations.test.ts`.

Cloud (`supabase/schema.sql`, migrations `002`–`007`): `items` (server-set `server_updated_at`,
`kind`, `household_id`, `looked_after_by`, `due_date` (text, 007; a value that isn't a real
YYYY-MM-DD date is refused with SN008, which sync parks)), `deleted_items` (tombstones), `completion_events` (one row per entry,
soft deleted), `households`, `household_members`, `household_invites`, `item_mutes`,
`household_join_failures` (failed invite codes, for the rate limit; no client access).
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
| `Coming up` | within advance-notice window (1–45 days by interval; date items at least 7) | amber |
| `About now` | −2 to 0 | amber |
| `It's been a while` | −3 to −14 | rust |
| `Getting overdue` | −15 to −45 | red |
| `Long overdue` | beyond −45 | dark red |
| `null` → shown as **"Once off"** | item has no repeat interval | muted |

- Secondary line per card: "Next in N days" / "Tomorrow" / "Due today" / "Overdue by N days".
- Each card also shows "Done today" / "Last done yesterday" / "Last done N days ago".
- Date items: the card shows "Due 5 Dec 2026" with "Due in 40 days" / "Due tomorrow" / "Due today"
  / "Overdue by N days". A date item's status counts against its due date; its bar runs from
  the day it was added (or last done) to the due date. A past due date is allowed (overdue).
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

- **Main** (`MainListScreen`) — one `FlatList`, sorted most-urgent-first (`sortItems`). A
  **View** row under the summary card switches between **Most urgent** (the default: one
  list), **By category** (the same order under category headings with a count; groups come
  in the order of their most urgent item; any category, including old "Food" items, gets its
  own heading, and an empty one shows as "No category") and, only in a household, **By
  person** (headings You — what you look after plus your Just me items — then each other
  member by name, then Anyone; most urgent first inside each; a saved By person shows as
  Most urgent outside a household). The choice is remembered on the phone
  (`domain/listView/`); a missing or unreadable value means Most urgent. Each
  `ItemCard` has a "Done" button (marks done today), Edit and Delete buttons, a progress bar
  through the interval, a Household tag on shared items, and a second small tag naming who
  looks after it ("You" or their name) when someone is chosen. In a household, an
  All / Just me / Household filter sits below the View row and combines with either view. Done and Delete each show a toast with **Undo**
  (`undoMarkDone` / `restoreDeletedItem` in `service.ts`; a restored item takes a new id
  because the old one is tombstoned in the cloud). A one-line `SystemStatus` summary sits under the header
  ("All good. Nothing needs attention." / "A few things might need attention." …). Header has
  the Account button and **＋** (add). Empty state shows "Add something" and a list of
  **starters** (smoke alarm battery, dentist, car service, car rego, air-con filter, gutters,
  pest inspection, eye test) from `suggestions.ts`: a tap opens Add filled in with the name,
  category and usual gap; nothing is saved until "Track this". A snoozed card adds
  "Snoozed until Tuesday" under its (unchanged) status. Opening the list (on focus) runs a
  sync, and so does coming back to the app from the background (`useSyncOnResume`).
- **Add** (`AddItemScreen`) and **Edit** (`EditItemScreen`) share `ItemForm`: name, **"How do you
  want to track it?"** ("Since I last did it" / "Until it's due"; Add only, preselected to Until
  for names with rego, registration, licence, license, passport, subscription, trial, renewal or
  insurance, `suggestions.ts`; Edit shows it as a label). The Until path asks "When is it due?"
  (date picker, or In 1 month / 3 months / 1 year) and "Repeat after that?" (No, or Yes with the
  stepper from 1 year); it has no last-done date. The car rego starter opens on Until, yearly.
  The rest: "Who is
  this for?" (Just me / Household; only in a household, only for the item's creator), "Repeats"
  (every N days/weeks/months/years) or "Once off", last-done date, category. On a shared item
  (any member, not only its creator): **"Who looks after this?"** (Anyone / You / each other
  member; default Anyone). Add shows a keyword
  **suggestion** (`suggestions.ts`). Save buttons: "Track this" / "Save changes". Edit also has
  Delete (no confirm; Undo toast), offered only where the household rules allow it.
- **Detail** (`DetailScreen`) — status card, "Mark done today", **"Not yet"** (only when due
  or overdue: snooze reminders for 3 days, 1 week or 1 month, with Undo), "Add a past entry",
  **"Who looks after this?"** (shared items: Anyone / You / each member, saved straight
  away by any member), "Remind me about this" switch (shared items), and the history; each entry shows "Done by {name}" on shared
  items and opens **EditEntry** (`EditHistoryEntryScreen`: change date or note, or delete).
- **Account** (titled "Settings" in a local-only build) — always: **Reminders** (the time of
  day reminders come: 7 am, 8 am, 9 am (default), 12 pm, 6 pm or 8 pm). Signed out: "Back up and sync" (→ `SignIn` → `EnterCode`). Signed in: email,
  last backup and Sync now, the Household section (create / join via `HouseholdSetup`, invite
  and share the code, members, make owner, remove, leave, delete), change email, sign out
  (warns if changes haven't synced), delete account. Always: the backup file section.
  Invites: the owner sees the code waiting to be used, with "Works until Fri 30 Oct";
  "Invite someone" reuses it (a new code only when none is waiting), "Make a new code" turns
  off every waiting code and makes one, "Turn off this code" just turns them off
  (`revoke_invite`). Removing someone says the code stopped working too (the server revokes it)
  and that a new one is needed to invite again.
  Change email: an address another account already holds goes the same way as a free one (to
  the code screen, "We're sending a code to … If nothing arrives in a few minutes, check the
  address or try another one."); no code arrives and any code reads as wrong. So the screen
  can't be used to find out which addresses have accounts (audit Q27).
- **RemindersPermission** — the one-screen explanation before the phone's notification prompt
  (below).
- **Crash recovery** (`components/ErrorBoundary.tsx`, around the whole app): a fatal JavaScript
  error while rendering shows "Something went wrong … Your list is saved on this phone." and
  **Restart Since** (`Updates.reloadAsync`; where that isn't possible it shows the app again).
  Local only: nothing is logged or sent.

---

## 7. Notifications (`src/notifications/plan.ts`, `engine.ts`, `scheduler.ts`)

Stated design philosophy (in the code): **"a quiet, reliable system that only speaks up when it
matters."** Local notifications only (no server push). What to schedule is worked out by
`plan.ts`, which is pure and unit tested (`plan.test.ts`); `engine.ts` only cancels and
schedules. Per repeating item, up to 3 lifecycle notifications fire at the **reminder time**
(9 am unless changed in Account/Settings; kept on the phone):

1. **Coming up** — interval-aware advance notice ("Dentist due in 7 days"): 1 day before for
   intervals up to 14 days, 3 up to 45, 7 up to 120, 14 up to 240, 30 up to 540, else 45. Date
   items use the same, but never under 7 days (a one-off's interval is from when it was added to
   its due date). Date items, one-off or repeating, get all three, against their due date.
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
last-done date, repeat and (date items) due date: marking done (here or synced from another
phone), changing the repeat or due date, or deleting ends it; ended snoozes are pruned at every reschedule.

**Who looks after a shared item** (`remindsMe` in `plan.ts`): nobody chosen (Anyone) means
every member's phone reminds, as before. Someone chosen means only that person's phone
reminds; on everyone else's it sends nothing and isn't counted in grouped notices or the cap.
Each phone learns of a change at its next sync, so until then it keeps its old reminders
(an extra reminder at worst; a handover to someone whose phone hasn't synced stays quiet on
their phone until they open Since). With no account known, everything is reminded.

Every change reschedules **everything** (there is no one-item reschedule), so the cap and the
grouped counts always hold across items. Notifications recompute on app start, after any change
and after every sync that changes items, and when the reminder time changes. Items the member
muted (`item_mutes`) are skipped (`scheduler.ts`).

**Permission** (`permission.ts` rules, `permissionFlow.ts`, Play hardening B). Never asked at
launch (start-up only sets up the Android channel). Asked once, when it matters: the first time
a repeating item is saved (Add, or Edit), if reminders aren't on, the **RemindersPermission**
screen explains ("So we can remind you when something comes round…") with **Turn on
reminders** and **Not now**; Back counts as Not now. Either answer is final: the explanation
never shows again. Turn on shows the system prompt, or, once Android won't show it any more
(`canAskAgain` false, Android 13+ after repeated refusals), opens the phone's settings. While
reminders are off and something repeats, the list shows one calm notice ("Reminders are off, so
Since can't nudge you. Turn them on in settings.", **Open settings** / **Hide**; hiding is for
good), and Account/Settings → Reminders says so too. Both look again when the screen comes into
view and when the app returns from the background; once reminders are on, every reminder is
rescheduled.

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
    due.ts                "Until it's due": next due date, coming-up notice, Done's new due date
    history.ts, undo.ts, display.ts, derive.ts   pure helpers
  domain/sync/
    engine.ts             syncNow(): household refresh, push queue, pull, merge, reschedule
    runSync.ts            ⭐ pure merge and push rules
    queue.ts, queueOps.ts sync queue (items, entries, deletes)
    cursor.ts, ownership.ts, owner.ts, lastSynced.ts, classify.ts, backupStatus.ts
    limits.ts             size limits and which refusals are permanent (parking)
  domain/household/       rules.ts (pure, mirrors the database rules), errors.ts, service.ts, cloud.ts, store.ts
  domain/auth/            emailed-code sign-in, email change, sign out, delete account
  domain/backup/          backup.ts (file format, restore that only adds), files.ts
  utils/
    dateUtils.ts          all date math (getNextDueDate, getDaysUntilDue, comingUpThreshold, …)
    statusUtils.ts        ⭐ computeItemStatus, sortItems, secondaryLine
    suggestions.ts        keyword → repeat-interval rules (14, English-only); the 8 starters come
                          from the same table
  domain/snooze/          rules.ts (pure: when offered, how long, when it ends), store.ts
  domain/listView/        rules.ts (pure: Most urgent / By category / By person, grouping), store.ts
  notifications/
    plan.ts               ⭐ what to schedule and when: lifecycle, grouped overdue, snoozes,
                             reminder time, per-day cap (pure, tested)
    engine.ts             cancels and schedules the plan
    scheduler.ts          public API, permissions, Android channel, skips muted items, prunes snoozes
    reminderTime.ts, reminderTimeStore.ts   the one reminder time (default 9 am)
    permission.ts         when to ask for permission (pure), permissionStore.ts, permissionFlow.ts
  screens/                MainList, AddItem, EditItem, Detail, EditHistoryEntry, Account,
                          ChangeEmail, HouseholdSetup, auth/SignIn, auth/EnterCode
  components/             ItemCard, ItemForm, LookAfterChoices, SystemStatus, StatusChip, CategoryTile,
                          DatePickerModal, Toast, HouseholdSection, useHousehold, LogoMark,
                          ReminderTimeSection, useSyncOnResume, RemindersOffNotice, ErrorBoundary
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
- **Who looks after a shared item** (migration 005, `items.looked_after_by`). Optional; null is
  Anyone. Any member can choose anyone in the household (coordination, not permission); anyone
  can still mark it done. The server ties it to `household_members` with a foreign key, so it
  refuses a non-member and clears the value by itself when that membership ends (leave, removal,
  account deletion, household deleted); a check refuses it on a personal item, and a trigger
  clears it when an item becomes Just me (including from older builds, which never send the
  column). The phone mirrors this (`household/rules.ts`) and, before each sync, resets any value
  naming someone no longer in the household, so a queued change is never refused forever. Sync
  sends the column only once an item carries it, and null for a Just me item. Conflicts: as for
  other item fields, the last phone to push the item wins it, so an edit to another field at the
  same moment can undo someone's choice. Backup file: exported as is; an item added from a backup
  is Just me with nobody chosen, an item already on the phone keeps its own.
- **Play hardening** (migration 006, applied to the live project 23 Oct 2026).
  Invites: removing a member revokes the household's active codes (the owner makes a new one);
  more than 5 wrong codes from one account in 15 minutes, or 100 from everyone in 10 minutes,
  and `join_household` refuses for a while. A wrong code is *returned* as the old error
  (P0002, HTTP 404) so the failure is kept; codes are uniform (no modulo or UUID-byte bias).
  Limits: name 500, category 100, note 5000 characters; `items.history` 20 000 entries and
  10 MiB; 20 000 entries per item; 5000 items per account; 50 members and 50 active codes per
  household. Every new error has a stable hint (`since_…`); limits on synced writes use
  SQLSTATEs `SN001`–`SN007`, errors from functions the app calls use P0001 so older builds
  show the message. Account deletion now also strips the account's id from
  `items.history` and purges its soft-deleted entries; `purge_soft_deleted_history(interval)`
  (90 days minimum, not callable by apps) is there for scheduling later. A household owner can
  no longer write a tombstone naming an item outside their household.
- **How the app handles those errors** (Play hardening B). Household and join errors are
  mapped by hint in `household/errors.ts` (wrong code, too many tries, joining paused,
  household full, 50 codes waiting); the join screen shows the message and keeps what was
  typed. A wrong-code body that ever arrived as data (HTTP 200) is still read as a wrong code.
  **Size-limit refusals are permanent, so sync parks them** (`sync/limits.ts`, `runSync.ts`):
  before pushing, the phone checks each change against the same limits, and anything the
  server still refuses with an SN code is retried one item at a time so it can't hold up the
  rest. A parked change stays in the queue and on the phone (`@since_sync_queue_v1` gains an
  optional `parked` map: item id → `{ code, updatedAt }`), isn't sent again, and the item
  screen says "Can't sync yet" with what to change ("This name is too long to sync. Shorten it
  and it will go through."); Account counts them. Any edit changes the item's `updatedAt`,
  which un-parks it, and the next sync tries again; deleting an item also frees items parked
  by the 5000-item limit. Older builds drop the field and go back to retrying (as before).
  An entry change only checks that entry's note, so an old long note already in the cloud
  never stops marking done. The name field stops at 500 characters and history notes at
  5000 (`maxLength`); a longer value saved before stays in full and can be shortened.
  Categories are chosen from chips, so there's no free-text field to limit.
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
- **"Until it's due"** (migration 007). Older builds (rollback, or another member's phone not yet
  updated) see a date item as a "since" item: last done the day it was added, due a repeat later
  (or once off), and their Done doesn't move the due date. Nothing is lost: they keep the item
  and never send `due_date`. "Add a past entry" on a date item is a record only; it doesn't move
  the due date (Done does).
- **Supabase is configured** (`extra.supabaseUrl` / publishable `extra.supabaseAnonKey` in
  `app.json`; schema in `supabase/schema.sql`; migrations 003 and 004 applied 20 Oct 2026,
  005 on 23 Oct 2026; 006 (Play hardening) is run by hand, in order, after 005).
  Sign-in, sync, the backup file and households pass automated tests but haven't been
  exercised on a real phone or with two real accounts yet.
- **No iOS path exercised** (package/bundle id `com.since.app`; EAS project `since-fresh`, 3c35d81c).
- **Suggestions are English keyword-only**, 14 hardcoded rules (8 of them are also the
  empty-list starters). Gaps are neutral memory aids, not advice.
- **Snoozes, the reminder time and the list view live on one phone only.** Not synced and not
  in the backup file; a second phone has its own.
- **Backup file copies don't linger** (`domain/backup/files.ts`): the file written for the share
  sheet is deleted 30 seconds after the sheet closes (worked or not; the delay lets the app it
  went to finish reading it), and any left from an app closed in between is cleared at start.
- **No dark mode.**
- **Not built yet, by design:** notifications about other members' actions, live updates,
  iOS / Sign in with Apple, more than one household per person, purging long-deleted rows,
  server push (so a phone hears about who looks after what only when it syncs).
- **Tests** (all in CI, see `TESTING.md`): `npx tsc --noEmit`; `npm test` (Node's test runner,
  `src/**/*.test.ts`: sync, entries, ownership, migrations, backup, household rules, history,
  display, undo, auth); `npm run test:ui` (Jest + jest-expo, `*.ui.test.tsx`); database tests
  (`supabase/tests/run.sh`: access rules as owner, member and outsider, older-build writes,
  limits; it also checks a fresh and an upgraded project end with identical tables, policies,
  functions and grants); Maestro flows in
  `.maestro/` on an emulator. Notification scheduling has unit tests (`plan.test.ts`);
  status/date logic still has none of its own.

---

## 12. How to run / deploy / update

- **App locally:** `npm install && npx expo start` → scan QR with Expo Go (same WiFi).
- **Release is automatic** (`RELEASING.md`): every merge to `main` with all checks green
  publishes to the preview app, then production. A JavaScript-only change goes out as an EAS
  Update (open the app twice to get it); a native change starts an EAS build and the install
  link is posted on the PR. Never publish by hand. Rollback: GitHub Actions → **Rollback**.
- **Google Play:** the `play` profile in `eas.json` builds an app bundle (AAB) for the store, on
  the production channel; the automatic release never runs it. Michael runs it by hand
  (`RELEASING.md`, "Google Play"). Play App Signing, with the EAS-managed key as the upload key.
  `app.json` blocks `SYSTEM_ALERT_WINDOW` and external storage (nothing uses them; the backup
  file uses the app's cache folder and the share sheet), and CI lists the built APK's
  permissions, failing if a blocked one comes back.

---

*Generated 2026-06-29. Updated 2026-08-22 for the since/since-fresh consolidation; 2026-10-02 to
reflect the secret move, tests and committed Supabase config; 2026-10-20 for emailed-code
sign-in, entry-by-entry sync, the backup file, households and automatic releases; 2026-10-21
for sync on return, snooze ("Not yet"), reminder time and empty-list starters; 2026-10-22
for the list view (Most urgent / By category), and for who looks after a shared item
(migration 005, reminders to that person only, By person); 2026-10-23 for Play hardening B
(006 errors in the app's words, parked size-limit refusals, invites, the notification
permission flow, crash recovery, backup file clean-up, change email).
Pull directly from code — no assumptions.*
