/**
 * WHICH SCREEN A PERSON AT /parent IS SHOWN, and the switch's three small decisions.
 *
 * The owner's two rulings (2026-09-05) are the whole of this file:
 *  · a parent account is linked only, does four things, and switches between its children;
 *  · a student account is sign-up, log-in and log-out only, and never sees any of this.
 * So a signed-in student who lands on /parent is sent back to their own app, and the parent's
 * door never turns an account into a parent's unless the person pressed the parent's door.
 */

import { describe, expect, it } from 'bun:test';
import type { ParentChild } from './api';
import { chooseFor, current, showsSwitcher, stageFor } from './stage';

const parent = {
  kind: 'parent' as const,
  displayName: null,
  children: 1,
  actions: ['ask' as const],
};

describe('the stage', () => {
  it('shows the door to nobody signed in, and to an anonymous session', () => {
    expect(stageFor({ signedIn: false, me: null, intent: false })).toBe('door');
    expect(stageFor({ signedIn: false, me: parent, intent: true })).toBe('door');
  });

  it('waits for the server before it decides anything about a signed-in account', () => {
    expect(stageFor({ signedIn: true, me: null, intent: true })).toBe('checking');
  });

  it('shows a parent account its home', () => {
    expect(stageFor({ signedIn: true, me: parent, intent: false })).toBe('home');
  });

  it('makes the account a parent’s only when the parent’s door was pressed', () => {
    expect(stageFor({ signedIn: true, me: { kind: 'not-parent' }, intent: true })).toBe('joining');
  });

  it('sends a student account back to its own app, and never shows it a parent screen', () => {
    expect(stageFor({ signedIn: true, me: { kind: 'not-parent' }, intent: false })).toBe('learner');
  });

  it('shows the door again when the server says the session is gone', () => {
    expect(stageFor({ signedIn: true, me: { kind: 'signed-out' }, intent: false })).toBe('door');
  });

  it('says the dial is closed, and says there is trouble, rather than guessing', () => {
    expect(stageFor({ signedIn: true, me: { kind: 'closed', message: 'x' }, intent: true })).toBe(
      'closed',
    );
    expect(stageFor({ signedIn: true, me: { kind: 'trouble', message: 'x' }, intent: false })).toBe(
      'trouble',
    );
    expect(stageFor({ signedIn: true, me: { kind: 'unwired' }, intent: false })).toBe('unwired');
  });
});

const asha: ParentChild = { learnerId: 'kid-1', name: 'Asha', linkedAt: null };
const kabir: ParentChild = { learnerId: 'kid-2', name: 'Kabir', linkedAt: null };

describe('the switch', () => {
  it('is never drawn for one child, or for none', () => {
    expect(showsSwitcher([])).toBe(false);
    expect(showsSwitcher([asha])).toBe(false);
    expect(showsSwitcher([asha, kabir])).toBe(true);
  });

  it('chooses the only child without asking, because a one-child parent has nothing to choose', () => {
    expect(chooseFor([asha], null)).toBe('kid-1');
    // a selection the server no longer honours (the link ended) is a selection to replace
    expect(chooseFor([asha], 'kid-9')).toBe('kid-1');
  });

  it('never chooses on a parent’s behalf between two children', () => {
    expect(chooseFor([asha, kabir], null)).toBeNull();
  });

  it('leaves a live selection alone', () => {
    expect(chooseFor([asha], 'kid-1')).toBeNull();
    expect(chooseFor([asha, kabir], 'kid-2')).toBeNull();
  });

  it('names the child on screen only when the server’s selection is one of the live children', () => {
    expect(current([asha, kabir], 'kid-2')).toEqual(kabir);
    expect(current([asha, kabir], 'kid-9')).toBeNull();
    expect(current([asha], null)).toBeNull();
  });
});
