/**
 * Mounted once inside the app, beside the mind's observer: the app's half of the activity record
 * (`store/activity.ts`). A session is the app on screen; a change of learner on the device (a
 * sibling taking over the tablet) closes one learner's session and opens the next one's. Nothing
 * is sent for a visitor who is not signed in. Renders nothing.
 */

import { useEffect } from 'react';
import { closeSession, mayRecord, openSession, setActivityGate, watchSessions } from './activity';
import { onScopeChange } from './scope';
import { useSdk } from './sdk';

export function ActivityObserver() {
  const sdk = useSdk();

  useEffect(() => {
    setActivityGate(() => Boolean(import.meta.env.VITE_GATEWAY_URL) && mayRecord(sdk.account));
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const stop = watchSessions(document, window);
    const unsubscribe = onScopeChange(() => {
      closeSession();
      if (document.visibilityState === 'visible') openSession();
    });
    return () => {
      unsubscribe();
      stop();
    };
  }, [sdk]);

  return null;
}
