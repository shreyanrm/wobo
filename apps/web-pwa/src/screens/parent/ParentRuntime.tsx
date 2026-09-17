'use client';

/**
 * THE PARENT ACCOUNT'S HOST: everything at /parent, in one small chunk of its own.
 *
 * It is not the learner runtime and it mounts none of it, on purpose. The learner runtime mints an
 * anonymous session the moment it mounts, starts the mind, the activity record, the voice and the
 * download queue, and covers every address with the learner's setup until setup is done. A parent
 * account can hold no learner state at all (migration 0019 refuses it in the database), so a parent
 * standing inside that runtime would be a stream of refused writes and a setup screen asking an
 * adult for their class. Here there is the one SDK (for the session and the gateway's identity),
 * the router, and the parent's own screens.
 *
 * WHAT IT DECIDES (stage.ts): nobody signed in sees the parent's door; a parent account sees its
 * home; an account that is not a parent's yet becomes one only if the parent's door was pressed on
 * this tab; and a student account is sent straight back to its own app, having been shown nothing.
 * The server is asked every time. The device's note of which kind this account is (device.ts) is a
 * cache the boot reads, never the decision.
 */

import type { Sdk } from '@wobo/sdk';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { Route } from '../../shell/router';
import { useRouter } from '../../shell/router';
import { appSdk } from '../../store/app-sdk';
import { SdkProvider } from '../../store/sdk';
import { Button, Wordmark } from '../../ui/primitives';
import { SiteLink } from '../site/nav';
import { ACTION_SCREENS } from './actions';
import { type MeAnswer, readParentMe, signUpParent, TROUBLE_LINE } from './api';
import { DOOR, HOME, TROUBLE } from './copy';
import { markKind, takeParentIntent } from './device';
import { DoorFrame, ParentDoor } from './ParentDoor';
import { ParentHome } from './ParentHome';
import { signOutParent } from './session';
import { stageFor } from './stage';
import { ensureParentStyles } from './styles';

ensureParentStyles();

/**
 * The press of the parent's door, taken ONCE for this page load. Held at module level because a
 * state initialiser runs twice under StrictMode, and the second run would find the key already
 * taken and read "not pressed".
 */
let intentThisLoad: boolean | null = null;
function intentForThisLoad(): boolean {
  if (intentThisLoad === null) intentThisLoad = takeParentIntent();
  return intentThisLoad;
}

/** A real session. The dev mock is signed in by configuration; an anonymous session is nobody. */
function signedInOf(sdk: Sdk): boolean {
  if (sdk.config.devAuth) return true;
  const account = sdk.account;
  return Boolean(account?.isAuthenticated() && !account.isAnonymous());
}

/** What Wobo calls a parent: the first word of the name their provider holds, and nothing more. */
function firstNameOf(sdk: Sdk): string | null {
  const name = sdk.account?.profile()?.name?.trim();
  const first = name?.split(/\s+/)[0] ?? '';
  return /^[\p{L}][\p{L}'’-]{0,39}$/u.test(first) ? first : null;
}

type ParentRoute = Extract<Route, { name: 'parent' }>;

export function ParentRuntime() {
  const sdk = appSdk();
  return (
    <SdkProvider value={sdk}>
      <ParentApp sdk={sdk} />
    </SdkProvider>
  );
}

function ParentApp({ sdk }: { sdk: Sdk }) {
  const router = useRouter();
  // The host opens here for a learner address too, on a device the server last said is a
  // parent's (App.tsx); that address is corrected below, and nothing about it is read.
  const route: ParentRoute = router.route.name === 'parent' ? router.route : { name: 'parent' };
  const offAddress = router.route.name !== 'parent';
  const signedIn = signedInOf(sdk);
  const [intent] = useState(intentForThisLoad);
  const [me, setMe] = useState<MeAnswer | null>(null);
  const [refusal, setRefusal] = useState<{ code: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [leaving, setLeaving] = useState(false);

  // Who is this? Asked on every arrival and on every "try again". `attempt` is the trigger.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-asks on purpose
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    setMe(null);
    void readParentMe().then((answer) => {
      if (!live) return;
      if (answer.kind === 'parent') markKind(undefined, true);
      else if (answer.kind === 'not-parent') markKind(undefined, false);
      setMe(answer);
    });
    return () => {
      live = false;
    };
  }, [signedIn, attempt]);

  const stage = refusal ? 'refused' : stageFor({ signedIn, me, intent });

  // The parent's door was pressed and this account is not a parent's yet: make it one. The address
  // that finds the family is the server's to read from the verified token.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the stage becomes joining
  useEffect(() => {
    if (stage !== 'joining') return;
    let live = true;
    void signUpParent(firstNameOf(sdk)).then(async (out) => {
      if (!live) return;
      if (!out.ok) {
        setRefusal({ code: out.code, message: out.message });
        return;
      }
      const again = await readParentMe();
      if (!live) return;
      if (again.kind === 'parent') markKind(undefined, true);
      // A sign-up that answered yes and a door that still says no is not a loop to go round again.
      setMe(again.kind === 'not-parent' ? { kind: 'trouble', message: TROUBLE_LINE } : again);
    });
    return () => {
      live = false;
    };
  }, [stage]);

  // A student account at /parent: back to its own app, shown nothing on the way. And giving lives
  // on the public page that already takes a gift, so its address under /parent goes there.
  useEffect(() => {
    if (stage === 'learner') router.replace({ name: 'home' });
    else if (offAddress) router.replace({ name: 'parent' });
    else if (stage === 'home' && route.action === 'donate') router.replace({ name: 'donate' });
  }, [stage, route.action, router, offAddress]);

  const signOut = () => {
    if (leaving) return;
    setLeaving(true);
    void signOutParent({ account: sdk.account });
  };
  const retry = () => {
    setRefusal(null);
    setAttempt((n) => n + 1);
  };

  switch (stage) {
    case 'door':
      return <ParentDoor />;
    case 'checking':
    case 'joining':
      // Nothing is said while the server answers: a wait is never captioned (never-narrate), and a
      // signed-in STUDENT passes through here on the way back to their own app, so this must carry
      // none of the parent's words, not even the tab name.
      return <div className="pa" aria-busy="true" />;
    case 'learner':
      return null;
    case 'unwired':
      return <DoorFrame title={TROUBLE.title} lede={TROUBLE.unwired} />;
    case 'closed':
    case 'trouble':
    case 'refused': {
      const message =
        stage === 'refused'
          ? (refusal?.message ?? TROUBLE_LINE)
          : me && 'message' in me
            ? me.message
            : TROUBLE_LINE;
      // Trying again helps a connection, and an address that has since been confirmed. It does
      // not help a closed dial or an account that is already a learner's, so it is not offered.
      const canRetry =
        stage === 'trouble' ||
        (stage === 'refused' &&
          refusal !== null &&
          !['doors_closed', 'already_a_learner'].includes(refusal.code));
      return (
        <DoorFrame title={stage === 'closed' ? DOOR.title : TROUBLE.title} lede={message}>
          {canRetry ? (
            <button type="button" className="au-btn au-go" onClick={retry}>
              {TROUBLE.tryAgain}
            </button>
          ) : null}
          <button
            type="button"
            className="au-btn au-quiet"
            onClick={signOut}
            disabled={leaving}
            aria-busy={leaving}
          >
            {TROUBLE.signOut}
          </button>
        </DoorFrame>
      );
    }
    case 'home':
      if (me?.kind !== 'parent') return null;
      if (route.action === 'donate') return null;
      if (route.action) {
        return <ActionPage action={route.action} signOut={signOut} leaving={leaving} />;
      }
      return <ParentHome me={me} signOut={signOut} leaving={leaving} />;
  }
}

/** One of the doors under /parent: its screen when it is built, and an honest page until then. */
function ActionPage({
  action,
  signOut,
  leaving,
}: {
  action: 'ask' | 'pay' | 'refer';
  signOut: () => void;
  leaving: boolean;
}) {
  const router = useRouter();
  const loader = ACTION_SCREENS[action];
  const Screen = useMemo(() => (loader ? lazy(loader) : null), [loader]);
  const back = () => router.navigate({ name: 'parent' });
  return (
    <div className="pa">
      <header className="pa-top">
        <div className="pa-wrap">
          <SiteLink to={{ name: 'parent' }} className="pa-mark" aria-label={TROUBLE.back}>
            <Wordmark />
          </SiteLink>
          <Button tone="quiet" size="sm" onClick={signOut} disabled={leaving} aria-busy={leaving}>
            {HOME.signOut}
          </Button>
        </div>
      </header>
      <main className="pa-body pa-wrap" id="pa-main">
        {Screen ? (
          <Suspense fallback={<div aria-busy="true" />}>
            <Screen />
          </Suspense>
        ) : (
          <section className="pa-gone" aria-labelledby="pa-gone-title">
            <h1 id="pa-gone-title">{TROUBLE.notBuiltTitle}</h1>
            <p>{TROUBLE.notBuiltBody}</p>
            <Button tone="pig" onClick={back}>
              {TROUBLE.back}
            </Button>
          </section>
        )}
      </main>
    </div>
  );
}
