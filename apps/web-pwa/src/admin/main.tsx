/**
 * The console's own entry. This file is the root of a SEPARATE module graph and a separate build
 * (`vite.admin.config.ts` → `dist-admin`): nothing here is reachable from `src/main.tsx`, so not
 * one byte of the console can be emitted into the public site or the learner app. That invariant
 * is held by `separation.test.ts` rather than by anyone remembering it.
 *
 * The only thing it borrows from the app is `ui/tokens.css` — law v5's palette and the two faces.
 * One design system, one set of tokens, and no learner code in this bundle.
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './console.css';
import '../ui/tokens.css';
import { Console } from './Console';
import { Door } from './Door';
import type { Session } from './session';

function Root() {
  // Locked, from the first frame. The two proofs the guard needs live in memory only, so a fresh
  // document has neither and there is nothing to ask about — a reload IS a sign-out, deliberately.
  const [session, setSession] = useState<Session>({ state: 'locked', why: null });

  // Nothing of the console renders before the guard has named somebody. Not a skeleton, not a
  // greyed-out desk: a screen that draws its own shape before it knows who is looking has already
  // told a stranger what is behind it.
  if (session.state === 'checking') return <div className="ac-door" aria-busy="true" />;
  if (session.state === 'locked') return <Door why={session.why} onOpen={setSession} />;
  return (
    <Console
      admin={session.admin}
      weakFactor={session.weakFactor}
      onClosed={() => setSession({ state: 'locked', why: null })}
    />
  );
}

const mount = document.getElementById('root');
if (!mount) throw new Error('Missing #root');
createRoot(mount).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
