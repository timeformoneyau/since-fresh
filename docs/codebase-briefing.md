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
| **since-fresh** | this repo | The Expo/RN mobile app. Local-first storage; optional Supabase account + background sync. |

There is also an older `timeformoneyau/since` repo — the original version this project is a
rebuild of. Its auth, cloud sync, category grouping and completion-history work was consolidated
into `since-fresh` in August 2026; `since-fresh` is the surviving codebase. Note `since` still
holds an unmerged `sdk51-clean` branch (event logging, OCR, Hedera proofs) that was deliberately
deferred, not ported.

---

## 3. Tech stack

- **Expo SDK 54**, React Native 0.81, React 19, new architecture enabled.
- **React Navigation** (native-stack) — 4 screens.
- **AsyncStorage** for persistence (single key `@since_v1_items`, storage version 3) — the source
  of truth. Every write lands locally first and works offline.
- **Supabase** (`@supabase/supabase-js`) for optional accounts + background sync. Absent
  credentials means the app runs purely local-only, with no sign-in step.
- **expo-notifications** for **local** (not push) reminders.
- **date-fns** for all date math.
- **expo-constants** to read config from `extra` (Supabase keys from `app.json`).

---

## 4. Core data model (exact)

`src/types/index.ts` — the single domain entity is `SinceItem`:

```ts
type RepeatUnit = 'days' | 'weeks' | 'months' | 'years';

interface CompletionEvent { id: string; date: string; }  // YYYY-MM-DD

interface SinceItem {
  id: string;
  name: string;
  category: string;
  lastDoneDate: string;          // ISO YYYY-MM-DD
  history: CompletionEvent[];    // newest first
  repeatValue: number | null;    // null = "tracked only" (no reminders)
  repeatUnit: RepeatUnit | null;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_CATEGORIES =
  ['Household','Health','Auto','Family','Admin','Finance','Purchases','Other'];
```

Due date: `nextDueDate = lastDoneDate + repeatValue · repeatUnit`. Items with no repeat are
"tracked only". Storage v3 converted any leftover scanned-food items to tracked-only.

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
| `null` → shown as **"Tracked only"** | item has no repeat interval | muted |

- Secondary line per card: "Next in N days" / "Tomorrow" / "Due today" / "Overdue by N days".
- Each card also shows "Done today" / "Last done yesterday" / "Last done N days ago".
- List is sorted most-urgent-first (`sortItems`): overdue groups first (most overdue first),
  then upcoming (nearest first), non-repeating last.

---

## 6. Screens & navigation (`App.tsx`)

Two stacks. `AuthNavigator` (`SignIn`, `SignUp`, `ForgotPassword`) shows only when cloud sync is
configured *and* nobody is signed in. Otherwise `AppNavigator`: `Main`, `Add`, `Edit`, `Detail`,
`Account`, `ChangePassword`.

- **Main** (`MainListScreen`) — items grouped into per-category `SectionList` sections. Grouping
  nests urgency sorting: sections are ordered by their most-urgent member, items stay
  urgency-sorted within. Swipeable `ItemCard`s (swipe left → Edit / Delete;
  "Done" button marks done today). Done and Delete each show a toast with **Undo**
  (`undoMarkDone` / `restoreDeletedItem` in `service.ts`; a restored item takes a new id
  because the old one is tombstoned in the cloud). A one-line `SystemStatus` summary sits under the header
  ("All good. Nothing needs attention." / "A few things might need attention." …). Header has
  **＋** (add). Empty state shows the tagline, "Add something", and quick-start chips.
- **Add** (`AddItemScreen`) — name, last-done date, category, repeat-every (number + unit). Shows a
  keyword **suggestion banner** (from `suggestions.ts`).
- **Edit** (`EditItemScreen`) — same fields plus delete (no confirm; Undo toast).
- **History** (`DetailScreen`) — completion log, "Mark done today" (with Undo), an **Undo**
  link on the newest entry, and an **Edit** link (so Edit/Delete aren't swipe-only).

---

## 7. Notifications (`src/notifications/engine.ts`)

Stated design philosophy (in the code): **"a quiet, reliable system that only speaks up when it
matters."** Local notifications only (no server push). Per repeating item, up to 3 lifecycle
notifications fire at 9 AM:

1. **Coming up** — interval-aware advance notice ("Dentist due in 7 days").
2. **Due today** — "Dentist due today".
3. **7-days-overdue** — "Dentist overdue by 7 days".

Items 21+ days overdue graduate to **grouped** notifications ("3 things might need attention")
every 14 days, to avoid per-item noise. A hard cap of **2 notifications per calendar day** applies,
resolved by priority (grouped > 7-day overdue > due today > coming up). Wording deliberately avoids
appointment-style phrasing.

Notifications recompute on app start and after any add/edit/done/delete.

> Expo Go (SDK 53+) prints a harmless console warning about push notifications. Local notifications
> still work; the warning disappears in a real (EAS) build.

---

## 8. Food tracking (removed)

Removed in Phase 1 of the accounts plan (`docs/Minded Plan.txt`): the scan screen, camera, proxy
calls and expiry mode are gone, and `since-proxy` now serves UseBy only. The `expiry_date` and
`source` database columns remain until Phase 2's migration; the app ignores them.

---

## 9. Voice & wording (keep new copy consistent)

Tone: **calm, plain, non-nagging, slightly warm.** Examples to match:

- Tagline: "Know how long it's been."
- Reassurance over alarm: "All good. Nothing needs attention." / "Something's coming up soon."
- Never "You forgot!" or "Overdue!!" — it's "It's been a while", "might need attention",
  "due in N days".
- No-repeat items are "Tracked only", not "incomplete".
- Buttons: "Add something", "Track this", "Save changes", "Done".

---

## 10. Architecture / file map

```
src/
  types/index.ts          SinceItem, RepeatUnit, StatusLabel, DEFAULT_CATEGORIES, nav params
  domain/items/
    types.ts              CreateItemInput, UpdateItemInput, DerivedItem
    service.ts            ⭐ ONLY entry point for mutations (create/update/markDone/delete).
                             Coordinates storage + notifications. Screens MUST go through this.
    storage.ts            AsyncStorage load/save (via the migrations envelope)
    migrations.ts         versioned storage envelope + upgrades of old items (v3 strips food fields)
    derive.ts             attaches computed status to an item (DerivedItem)
  utils/
    dateUtils.ts          all date math (getNextDueDate, getDaysUntilDue, comingUpThreshold, …)
    statusUtils.ts        ⭐ computeItemStatus, sortItems, secondaryLine
    suggestions.ts        keyword → repeat-interval rules (~10 English-only rules)
  notifications/
    engine.ts             ⭐ full scheduling logic + per-day cap + grouped overdue
    scheduler.ts          public API, permissions, Android channel setup
  screens/                MainListScreen, AddItemScreen, EditItemScreen, DetailScreen
  components/             ItemCard, SystemStatus, CategoryPicker, DatePickerModal, colours.ts
App.tsx                   navigation + notification permission bootstrap
app.json                  extra.{supabaseUrl, supabaseAnonKey, eas.projectId}
app.config.js             hook for injecting env secrets (none currently)
```

**Invariant that matters:** screens never touch storage or notifications directly — all mutations
go through `domain/items/service.ts`, the one place that keeps persistence and scheduling in sync.

---

## 11. Known gaps / tech debt / not-built-yet

- **Old proxy secret is in this repo's public git history.** No longer used by this app, but
  rotate it on `since-proxy` (which UseBy now uses) if that hasn't been done.
- **Sync is item-level last-write-wins.** Two devices editing different fields of the same item
  inside one sync window will keep only the later edit. Fine for single-user; revisit if sharing
  is added.
- **Supabase is configured** (`extra.supabaseUrl` / publishable `extra.supabaseAnonKey` in
  `app.json`; schema in `supabase/schema.sql`). Nothing in the repo records the auth + sync path
  being exercised end-to-end on a device against that project.
- **No iOS path exercised** (package/bundle id `com.since.app`; EAS project `since-fresh`, 3c35d81c).
- **Suggestions are English keyword-only**, ~10 hardcoded rules.
- **No dark mode.**
- **Tests cover sync and storage migration only.** `npm test` (Node's built-in runner) runs the
  `runSync.ts` and `migrations.ts` tests. The notification engine and status/date logic remain untested.

---

## 12. How to run / deploy / update

- **App locally:** `npm install && npx expo start` → scan QR with Expo Go (same WiFi).
- **Installed build:** `eas build --platform android --profile preview` → download/install the APK.
- **Update workflow:**
  - App JS or native change → `eas build` + reinstall the APK (EAS Update OTA for JS-only is not
    set up yet).

---

*Generated 2026-06-29. Updated 2026-08-22 for the since/since-fresh consolidation; 2026-10-02 to
reflect the secret move, tests and committed Supabase config.
Pull directly from code — no assumptions.*
