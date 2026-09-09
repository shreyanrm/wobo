/**
 * THE OPEN DOOR — `GET /v1/syllabus` on the gateway (`curriculum/public.py`).
 *
 * One path, four depths: no query is the boards we publish, `?board=` its classes, `&class=` its
 * subjects, `&subject=` its chapters, `&chapter=` its topics. It needs no account and no token,
 * carries the provenance on every node, and is cached hard at the edge, so a page can ask it from
 * a stranger's browser without costing anything.
 *
 * WHY A PAGE READS IT AT ALL, given that `tree.ts` already holds the whole syllabus. The file is
 * frozen at build time so the site can be built without a live service. The door is what makes a
 * page that is already in front of a reader correct: a board publishes a new edition, the gateway
 * serves it that hour, and a page built last week would otherwise go on quietly showing last
 * week's chapters until the next deploy. So the file renders the page and the door corrects it.
 *
 * Never throws, and never blocks a render. A gateway that is down, slow, or not configured at all
 * leaves the page exactly as the file drew it, which is a correct page and not an empty one.
 */

export interface DoorSource {
  url: string | null;
  section: string | null;
  document_hash: string | null;
  fetched_at: string | null;
  verified_at: string | null;
  checks_passed: string[];
}

export interface DoorChild {
  kind: string;
  slug: string;
  name: string;
  source: DoorSource | null;
  publishable: boolean;
}

export interface DoorNode {
  kind: string;
  path: Record<string, string>;
  board: { slug: string; name: string; short?: string; label?: string; version?: string } | null;
  label: string | null;
  node: { kind: string; slug: string; name: string; publishable: boolean } | null;
  source: DoorSource | null;
  children: DoorChild[];
}

/** What the door said, or why it could not be asked. `gone` is a real 404 and means exactly that. */
export type DoorAnswer =
  | { state: 'held'; node: DoorNode }
  | { state: 'gone' }
  | { state: 'unavailable' };

export interface DoorQuery {
  board?: string | undefined;
  level?: string | undefined;
  subject?: string | undefined;
  chapter?: string | undefined;
}

/** The query string for one depth, in the order the door nests them. */
export function doorQuery(query: DoorQuery): string {
  const params = new URLSearchParams();
  if (query.board) params.set('board', query.board);
  if (query.level) params.set('class', query.level);
  if (query.subject) params.set('subject', query.subject);
  if (query.chapter) params.set('chapter', query.chapter);
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * Ask the door about one node. A topic is not addressable on its own: it is served as a chapter's
 * child, so a topic page asks for its chapter and reads itself out of the answer.
 */
export async function askDoor(
  gatewayUrl: string,
  query: DoorQuery,
  init: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<DoorAnswer> {
  const call = init.fetchImpl ?? fetch;
  try {
    const res = await call(
      `${gatewayUrl.replace(/\/$/, '')}/v1/syllabus${doorQuery(query)}`,
      init.signal ? { signal: init.signal } : {},
    );
    if (res.status === 404) return { state: 'gone' };
    if (!res.ok) return { state: 'unavailable' };
    const body: unknown = await res.json().catch(() => null);
    if (!body || typeof body !== 'object') return { state: 'unavailable' };
    const node = body as DoorNode;
    if (!Array.isArray(node.children)) return { state: 'unavailable' };
    return { state: 'held', node };
  } catch {
    // An abort, a network that is down, a gateway that is not configured: the page keeps the
    // syllabus it was built with, which is the right answer and not an apology.
    return { state: 'unavailable' };
  }
}
