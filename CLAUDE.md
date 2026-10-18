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
