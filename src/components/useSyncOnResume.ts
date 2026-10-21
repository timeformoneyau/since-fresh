import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { syncOnResume } from '../domain/sync/engine';
import { resumeSyncMessage } from '../domain/sync/resume';

/** A failed sync on return is mentioned once per session, not every time. */
let failureShown = false;

/**
 * When the app comes back from the background: re-read the list (dates move
 * on overnight), then sync quietly. onSynced runs after a sync that worked;
 * onMessage gets the one calm line for a real failure.
 */
export function useSyncOnResume(
  onReturn: () => void,
  onSynced: () => void,
  onMessage: (message: string) => void,
): void {
  const handlers = useRef({ onReturn, onSynced, onMessage });
  handlers.current = { onReturn, onSynced, onMessage };

  useEffect(() => {
    let previous: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      const returned = (previous === 'background' || previous === 'inactive') && next === 'active';
      previous = next;
      if (!returned) return;
      handlers.current.onReturn();
      void syncOnResume().then((outcome) => {
        if (outcome === 'synced') handlers.current.onSynced();
        const message = resumeSyncMessage(outcome, failureShown);
        if (message) {
          failureShown = true;
          handlers.current.onMessage(message);
        }
      });
    });
    return () => sub.remove();
  }, []);
}
