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

A newer capability extends this to **food**: point the camera at a grocery item, an LLM reads the
expiry / use-by date off the packaging, and that date drives the reminder directly.

---

## 2. The two repos

| Repo | Path | Role |
|---|---|---|
| **since-fresh** | this repo | The Expo/RN mobile app. Local-first storage; optional Supabase account + background sync. |
| **since-proxy** | `../since-proxy` (GitHub `timeformoneyau/since-proxy`) | Minimal Next.js/Vercel backend with one route, `POST /api/parse-expiry`. Exists *only* so the Anthropic API key never ships in the mobile bundle. No database, no file storage. |

There is also an older `timeformoneyau/since` repo — the original version this project is a
rebuild of. Its auth, cloud sync, category grouping and completion-history work was consolidated
into `since-fresh` in August 2026; `since-fresh` is the surviving codebase. Note `since` still
holds an unmerged `sdk51-clean` branch (event logging, OCR, Hedera proofs) that was deliberately
deferred, not ported.

---

## 3. Tech stack

- **Expo SDK 54**, React Native 0.81, React 19, new architecture enabled.
- **React Navigation** (native-stack) — 4 screens.
- **AsyncStorage** for persistence (single key `@since_v1_items`, storage version 2) — the source
  of truth. Every write lands locally first and works offline.
- **Supabase** (`@supabase/supabase-js`) for optional accounts + background sync. Absent
  credentials means the app runs purely local-only, with no sign-in step.
- **expo-notifications** for **local** (not push) reminders.
- **date-fns** for all date math.
- **expo-camera** + **expo-image-manipulator** for the food-scan capture.
- **expo-constants** to read config from `extra`: the proxy URL and Supabase keys from `app.json`,
  the proxy shared secret injected by `app.config.js` from the `EXPIRY_API_SECRET` env var.
- Backend (`since-proxy`): **Next.js 16**, **@anthropic-ai/sdk**, **sharp** (image resize), model
  `claude-haiku-4-5` with JSON-schema structured output.

---

## 4. Core data model (exact)

`src/types/index.ts` — the single domain entity is `SinceItem`:

```ts
type RepeatUnit = 'days' | 'weeks' | 'months' | 'years';
type ItemSource = 'manual' | 'photo';

interface CompletionEvent { id: string; date: string; }  // YYYY-MM-DD

interface SinceItem {
  id: string;
  name: string;
  category: string;
  lastDoneDate: string;          // ISO YYYY-MM-DD
  history: CompletionEvent[];    // newest first; repeat-mode items only
  repeatValue: number | null;    // null = "tracked only" (no reminders)
  repeatUnit: RepeatUnit | null;
  expiryDate: string | null;     // ISO; when set, IS the due date (overrides repeat)
  source: ItemSource;            // 'photo' for scanned food, else 'manual'
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_CATEGORIES =
  ['Household','Health','Auto','Family','Admin','Purchases','Food','Other'];
```

Two due-date modes coexist:

- **Repeat mode** (default): `nextDueDate = lastDoneDate + repeatValue · repeatUnit`.
- **Expiry mode** (scanned food): `expiryDate` *is* the due date; repeat fields are ignored.
  When a photo-sourced item is marked "done," `expiryDate`/`source` reset to manual — the next
  instance of that food needs a fresh scan (or a manually-set interval).

---

## 5. The status system (the heart of the product)

`src/utils/statusUtils.ts` → `computeItemStatus()` converts days-until-due into one of six labels.
This wording is central to the product's voice.

| Label | When (days until due) | Card accent |
|---|---|---|
| `All good` | beyond the "coming up" window | neutral grey |
| `Coming up` | within advance-notice window (1–45 days by interval; **3 days fixed for food/expiry**) | amber |
| `About now` | −2 to 0 | amber |
| `It's been a while` | −3 to −14 | rust |
| `Getting overdue` | −15 to −45 | red |
| `Long overdue` | beyond −45 | dark red |
| `null` → shown as **"Tracked only"** | item has no repeat and no expiry | muted |

- Secondary line per card: "Next in N days" / "Tomorrow" / "Due today" / "Overdue by N days".
- Each card also shows "Done today" / "Last done yesterday" / "Last done N days ago".
- List is sorted most-urgent-first (`sortItems`): overdue groups first (most overdue first),
  then upcoming (nearest first), non-repeating last.

---

## 6. Screens & navigation (`App.tsx`)

Two stacks. `AuthNavigator` (`SignIn`, `SignUp`, `ForgotPassword`) shows only when cloud sync is
configured *and* nobody is signed in. Otherwise `AppNavigator`: `Main`, `Add`, `Edit`, `Detail`,
`ScanFood`, `Account`, `ChangePassword`.

- **Main** (`MainListScreen`) — items grouped into per-category `SectionList` sections. Grouping
  nests urgency sorting: sections are ordered by their most-urgent member, items stay
  urgency-sorted within. Swipeable `ItemCard`s (swipe left → Edit / Delete;
  "Done" button marks done today). A one-line `SystemStatus` summary sits under the header
  ("All good. Nothing needs attention." / "A few things might need attention." …). Header has
  **＋** (add) and **📷** (scan food). Empty state shows the tagline, "Add something" /
  "📷 Scan food", and quick-start chips.
- **Add** (`AddItemScreen`) — name, last-done date, category, repeat-every (number + unit). Shows a
  keyword **suggestion banner** (from `suggestions.ts`). Accepts an optional `prefill` route param
  from the scan flow → renders a "Use by" date field + an explanatory banner instead of the repeat
  controls.
- **Edit** (`EditItemScreen`) — same fields plus delete (confirm dialog).
- **ScanFood** (`ScanFoodScreen`) — full-screen camera; capture → resize → POST to proxy →
  navigate to `Add` pre-filled (`category: 'Food'`, `source: 'photo'`, `expiryDate`, and a
  `lowConfidence` flag that drives an amber "low confidence — verify" banner).

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

Notifications recompute on app start and after any add/edit/done/delete. Expiry-mode items "just
work" here because the engine schedules off whatever `nextDueDate` derivation produces.

> Expo Go (SDK 53+) prints a harmless console warning about push notifications. Local notifications
> still work; the warning disappears in a real (EAS) build.

---

## 8. The food-expiry feature (newest)

Flow: camera → `expo-image-manipulator` resize to 1200px / 0.7 JPEG → base64 →
`parseExpiryPhoto()` in `src/services/expiryApi.ts` → `POST /api/parse-expiry` with
`Authorization: Bearer <MOBILE_APP_SECRET>` → proxy calls Claude vision with a JSON schema
returning `{ itemName, expiryDate, dateType }`, each with a confidence → app pre-fills the Add form.

The proxy prompt (`since-proxy/lib/expiry.ts`) is tuned for food labels: **day-first** date
interpretation (DD/MM), handles stamped/embossed dates, prefers "USE BY" over "BEST BEFORE", and
returns `null` + low confidence rather than guessing. A regression guard lives in the proxy:
`npm run test:labels` (renders synthetic labels, asserts the extracted date + date type).

Config: `expiryApiUrl` lives in `app.json` → `extra`; `expiryApiSecret` is injected by
`app.config.js` from the `EXPIRY_API_SECRET` env var (`.env` locally, EAS env for builds). The actual Anthropic key
is only ever on the server (Vercel env var).

---

## 9. Voice & wording (keep new copy consistent)

Tone: **calm, plain, non-nagging, slightly warm.** Examples to match:

- Tagline: "Know how long it's been."
- Reassurance over alarm: "All good. Nothing needs attention." / "Something's coming up soon."
- Never "You forgot!" or "Overdue!!" — it's "It's been a while", "might need attention",
  "due in N days".
- No-repeat items are "Tracked only", not "incomplete".
- Buttons: "Add something", "Track this", "Save changes", "Done", "📷 Scan food".
- Scan banners: "Reminder based on the date read from the photo — edit if wrong." /
  low-confidence: "Read from the photo — low confidence, please check the name and date."

---

## 10. Architecture / file map

```
src/
  types/index.ts          SinceItem, RepeatUnit, ItemSource, StatusLabel, DEFAULT_CATEGORIES, nav params
  domain/items/
    types.ts              CreateItemInput, UpdateItemInput, DerivedItem
    service.ts            ⭐ ONLY entry point for mutations (create/update/markDone/delete).
                             Coordinates storage + notifications. Screens MUST go through this.
    storage.ts            AsyncStorage load/save (via the migrations envelope)
    migrations.ts         versioned storage envelope + backfill of expiryDate/source on old items
    derive.ts             attaches computed status to an item (DerivedItem)
  utils/
    dateUtils.ts          all date math (getNextDueDate, getDaysUntilDue, comingUpThreshold, …)
    statusUtils.ts        ⭐ computeItemStatus, sortItems, secondaryLine
    suggestions.ts        keyword → repeat-interval rules (~10 English-only rules)
  notifications/
    engine.ts             ⭐ full scheduling logic + per-day cap + grouped overdue
    scheduler.ts          public API, permissions, Android channel setup
  screens/                MainListScreen, AddItemScreen, EditItemScreen, ScanFoodScreen
  components/             ItemCard, SystemStatus, CategoryPicker, DatePickerModal, colours.ts
  services/expiryApi.ts   networking to the proxy (parseExpiryPhoto)
App.tsx                   navigation + notification permission bootstrap
app.json                  expo-camera plugin, extra.{expiryApiUrl, supabaseUrl, supabaseAnonKey, eas.projectId}
app.config.js             injects extra.expiryApiSecret from EXPIRY_API_SECRET (never committed)
```

**Invariant that matters:** screens never touch storage or notifications directly — all mutations
go through `domain/items/service.ts`, the one place that keeps persistence and scheduling in sync.

---

## 11. Known gaps / tech debt / not-built-yet

- **Proxy shared secret is still in public git history.** It was moved out of `app.json` on
  2026-08-22, but the old value was committed to this public repo and must be rotated (Vercel
  `MOBILE_APP_SECRET` + `EXPIRY_API_SECRET` for builds). It only gates abuse of the Anthropic
  budget, not user data.
- **Sync is item-level last-write-wins.** Two devices editing different fields of the same item
  inside one sync window will keep only the later edit. Fine for single-user; revisit if sharing
  is added.
- **Supabase is configured** (`extra.supabaseUrl` / publishable `extra.supabaseAnonKey` in
  `app.json`; schema in `supabase/schema.sql`). Nothing in the repo records the auth + sync path
  being exercised end-to-end on a device against that project.
- **No iOS path exercised** (package/bundle id `com.since.app`; EAS project `since-fresh`, 3c35d81c).
- **Real-world OCR accuracy unverified** on stamped-on-plastic dates — only clean printed labels
  tested so far.
- **Suggestions are English keyword-only**, ~10 hardcoded rules.
- **No dark mode.**
- **Tests cover sync only.** `npm test` (Node's built-in runner) runs 11 tests on
  `src/domain/sync/runSync.ts`. The notification engine and status/date logic remain untested.

---

## 12. How to run / deploy / update

- **App locally:** `npm install && npx expo start` → scan QR with Expo Go (same WiFi). The camera
  needs a real device, not a simulator.
- **Installed build:** `eas build --platform android --profile preview` → download/install the APK.
- **Backend:** push to `since-proxy` → Vercel auto-redeploys; installed apps pick it up instantly
  (no rebuild). Vercel env vars: `ANTHROPIC_API_KEY`, `MOBILE_APP_SECRET`.
- **Update workflow:**
  - Prompt / schema / model change (extraction quality) → edit `since-proxy`, `git push`, done.
  - App JS or native change → `eas build` + reinstall the APK (EAS Update OTA for JS-only is not
    set up yet).

---

*Generated 2026-06-29. Updated 2026-08-22 for the since/since-fresh consolidation; 2026-10-02 to
reflect the secret move, tests and committed Supabase config.
Pull directly from code — no assumptions.*
