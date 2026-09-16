/**
 * What this seat may see and do, as the console draws it.
 *
 * THE LAW (docs/CONSOLE-ROLES-AND-BOARD.md §2): "The console shows only what a person holds. A panel
 * they cannot read is not greyed out, it is not there, and its route refuses them with the same
 * message a stranger gets." The refusal is the gateway's (`admin_auth._require_panel`). This file is
 * the half that means nobody meets it: the rail, the controls and the reads all ask here first.
 *
 * The capabilities are the gateway's words, `panel.<id>.read` and `panel.<id>.act`, read from the
 * session and from `GET /v1/admin/panels`. Nothing in this bundle grants one. The maps below are
 * checked against `services/gateway/src/wobo_gateway/console_panels.py` by `seats.test.ts`, so a
 * desk filed under the wrong panel is a red test rather than a desk that refuses its own reads.
 */

import type { EndpointName } from './contract';
import { DESKS, type Desk, type DeskId } from './desks';

/** The gateway's panels, in its own order. */
export const PANEL_IDS = [
  'money',
  'models',
  'learner',
  'support',
  'curriculum',
  'content',
  'boards',
  'growth',
  'mail',
  'platform',
  'register',
] as const;

export type PanelId = (typeof PANEL_IDS)[number];

/** Each desk, under the panel whose routes it reads. */
export const DESK_PANEL: Record<DeskId, PanelId> = {
  spend: 'money',
  models: 'models',
  allowance: 'money',
  pacing: 'money',
  users: 'learner',
  activity: 'mail',
  mail: 'mail',
  subscriptions: 'money',
  promo: 'money',
  alerts: 'platform',
  health: 'platform',
  syllabus: 'curriculum',
  boardChanges: 'boards',
  flag: 'support',
  bug: 'support',
  support: 'support',
  refund: 'support',
  register: 'register',
};

/** Each endpoint, under the panel the gateway guards it with. `null` is a question about who is
 *  asking (the session, the panels, your own trail), which every seat may put. */
export const ENDPOINT_PANEL: Record<EndpointName, PanelId | null> = {
  session: null,
  sessionEnd: null,
  whoami: null,
  panels: null,
  audit: null,
  admins: 'register',
  usage: 'money',
  economics: 'money',
  health: 'platform',
  deskSummary: 'support',
  reports: 'support',
  reportWho: 'learner',
  reportState: 'support',
  activity: 'mail',
  learnerActivity: 'learner',
  mail: 'mail',
  mailUnpause: 'mail',
  promo: 'money',
  promoRedemptions: 'money',
  promoCreate: 'money',
  promoDisable: 'money',
  models: 'models',
  allowance: 'money',
  settingsApply: 'platform',
  syllabus: 'curriculum',
  syllabusRetry: 'curriculum',
  syllabusPromote: 'curriculum',
  syllabusPrewarm: 'curriculum',
  boardChanges: 'boards',
  boardChangeGrant: 'boards',
  boardChangeDials: 'boards',
};

function has(held: readonly string[], panel: PanelId, side: 'read' | 'act'): boolean {
  return held.includes(`panel.${panel}.${side}`);
}

export function mayRead(held: readonly string[], desk: DeskId): boolean {
  return has(held, DESK_PANEL[desk], 'read');
}

/** An act is a control only on a desk that is drawn, so it needs the read as well. */
export function mayAct(held: readonly string[], desk: DeskId): boolean {
  return mayRead(held, desk) && has(held, DESK_PANEL[desk], 'act');
}

/** Whether to ASK for this endpoint at all. A read the seat does not hold is never sent: its
 *  refusal would read as a closed session. */
export function holdsEndpoint(held: readonly string[], endpoint: EndpointName): boolean {
  const panel = ENDPOINT_PANEL[endpoint];
  return panel === null || has(held, panel, 'read');
}

export function visibleDesks(held: readonly string[]): Desk[] {
  return DESKS.filter((desk) => mayRead(held, desk.id));
}

/** The desk to show: the one asked for when the seat reads it, otherwise the first it does. */
export function firstDesk(held: readonly string[], wanted: DeskId): DeskId | null {
  if (mayRead(held, wanted)) return wanted;
  return visibleDesks(held)[0]?.id ?? null;
}

/** `GET /v1/admin/panels`, checked. Only the capability list is used: it is the effective set. */
export function isPanelsAnswer(
  value: unknown,
): value is { readonly capabilities: readonly string[] } {
  if (typeof value !== 'object' || value === null) return false;
  const list = (value as { capabilities?: unknown }).capabilities;
  return Array.isArray(list) && list.every((entry) => typeof entry === 'string');
}
