/**
 * THE ADDRESS OF A SYLLABUS PAGE. A leaf: no React, no JSON, no app imports, so the router can
 * read it without dragging the syllabus itself into the entry chunk a stranger downloads first.
 *
 * The shape, and why it is this shape:
 *
 *     /learn/<board>/<class>/<subject>/<chapter>/<topic>
 *
 * One path per layer, each one a prefix of the next, so the page above any page is that page's
 * address with a segment taken off. A crawler that finds a chapter can walk up to the subject, the
 * class and the board without being told how, a reader can edit the bar, and every breadcrumb is
 * computed rather than stored.
 *
 * The segments are the board's OWN names, slugged by the gateway (`curriculum/public.py`) and
 * frozen into `syllabus.json`, never a phrase chosen for search. What people type shapes the
 * sentences and the link text (`copy.ts`); an address is a name.
 *
 * `/learn` on its own is the app's learn screen and stays that way. It has never been a public
 * address and it is not one now: this family starts one segment deeper.
 *
 * The generic subject pages live at `/subjects/<subject>`, under the pitch page that already
 * answers "do you cover mine", because a reader who lands on the subject with no board in mind is
 * asking that page's question.
 */

/** The address of one syllabus page: the slugs, outermost first. Each needs the one above it. */
export interface Address {
  board: string;
  level?: string | undefined;
  subject?: string | undefined;
  chapter?: string | undefined;
  topic?: string | undefined;
}

/** The first segment of every address in this family. */
export const ROOT = 'learn';

/** Where the board-agnostic subject pages live. */
export const HUB_ROOT = 'subjects';

/** A slug that could be one of ours: lowercase, digits and hyphens, as the gateway writes them. */
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export function isSlug(value: string): boolean {
  return value.length > 0 && value.length <= 80 && SLUG.test(value);
}

/** The path this address lives at. */
export function addressPath(address: Address): string {
  const parts = [address.board, address.level, address.subject, address.chapter, address.topic];
  const named: string[] = [];
  for (const part of parts) {
    if (!part) break;
    named.push(part);
  }
  return `/${ROOT}/${named.join('/')}`;
}

/** The path of a board-agnostic subject page. */
export function hubPath(subject: string): string {
  return `/${HUB_ROOT}/${subject}`;
}

/**
 * The address these segments name, or null when they cannot name one. Null is the 404: a probe at
 * a sixth segment, a slug with a slash escaped into it or a typo has to be told nothing is there.
 */
export function addressFrom(segments: readonly string[]): Address | null {
  if (segments.length < 1 || segments.length > 5) return null;
  if (!segments.every((segment) => isSlug(segment))) return null;
  const [board, level, subject, chapter, topic] = segments;
  return {
    board: board as string,
    ...(level ? { level } : {}),
    ...(subject ? { subject } : {}),
    ...(chapter ? { chapter } : {}),
    ...(topic ? { topic } : {}),
  };
}

/** Which layer an address names, from how deep it goes. */
export function layerOf(address: Address): 'board' | 'class' | 'subject' | 'chapter' | 'topic' {
  if (address.topic) return 'topic';
  if (address.chapter) return 'chapter';
  if (address.subject) return 'subject';
  if (address.level) return 'class';
  return 'board';
}

/** The address of the page one layer up, or null at the board. */
export function parentOf(address: Address): Address | null {
  if (address.topic) return { ...address, topic: undefined };
  if (address.chapter) return { ...address, chapter: undefined, topic: undefined };
  if (address.subject)
    return { ...address, subject: undefined, chapter: undefined, topic: undefined };
  if (address.level) return { board: address.board };
  return null;
}
