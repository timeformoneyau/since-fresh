# Since: notes for Claude

This repo (`timeformoneyau/since-fresh`, branch `main`) is the real app: Expo SDK 54, React Native 0.81, React 19, Android-first. The older `timeformoneyau/since` repo is not the app; don't make changes there. Read `docs/codebase-briefing.md` for the product and architecture.

The owner is non-technical and installs builds on a real Android phone. That phone install is the **last** step; automated tests come first. See `TESTING.md`.

- All item mutations go through `src/domain/items/service.ts` (keeps storage, notifications and sync in step).
- Wording: calm, plain, never nagging (see section 9 of the briefing).
- `app.json` is public: never put secrets in it or anywhere in the repo.
- Tests:
  - `npx tsc --noEmit`
  - `npm test`: domain, Node's test runner, `src/**/*.test.ts`
  - `npm run test:ui`: components, Jest + jest-expo, `src/**/__tests__/*.ui.test.tsx`
  - Maestro flows in `.maestro/`: run by CI on an Android emulator against a local-only build (`SINCE_LOCAL_ONLY=1`)
- Selectors: give interactive elements a `testID` (kebab-case, e.g. `add-save-button`) and use it in tests and flows rather than visible text.

## Standing rules for every task

1. **Tests ship with the change.** Every feature or bug fix that changes behaviour or UI includes tests in the same PR:
   - component tests (`*.ui.test.tsx`) for screen logic and flows, and domain tests (`*.test.ts`) for service and logic changes;
   - a Maestro flow in `.maestro/` if it adds or changes a user-facing journey or layout.

   Pure refactors and copy tweaks don't need new tests, but must keep the existing ones passing.
2. **Bug fixes start with a failing test.** First add a test that fails because of the bug, and see it fail. Then fix it and see it pass.
3. **Run only what's relevant while working.** Before opening a PR, run `tsc` and the relevant tests only (e.g. `npx jest --config jest.ui.config.js -t "name"`, or `node --experimental-strip-types --test path/to/file.test.ts`), not the whole suite repeatedly. Run the full suite (`tsc`, `npm test`, `npm run test:ui`) once at the end.
4. **Keep token use low.**
   - Don't rewrite or restructure existing tests unless they're wrong.
   - Don't download or read Maestro screenshots or recordings when CI is green; open them only when a flow fails.
   - When reading test or CI output, look at summary and failure lines only, not full logs.
5. **Never mark work done or open a PR while tests fail.** If a test can't be written or run (e.g. it needs a real device or a real account), say so in the PR and explain why.
6. **Every PR description includes:**
   - **What changed**
   - **Tests covering it**: which test files and flows
   - **CI checks passed**: tsc, domain tests, component tests, Android flows (state any that didn't run or aren't green yet)
   - **Check on your phone**: a short manual checklist for what automation can't verify on a real Android phone, e.g. keyboard feel on the owner's device, edge-to-edge insets (status bar and nav bar), notification timing, sign-in and sync.

## Releases (see RELEASING.md)

Releases are fully automatic. Every merge to `main` with all checks green publishes with no human approval: `.github/workflows/release.yml` confirms the merged PR passed every check, runs the tests again, publishes to the **preview** channel and then, once that succeeds, to **production**. A JavaScript-only change goes out as an EAS Update. A native change (fingerprint runtime version) starts an EAS build, and the install link is posted on the PR. No labels are needed; the owner tests on the phone afterwards and uses Rollback if something is wrong.

7. **Merging.** Enable auto-merge on every PR (or merge it yourself once every check is green). Never merge with a check red or still running.
8. **Data safety.** There is no human gate, so tests are the safeguard. Migrations and storage changes must be backwards-safe and tested:
   - any change touching stored data, sync, sign-in/auth or migrations must include a test proving data saved by the current app still loads. The **Data safety** check enforces that a test changes alongside such code (`.github/scripts/data-safety.sh`), and Release won't publish without it;
   - old stored data must still load, nothing may be dropped, and older builds must keep working with what newer builds write;
   - so storage changes are **additive only**: new optional fields are fine, renaming or removing fields is not, within one release. A rollback runs older code against data written by newer code;
   - add `migrations.test.ts` cases for every new shape;
   - never publish an update that could lose or corrupt local data;
   - deletes are tombstoned in the cloud, so anything that "restores" an item must give it a new id.
9. **Never publish on red, and never skip checks.** Don't bypass required checks, and don't publish with `eas update` by hand outside the workflows.
10. **PR descriptions** keep the "Check on your phone" section, and say whether the change touches **stored data, sync, sign-in/auth or notifications** (yes/no, which). That's information for the owner, not a gate.
