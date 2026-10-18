# Releasing

**Code on `main` = what's on your phone.** Every change goes through a pull request (PR), gets tested automatically, merges, and is then sent to your phone automatically. You approve only the changes where automatic tests can't be trusted.

## If something is broken, do this

1. On GitHub, open the repo → **Actions** tab → **Rollback** (left-hand list).
2. Click **Run workflow**, choose **production** (your everyday app) or **preview**, and click the green **Run workflow** button.
3. When it shows a green tick (about 3 minutes), open the app, close it, and open it again. You're back on the previous version.

If the broken change came with a **new build** (the PR comment said "new build needed"), a rollback can't undo the native part. Instead:

1. Go to [expo.dev](https://expo.dev) → project **since-fresh** → **Builds**.
2. Open the previous build for that channel and tap **Install** on your phone.

Then tell Claude what broke. The fix goes through a normal PR.

Your data is safe in a rollback: items live on the phone and in your account, not in the app's code.

## The two apps on your phone

| App | Channel | What it gets | Use it for |
|---|---|---|---|
| **Since** | production | Changes once they're fully cleared | Everyday use, your real items |
| **Since (preview)** | preview | Every merged change, straight away | Trying GATED changes before they reach Since |

They're separate apps with separate data, so both can be installed at once.

⚠️ If you sign in to the preview app with your real account, it syncs with your real items. That's the realistic test for GATED sync changes, but it also means a bad preview could touch real data. Prefer a test account in the preview app.

## What happens per change

Every PR is labelled **automatic** or **gated**. Claude sets the label, and if unsure it uses gated.

**AUTOMATIC** (layout, wording, styling, logic that doesn't touch the areas below):
1. All checks pass → the PR merges by itself.
2. Both apps update by themselves. **You do nothing.**

**GATED** (anything touching sign-in/accounts, sync, stored data or migrations, notifications, or the Supabase schema):
1. All checks pass → the PR waits for you. Read the PR's "Check on your phone" list, then add the label **approved**: on the PR page, right-hand side, **Labels** → tick **approved**. It then merges by itself.
2. The **Since (preview)** app updates. Try the change there.
3. When happy: open the PR's **Release** run (the PR gets a comment linking it, or go to Actions → Release) → **Review deployments** → tick **production-gated** → **Approve and deploy**. Since updates.

How updates arrive:
- **JavaScript-only change** (most changes): sent over the air. Open the app, close it, and open it again to get it. Nothing to install.
- **Native change** (app.json native settings, permissions, new native packages): an over-the-air update can't deliver these. The release starts a new build instead and comments on the PR with an install link. Open it on your phone when the build says *Finished* and tap **Install**. Your data is kept: it installs over the old version.

The pipeline tells the two apart automatically using a *fingerprint* of the app's native parts. An update is only sent to builds with the same fingerprint, so it can never land on an app it doesn't fit.

## One-time setup (you)

Do these once, in this order. Each step is clicks only. **Never paste a token into a chat or into a file in the repo.**

### 1. Expo token (so GitHub can publish for you)
1. Sign in at [expo.dev](https://expo.dev) with the account that owns the **since-fresh** project.
2. Click your avatar (top right) → **Account settings** → **Access tokens** → **Create token**. Name it `github-actions` → **Create**. Copy the token: it's shown only once.
3. On GitHub, open **timeformoneyau/since-fresh** → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
4. Name: `EXPO_TOKEN`. Secret: paste the token. Click **Add secret**.

### 2. The production gate (so GATED changes wait for you)
1. GitHub repo → **Settings** → **Environments** → **New environment**. Name: `production-gated` → **Configure environment**.
2. Tick **Required reviewers**, add **timeformoneyau**, and click **Save protection rules**.

   Leave **Prevent self-review** unticked: you're both the author and the reviewer.

If this step is skipped, the release refuses to publish GATED changes to production. It never skips the gate silently.

### 3. Protect `main` and allow auto-merge
1. **Settings** → **General** → scroll to **Pull Requests**:
   - tick **Allow auto-merge**
   - tick **Automatically delete head branches**
2. **Settings** → **Rules** → **Rulesets** → **New ruleset** → **New branch ruleset**.
   - **Ruleset name:** `main`. **Enforcement status:** **Active**.
   - **Target branches** → **Add target** → **Include default branch**.
   - Tick **Restrict deletions** and **Block force pushes**.
   - Tick **Require a pull request before merging**. Set "Required approvals" to **0**: your approval is the `approved` label, checked by the Release gate.
   - Tick **Require status checks to pass**, then:
     - tick **Require branches to be up to date before merging**
     - click **Add checks** and add each of: `Type check and tests`, `Android flows (Maestro)`, `Release gate`. If a check isn't listed yet, it appears after it has run once on any PR.
   - Click **Create**.

With this, nothing reaches `main` without passing every check, and direct pushes to `main` are blocked.

### 4. Install the two apps once
The first release after this setup starts both builds by itself (the fingerprint is new). When the PR comments arrive with the two install links:
1. Install **Since (preview)** from the preview link.
2. Install **Since** from the production link. It installs over your current Since and keeps your items.

From then on, JavaScript-only changes arrive without reinstalling.

Your current Since app (built before this setup) has no update support, so it can't receive over-the-air updates. That's why one fresh install is needed.

## What can still go wrong

- **A bad change that passed every test.** Tests can't check everything: your keyboard, your phone's insets, real sync, notification timing. That's what the PR's "Check on your phone" list and the GATED preview step are for. If it slips through, use **Rollback** above.
- **Expo or GitHub outages, or the token expiring.** The Release run goes red and the PR comment says publishing failed. Nothing on your phone changes. Re-run it later; if the token expired, create a new one (step 1).
- **Free-tier build queues.** A native change can take a while to build. The update path isn't affected.
- **A fingerprint mismatch** between GitHub and Expo's build servers would only cause an extra build to be started, never an update on the wrong app.
