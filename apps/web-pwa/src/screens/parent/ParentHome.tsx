'use client';

/**
 * THE PARENT'S HOME: their children, the switch between them, and four doors.
 *
 * The owner, 2026-09-05: a parent account is linked only, and it asks Wobo about a child's
 * academics, pays, refers, donates, and switches between its children to do the same four again.
 * That is the whole page. There is no progress figure, no streak and no activity here, because the
 * server sends none (`Child` carries a name and a key), and the week itself is behind the first door.
 *
 * THE SWITCH IS THE SERVER'S. The list is re-read from the server on every visit; a switch posts the
 * choice and takes back a fresh scope, and everything about the last child is keyed to the old scope
 * and dropped with it (the section below is keyed by it). A parent with one child is never shown a
 * switch: that child is chosen for them, silently, because there is nothing to choose.
 *
 * A CHILD WHO LINKED THEM SINCE is picked up by asking the server to claim the links on this address
 * again (`signUpParent`, which is idempotent for an existing parent). It happens once on its own when
 * the list is empty, and on "Look again" after that.
 */

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { type Route, routeToPath, useRouter } from '../../shell/router';
import { Button, Segmented, Wordmark } from '../../ui/primitives';
import { SiteLink } from '../site/nav';
import { type ActionDoor, doorsFor } from './actions';
import {
  type MeAnswer,
  type ParentAction,
  type ParentChild,
  readChildren,
  signUpParent,
  switchChild,
} from './api';
import { HOME } from './copy';
import { chooseFor, current, showsSwitcher } from './stage';
import { ensureParentStyles } from './styles';

ensureParentStyles();

type ParentMe = Extract<MeAnswer, { kind: 'parent' }>;

function nameOf(child: ParentChild): string {
  return child.name ?? HOME.unnamed;
}

/** A small drawn mark for each door. Drawn, so no request leaves for an icon. */
function Glyph({ action }: { action: ParentAction }) {
  const paths: Record<ParentAction, ReactNode> = {
    ask: <path d="M4 5.5h16v10H9l-5 4v-14z" />,
    pay: (
      <>
        <rect x="3" y="6" width="18" height="12" rx="3" />
        <path d="M3 10.5h18" />
      </>
    ),
    refer: (
      <>
        <circle cx="8" cy="9" r="3" />
        <circle cx="16.5" cy="9" r="3" />
        <path d="M2.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5M13.5 15c.9-.4 1.9-.5 3-.5 2.5 0 4.4 1.5 5 4.5" />
      </>
    ),
    donate: (
      <path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z" />
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[action]}
    </svg>
  );
}

function doorWords(action: ParentAction, name: string): { title: string; line: string | null } {
  switch (action) {
    case 'ask':
      return { title: HOME.ask(name), line: HOME.askLine };
    case 'pay':
      return { title: HOME.pay(name), line: null };
    case 'refer':
      return { title: HOME.refer, line: HOME.referLine };
    case 'donate':
      return { title: HOME.donate, line: null };
  }
}

function Door({ door, name, go }: { door: ActionDoor; name: string; go: (to: Route) => void }) {
  const { title, line } = doorWords(door.action, name);
  const cls = ['pa-door', door.action === 'ask' && 'pa-first', !line && 'pa-solo']
    .filter(Boolean)
    .join(' ');
  const body = (
    <>
      <Glyph action={door.action} />
      <span>
        <b>
          {title}
          {door.open ? null : <span className="pa-soon">{HOME.soon}</span>}
        </b>
        {line ? <span className="pa-line">{line}</span> : null}
      </span>
    </>
  );
  if (!door.open) {
    const shut = `pa-${door.action}-shut`;
    return (
      <li>
        <button
          type="button"
          className={cls}
          aria-disabled="true"
          aria-describedby={shut}
          data-action={door.action}
        >
          {body}
        </button>
        <span id={shut} hidden>
          {HOME.notYet}
        </span>
      </li>
    );
  }
  return (
    <li>
      <a
        className={cls}
        href={routeToPath(door.to)}
        data-action={door.action}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          go(door.to);
        }}
      >
        {body}
      </a>
    </li>
  );
}

export interface ParentHomeProps {
  me: ParentMe;
  signOut: () => void;
  leaving: boolean;
}

export function ParentHome({ me, signOut, leaving }: ParentHomeProps) {
  const router = useRouter();
  const [children, setChildren] = useState<ParentChild[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // The scope the server minted at the last switch. Everything about one child is keyed to it.
  const [scope, setScope] = useState<string>('first');
  const [note, setNote] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const claimedOnce = useRef(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const previous = document.title;
    document.title = `${HOME.tab} · Wobo`;
    return () => {
      document.title = previous;
    };
  }, []);

  /** Read the live list, and choose for a parent who has only one child. */
  const load = useCallback(async (): Promise<ParentChild[] | null> => {
    const read = await readChildren();
    if (!read.ok) {
      setNote(read.message);
      setChildren((was) => was ?? []);
      return null;
    }
    setChildren(read.children);
    const auto = chooseFor(read.children, read.selected);
    if (!auto) {
      setSelected(current(read.children, read.selected)?.learnerId ?? null);
      return read.children;
    }
    const picked = await switchChild(auto);
    if (picked.ok) {
      setSelected(picked.child.learnerId);
      setScope(picked.scope);
    } else {
      setSelected(null);
      setNote(picked.message);
    }
    return read.children;
  }, []);

  /** Ask the server to pick up any child who linked this address since, then read again. */
  const lookAgain = useCallback(
    async (quiet: boolean) => {
      setLooking(true);
      if (!quiet) setNote(null);
      const before = children?.length ?? 0;
      const claim = await signUpParent(me.displayName);
      if (!claim.ok && !quiet) setNote(claim.message);
      const after = await load();
      if (claim.ok && !quiet && after && after.length <= before) setNote(HOME.lookedNone);
      setLooking(false);
    },
    [children, load, me.displayName],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: the list is read once, on arrival
  useEffect(() => {
    void load().then((list) => {
      if (list && list.length === 0 && !claimedOnce.current) {
        claimedOnce.current = true;
        void lookAgain(true);
      }
    });
  }, []);

  const choose = async (learnerId: string) => {
    if (learnerId === selected || switching) return;
    setSwitching(learnerId);
    setNote(null);
    const out = await switchChild(learnerId);
    if (out.ok) {
      setSelected(out.child.learnerId);
      setScope(out.scope);
    } else {
      // An ended link, most likely: the server's own words, and the live list again.
      setNote(out.message);
      await load();
    }
    setSwitching(null);
  };

  const list = children ?? [];
  const child = current(list, selected);
  const doors = doorsFor(me.actions);

  return (
    <div className="pa">
      <a className="pa-skip" href="#pa-main">
        Skip to the page
      </a>
      <header className="pa-top">
        <div className="pa-wrap">
          <SiteLink to={{ name: 'parent' }} className="pa-mark" aria-label="Wobo, your children">
            <Wordmark />
          </SiteLink>
          <Button tone="quiet" size="sm" onClick={signOut} disabled={leaving} aria-busy={leaving}>
            {HOME.signOut}
          </Button>
        </div>
      </header>

      <main className="pa-body pa-wrap" id="pa-main" aria-busy={children === null || undefined}>
        <p className="pa-hello">{HOME.hello(me.displayName)}</p>

        {children === null ? (
          <div className="pa-wait" />
        ) : list.length === 0 ? (
          <section className="pa-none" aria-labelledby="pa-none-title">
            <h1 id="pa-none-title">{HOME.noneTitle}</h1>
            <p>{HOME.noneBody}</p>
            <Button
              tone="pig"
              onClick={() => void lookAgain(false)}
              disabled={looking}
              aria-busy={looking}
            >
              {HOME.lookAgain}
            </Button>
            {note ? (
              <p className="pa-note" role="status">
                {note}
              </p>
            ) : null}
          </section>
        ) : (
          <>
            {showsSwitcher(list) ? (
              <fieldset className="pa-switch">
                <legend>{HOME.switchLabel}</legend>
                <Segmented
                  options={list.map((c) => ({ id: c.learnerId, label: nameOf(c) }))}
                  value={selected ?? ''}
                  onChange={(id) => void choose(id)}
                />
              </fieldset>
            ) : null}
            <h1 className="pa-name" id="pa-child">
              {child ? nameOf(child) : HOME.choose}
            </h1>

            {child ? (
              <section key={scope} aria-labelledby="pa-child">
                <p className="pa-privacy">{HOME.privacy(nameOf(child))}</p>
                <ul className="pa-doors" aria-label={HOME.about(nameOf(child))}>
                  {doors.map((door) => (
                    <Door
                      key={door.action}
                      door={door}
                      name={nameOf(child)}
                      go={(to) => router.navigate(to)}
                    />
                  ))}
                </ul>
              </section>
            ) : null}

            {note ? (
              <p className="pa-note" role="status" style={{ marginTop: 'var(--s3)' }}>
                {note}
              </p>
            ) : null}

            <section className="pa-more" aria-labelledby="pa-more-title">
              <h2 id="pa-more-title">{HOME.anotherTitle}</h2>
              <p>{HOME.anotherBody}</p>
              <Button
                tone="quiet"
                onClick={() => void lookAgain(false)}
                disabled={looking}
                aria-busy={looking}
              >
                {HOME.lookAgain}
              </Button>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
