/**
 * The four doors on a parent's home, and where each one goes.
 *
 * The list is the server's (`GET /v1/parent/me` → `actions`, which is `PARENT_ACTIONS`), so a door
 * is drawn only for something the server says this account may do. Where each goes is decided
 * here, once, and so is whether the screen behind it exists yet.
 *
 * `ACTION_SCREENS` IS THE PLUG, and the only one. The ask, the pay screen and the refer screen are
 * other builders' (screens/parent/AskAboutChild and friends, billing's parent checkout): the day
 * one lands, its builder adds one loader line below and the door opens by itself, because
 * `SCREEN_READY` is read off this table rather than kept beside it. Until then the door keeps its
 * shape and carries the `soon` chip, the same honesty the sign-in doors keep, and its address
 * opens a page that says the part is on its way. A loaded screen is mounted inside the parent's
 * host (ParentRuntime.tsx), under the same sign-in and the same parent check as the home.
 *
 * Giving goes to `/donate`, the public page that already takes a gift for a family who cannot pay.
 */

import type { ComponentType } from 'react';
import type { Route } from '../../shell/router';
import type { ParentAction } from './api';

/** The screen behind each of the three doors that live under /parent, once it is built. */
export type ActionScreen = () => Promise<{ default: ComponentType }>;

export const ACTION_SCREENS: Readonly<
  Partial<Record<Exclude<ParentAction, 'donate'>, ActionScreen>>
> = {
  ask: () => import('./AskAboutChild').then((m) => ({ default: m.AskAboutChild })),
  pay: () => import('./PayForChild').then((m) => ({ default: m.PayForChild })),
  refer: () => import('./ReferFamily').then((m) => ({ default: m.ReferFamily })),
};

/** Whether each door leads somewhere. Giving is the public donate page, which already exists. */
export const SCREEN_READY: Readonly<Record<ParentAction, boolean>> = {
  ask: 'ask' in ACTION_SCREENS,
  pay: 'pay' in ACTION_SCREENS,
  refer: 'refer' in ACTION_SCREENS,
  donate: true,
};

export interface ActionDoor {
  action: ParentAction;
  to: Route;
  open: boolean;
}

const ORDER: readonly ParentAction[] = ['ask', 'pay', 'refer', 'donate'];

function routeOf(action: ParentAction): Route {
  return action === 'donate' ? { name: 'donate' } : { name: 'parent', action };
}

export function doorsFor(actions: readonly ParentAction[]): ActionDoor[] {
  return ORDER.filter((a) => actions.includes(a)).map((action) => ({
    action,
    to: routeOf(action),
    open: SCREEN_READY[action],
  }));
}
