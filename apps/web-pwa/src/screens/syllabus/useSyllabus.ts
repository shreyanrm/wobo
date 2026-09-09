'use client';

/**
 * The hook every syllabus page reads its own subject matter through.
 *
 * Two sources, in this order and never the other way round:
 *
 *  1. `tree.ts` — the syllabus frozen into the build. It answers synchronously, so the page's first
 *     paint is the finished page. That matters more here than anywhere else on the site: these
 *     pages are pre-rendered into real HTML files for crawlers that do not run JavaScript, and a
 *     page whose content arrives after a fetch is a page those crawlers read as empty.
 *  2. `door.ts` — `GET /v1/syllabus`, asked once the page is on screen. When a board has published
 *     a new edition since the build, the door has it and the file does not, so the node the page is
 *     ABOUT is replaced with the door's version: its name, its children and its provenance. The
 *     crumbs above it stay the file's, because those are the addresses this page was reached by.
 *
 * A door that is down, slow, unconfigured or aborted changes nothing. A door that answers 404 for a
 * path the build published means the board has withdrawn it, and the page says so rather than going
 * on showing a chapter that is no longer in the syllabus.
 */

import { useEffect, useState } from 'react';
import { useSdk } from '../../store/sdk';
import { type Address, layerOf } from './address';
import { askDoor, type DoorNode, type DoorSource } from './door';
import { find, type Node, type Place, type Source } from './tree';

/** Where the page's facts came from, for the quiet line that says so. */
export type Freshness =
  /** The build's own copy, and nothing has contradicted it. */
  | 'built'
  /** The gateway confirmed it, or corrected it, since this page was opened. */
  | 'checked'
  /** The gateway no longer holds this path: the board has withdrawn it. */
  | 'withdrawn';

export interface SyllabusRead {
  place: Place | null;
  freshness: Freshness;
}

function toSource(source: DoorSource | null): Source | null {
  if (!source) return null;
  return {
    url: source.url ?? null,
    section: source.section ?? null,
    hash: source.document_hash ?? null,
    fetched: source.fetched_at ?? null,
    verified: source.verified_at ?? null,
    checks: Array.isArray(source.checks_passed) ? source.checks_passed : [],
  };
}

/**
 * The place, with the node it is about taken from the door's answer. Children arrive from the door
 * without their own children (a subject page lists its chapters, not every topic under each), so a
 * child keeps whatever the build knew about its own contents.
 */
export function applyLive(place: Place, answer: DoorNode, address: Address): Place | null {
  const layer = layerOf(address);
  const kids = new Map(place.node.children.map((child) => [child.slug, child]));
  const built = (slug: string): readonly Node[] => kids.get(slug)?.children ?? [];

  if (layer === 'topic') {
    // A topic is served as a chapter's child, so the chapter is what was asked for and the topic
    // is read back out of it. A topic the door no longer lists is a topic the board has dropped.
    const row = answer.children.find((child) => child.slug === place.node.slug);
    if (!row) return null;
    return {
      ...place,
      node: {
        kind: 'topic',
        slug: row.slug,
        name: row.name,
        source: toSource(row.source),
        children: [],
      },
      siblings: answer.children.map((child) => ({
        kind: 'topic' as const,
        slug: child.slug,
        name: child.name,
        source: toSource(child.source),
        children: [],
      })),
      index: answer.children.findIndex((child) => child.slug === place.node.slug),
    };
  }

  const kind = place.node.kind;
  const childKind: Node['kind'] =
    kind === 'board'
      ? 'class'
      : kind === 'class'
        ? 'subject'
        : kind === 'subject'
          ? 'chapter'
          : 'topic';
  return {
    ...place,
    node: {
      kind,
      slug: place.node.slug,
      name: answer.node?.name ?? place.node.name,
      source: toSource(answer.source) ?? place.node.source,
      children: answer.children.map((child) => ({
        kind: childKind,
        slug: child.slug,
        name: child.name,
        source: toSource(child.source),
        children: built(child.slug),
      })),
    },
  };
}

/**
 * Read one syllabus page. Synchronous on the build's copy, then corrected by the open door.
 * `null` for a place is a real 404, decided by the build; the door can only turn a page that
 * existed into one that has been withdrawn, never invent one.
 */
export function useSyllabus(address: Address): SyllabusRead {
  const sdk = useSdk();
  const gateway = sdk.config.gatewayUrl;
  const built = find(address);
  const [read, setRead] = useState<SyllabusRead>({ place: built, freshness: 'built' });
  const key = `${address.board}/${address.level ?? ''}/${address.subject ?? ''}/${address.chapter ?? ''}/${address.topic ?? ''}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the address is carried by `key`
  useEffect(() => {
    const place = find(address);
    setRead({ place, freshness: 'built' });
    if (!place || !gateway) return;
    const control = new AbortController();
    const layer = layerOf(address);
    // A topic asks for its own chapter; every other layer asks for itself.
    const query = {
      board: address.board,
      ...(layer === 'board' ? {} : { level: address.level }),
      ...(layer === 'board' || layer === 'class' ? {} : { subject: address.subject }),
      ...(layer === 'chapter' || layer === 'topic' ? { chapter: address.chapter } : {}),
    };
    void askDoor(gateway, query, { signal: control.signal }).then((answer) => {
      if (control.signal.aborted) return;
      if (answer.state === 'unavailable') return;
      if (answer.state === 'gone') {
        setRead({ place, freshness: 'withdrawn' });
        return;
      }
      const live = applyLive(place, answer.node, address);
      if (!live) setRead({ place, freshness: 'withdrawn' });
      else setRead({ place: live, freshness: 'checked' });
    });
    return () => control.abort();
  }, [key, gateway]);

  return read;
}
