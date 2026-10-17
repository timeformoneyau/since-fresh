/**
 * One-shot notice for the Sign in screen after an involuntary sign-out
 * (expired or revoked session). In memory only: it explains a sign-out that
 * just happened, and has nothing to say after a restart.
 *
 * Supabase can drop the session itself (a failed refresh) before sync sets
 * the notice, so Sign in may already be showing; listeners cover that case.
 */

let pending: string | null = null;

type Listener = (message: string) => void;
const listeners = new Set<Listener>();

export function setSignInNotice(message: string): void {
  pending = message;
  listeners.forEach((l) => l(message));
}

/** Returns the notice once, then clears it. */
export function takeSignInNotice(): string | null {
  const message = pending;
  pending = null;
  return message;
}

export function onSignInNotice(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
