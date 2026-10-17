/**
 * Device ownership — pure logic, no platform dependencies.
 *
 * The phone records which account its local list belongs to. That record is
 * what stops one account's items leaking into another (F3): without it, the
 * next sign-in on a shared phone would upload whatever was left on it.
 *
 * Rules, applied on sign-in and at app start when a session already exists:
 *   - No owner stored → 'adopt'. The list predates accounts on this phone (or
 *     this install was signed in before owners were recorded); it becomes the
 *     signed-in account's and is uploaded.
 *   - Owner is the signed-in account → 'resume'. Nothing to do but sync.
 *   - Owner is a different account → 'replace'. The local list belongs to
 *     someone else and is never uploaded. It is cleared, and the signed-in
 *     account's list is pulled from the cloud.
 *
 * I/O is injected through OwnershipPorts, as in runSync.ts, so the rules can
 * be tested directly. Real wiring lives in engine.ts.
 */

export type SignInDecision = 'adopt' | 'resume' | 'replace';

export function decideOnSignIn(
  storedOwner: string | null,
  signedInUserId: string,
): SignInDecision {
  if (storedOwner === null) return 'adopt';
  if (storedOwner === signedInUserId) return 'resume';
  return 'replace';
}

export interface OwnershipPorts {
  loadOwner(): Promise<string | null>;
  saveOwner(userId: string): Promise<void>;
  loadItemIds(): Promise<string[]>;
  enqueueUpsert(id: string): Promise<void>;
  /** Clear local items, the sync queue and all scheduled reminders. */
  clearLocalData(): Promise<void>;
}

/**
 * Apply the sign-in rule to local state. Does not sync; the caller syncs
 * afterwards. runSync refuses to run while the stored owner differs from the
 * signed-in account, so nothing uploads until this has finished.
 *
 * Step order is chosen so an interruption at any point is safe:
 *   - adopt: enqueue first, then record the owner. Interrupted before the
 *     owner is saved, the next start simply adopts again.
 *   - replace: clear first, then record the owner. Interrupted before the
 *     owner is saved, the old owner is still recorded, so the next start
 *     replaces again rather than adopting the previous account's items.
 */
export async function applySignIn(
  ports: OwnershipPorts,
  signedInUserId: string,
): Promise<SignInDecision> {
  const decision = decideOnSignIn(await ports.loadOwner(), signedInUserId);

  switch (decision) {
    case 'adopt':
      for (const id of await ports.loadItemIds()) {
        await ports.enqueueUpsert(id);
      }
      await ports.saveOwner(signedInUserId);
      break;
    case 'replace':
      await ports.clearLocalData();
      await ports.saveOwner(signedInUserId);
      break;
    case 'resume':
      break;
  }

  return decision;
}
