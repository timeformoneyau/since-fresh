# Testing

Every pull request (PR) is tested automatically on GitHub before anything reaches your phone. Installing on the phone is the last step: a check of what automation can't judge.

## What runs on every PR

The PR page shows a check called **CI** with two parts:

1. **Type check and tests** (about 3 minutes)
   - **Type check (tsc):** catches code mistakes, like a typo in a name or a missing value.
   - **Domain tests (`npm test`, Node's own test runner):** the app's rules, with no screens. For example: sync, storage upgrades, account and recovery rules.
   - **Component tests (`npm run test:ui`):** the real screens in a simulated phone. They tap and type through adding, editing, marking done and deleting, and check what appears.
2. **Android flows (Maestro)** (about 15–25 minutes)
   - Builds a test version of the app and runs it on an Android emulator (a virtual phone).
   - A robot taps through the main journeys, one file each in `.maestro/`.
   - It saves screenshots you can download.

Part 2 only starts if part 1 passes.

3. **Data safety** (a few seconds): if the PR changes stored data, sync or sign-in code, it must also change a test showing your existing data still loads. Otherwise it fails.
4. **Release gate** (a few seconds): information only, always passes. It notes whether the PR touches stored data, sync, sign-in or notifications. No labels are needed. See `RELEASING.md`.

After a merge, the **Release** workflow runs the type check and tests again before publishing anything.

## What is *not* tested automatically

- **Sign-in, sync and anything that needs your Supabase account.** Test builds run *local-only*, the way the app works with no cloud set up: no sign-in screen, nothing leaves the phone. That keeps tests fast and means no real accounts or data are touched. It also means the **Account** button doesn't appear in the flows. Sign-in, sync, change email/password and account deletion still need a check on your phone.
- **How things look and feel on your own phone:** your keyboard, exact spacing around the status bar and navigation bar, fonts. The emulator is a standard Pixel-style virtual phone.
- **Exact positions on screen.** Flows show that buttons *work*, for example that a tap on ＋ opens Add, but can't measure where they sit. The screenshots let you look.
- **Notification timing.** Tests check *what* gets scheduled, not that it arrives at 9am.
- **iOS.**

## How to read a failed check

1. Open the PR on GitHub and scroll to the checks near the bottom. A red ✗ marks the part that failed.
2. Click **Details** next to it. The failing step has a red ✗.
   - **Type check:** the first error line names the file and line, e.g. `src/screens/AddItemScreen.tsx(42,5): error ...`.
   - **Domain tests:** look for `not ok` lines; the test's name says what broke.
   - **Component tests:** look for lines starting with `✕` (which test) and `●` (what was expected versus what happened).
   - **Android flows:** the log names the flow, e.g. `05-delete-item`, and the step that failed.
3. For Android flow failures, scroll to the bottom of the run's summary page. Under **Artifacts**, download **maestro-results**: screenshots of each flow's key moment, plus the screen at the moment of failure (in `debug/`).

If only the Android flows failed, and the message is about the emulator or a timeout before any of our own steps ran, it may be a GitHub hiccup. Use **Re-run jobs** once. If it fails again, it's real.

## Running tests yourself (optional)

```
npm ci
npx tsc --noEmit
npm test            # domain tests
npm run test:ui     # component tests
```

The Maestro flows need an Android emulator and a local-only test build (`SINCE_LOCAL_ONLY=1`). CI does this for you, so you don't need to.

## Where things live

- `src/**/*.test.ts`: domain tests (Node test runner)
- `src/**/__tests__/*.ui.test.tsx`: component tests (Jest + jest-expo + React Native Testing Library; `jest.ui.config.js`, mocks in `jest.ui.setup.js`)
- `.maestro/`: Android flows, one file per journey (`subflows/` holds shared steps)
- `.github/workflows/ci.yml`: the CI check
- `app.config.js`: the `SINCE_LOCAL_ONLY` switch used only by CI test builds
