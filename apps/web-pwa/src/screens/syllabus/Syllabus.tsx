'use client';

/**
 * THE SYLLABUS PAGES: `/learn/<board>/<class>/<subject>/<chapter>/<topic>`, and every page above.
 * Four boards, thirteen classes, fifty subjects, three hundred and thirty-three chapters and seven
 * hundred and eleven topics, one address each.
 *
 * THE CHAPTER PAGE is the one this family is built around, and everything else is the road to it.
 * It carries, in this order and for a reason:
 *
 *  1. **The name, and where it sits.** A reader who arrived on "light class 10" needs to know in
 *     one line whether this is their light, in their class, on their board.
 *  2. **One honest sentence**, drawn from the chapter's own topics. Never written for it, never
 *     inflated, and on a board that gave us no topic list, it says that instead.
 *  3. **The topics, as links.** On ICSE and ISC there are none, and the slot is empty rather than
 *     filled with something plausible (docs/GROWTH-SEARCH.md §3).
 *  4. **The provenance, quietly.** The official document, the page or section inside it, the hash
 *     of the bytes we read and the day we read them. This is the thing no competitor publishes and
 *     the reason a page family generated at this scale is not spam.
 *  5. **The tutor door.** A real ask box, grounded, that answers about this exact chapter without
 *     an account. Nobody else in this market offers one on a page like this.
 *  6. **The way on.** Up to the subject and the class, and sideways to the chapter either side.
 *
 * WHAT THE PAGE NEVER DOES. It never claims an explanation it does not have. The drawn explanation
 * from the concept cores is tier two of this family and the cores are not built, so no line here
 * implies one exists. When it does, it goes in above the provenance and this comment changes.
 */

import { lazy, type ReactNode, Suspense } from 'react';
import { PitchAsk } from '../pitch/Ask';
import { ClosePanel } from '../site/ClosePanel';
import { syllabusClose } from '../site/handoffs';
import { SiteLink } from '../site/nav';
import { SiteShell } from '../site/SiteShell';
import { type Address, addressPath, parentOf } from './address';
import {
  ask,
  checksLine,
  childrenLabel,
  heading,
  headingLine,
  linkNote,
  linkText,
  NO_TOPICS,
  provenance,
  shortHash,
  summary,
  title,
} from './copy';
import { type Handmade, handmade } from './handmade';
import { ensureSyllabusStyles } from './styles';
import {
  type Board,
  CHILD_KIND,
  hasPage,
  type Node,
  neighbours,
  type Place,
  PUBLISHED_LAYERS,
  pathOf,
} from './tree';
import { type Freshness, useSyllabus } from './useSyllabus';

// The chunk arriving IS the page being opened, so the sheet goes in at import time.
ensureSyllabusStyles();

const NotFoundScreen = lazy(() =>
  import('../states/StateHost').then((m) => ({ default: m.NotFoundScreen })),
);

// --- the parts every page in the family wears -----------------------------------------------------

/** The trail from the board down to the page above this one, each crumb a real link. */
function Crumbs({ place }: { place: Place }) {
  const trail: { label: string; path: string }[] = [];
  const slugs: Address = { board: place.board.slug };
  const add = (label: string) => trail.push({ label, path: addressPath({ ...slugs }) });
  if (place.kind !== 'board') add(place.board.short);
  if (place.level && place.kind !== 'class') {
    slugs.level = place.level.slug;
    add(place.level.name);
  }
  if (place.subject && place.kind !== 'subject' && place.kind !== 'class') {
    slugs.level = place.level?.slug;
    slugs.subject = place.subject.slug;
    add(place.subject.name);
  }
  if (place.chapter && place.kind === 'topic') {
    slugs.chapter = place.chapter.slug;
    add(place.chapter.name);
  }
  if (trail.length === 0) return null;
  return (
    <nav className="sy-crumbs" aria-label="Where this sits">
      {trail.map((crumb, at) => (
        <span key={crumb.path}>
          {at > 0 ? <i aria-hidden="true">/ </i> : null}
          <SiteLink href={crumb.path}>{crumb.label}</SiteLink>
        </span>
      ))}
    </nav>
  );
}

/**
 * The name, with the quiet line that says where it sits inside the same heading, and the page's one
 * honest sentence under it.
 *
 * THE SENTENCE SITS OUTSIDE THE `<header>`, on purpose. `scripts/prerender.ts` reads a page's own
 * opening words back off the render to write its meta description, and it skips anything inside a
 * `header` because on every other page that is chrome. Left inside, all 409 of these pages were
 * described to a search engine by their provenance line instead of by what they are about, and 320
 * of them shared a description with another page. It is the page's lead paragraph, not part of its
 * heading, so this is where it belonged anyway.
 */
function Head({ place, written }: { place: Place; written: Handmade | null }) {
  const head = heading(place);
  return (
    <>
      <header className="sy-head">
        <h1>
          <span className="sy-name">{head.name}</span>
          <span className="sy-where">, {head.where}</span>
        </h1>
      </header>
      {written ? <p className="sy-lead">{written.opening}</p> : null}
      <p className={written ? 'sy-counted' : 'sy-lead'}>{summary(place)}</p>
    </>
  );
}

/**
 * THE ONE QUESTION THIS PAGE IS REALLY BEING ASKED, and the page's own answer to it.
 *
 * Only the sixty-seven pages somebody lands on while deciding carry one, and every one of them was
 * written for that address and appears at no other (`handmade.ts`, and the owner ruling it quotes).
 * It sits after the list of what is under this page and before the provenance: a reader who came
 * for the chapter list gets the chapter list first, and a reader who came to decide reads on.
 */
function Written({ written }: { written: Handmade }) {
  return (
    <section className="sy-written" aria-labelledby="sy-written">
      <h2 id="sy-written">{written.question}</h2>
      <p>{written.answer}</p>
    </section>
  );
}

/**
 * What is under this page. Nothing at all where the board gave us nothing.
 *
 * A CHILD IS A LINK ONLY WHERE THIS BUILD WROTE THE PAGE (`PUBLISHED_LAYERS` in `tree.ts`). Every
 * chapter page used to link each of its topics, and the build writes no topic page: 711 addresses
 * that the site's own pages pointed at answered 200 with the wordless SPA shell, so a crawler
 * following our links found more empty addresses than real pages. The topics are still named,
 * because the names are what the chapter knows and what a reader came for; they simply are not
 * offered as somewhere to go until the tier that gives them something to say lands
 * (docs/GROWTH-SEARCH.md §4).
 *
 * AND ONLY WHERE THE CHILD HAS SOMETHING OF ITS OWN. A released layer says nothing about one
 * particular node: two boards hand us a unit with no topic list under it, and a page whose whole
 * content is its own name is not published, so it is not linked either (`hasPage` in `tree.ts`,
 * and the same rule inside the gate in `pages.ts`). Those units are still named here, with the
 * document behind each, which is where a reader was going to end up anyway.
 */
function Children({ place, wide }: { place: Place; wide?: boolean }) {
  const kids = place.node.children;
  if (kids.length === 0) return null;
  const childLayer = CHILD_KIND[place.kind];
  const addressable = childLayer !== null && PUBLISHED_LAYERS.includes(childLayer);
  const label = childrenLabel(place.kind);
  const id = `sy-${label.toLowerCase()}`;
  const pathTo = (child: Node): string => {
    const address: Address = { board: place.board.slug };
    if (place.kind === 'board') address.level = child.slug;
    else if (place.kind === 'class') {
      address.level = place.level?.slug;
      address.subject = child.slug;
    } else if (place.kind === 'subject') {
      address.level = place.level?.slug;
      address.subject = place.subject?.slug;
      address.chapter = child.slug;
    } else {
      address.level = place.level?.slug;
      address.subject = place.subject?.slug;
      address.chapter = place.chapter?.slug;
      address.topic = child.slug;
    }
    return addressPath(address);
  };
  return (
    <section className={wide ? 'sy-list sy-wide' : 'sy-list'} aria-labelledby={id}>
      <h2 id={id}>{label}</h2>
      <ul>
        {kids.map((child, at) => {
          const note = linkNote(child);
          const inside = (
            <>
              <b>{linkText(child, kids, at)}</b>
              {note ? <span>{note}</span> : null}
            </>
          );
          return (
            <li key={child.slug}>
              {addressable && hasPage(child) ? (
                <SiteLink href={pathTo(child)}>{inside}</SiteLink>
              ) : (
                <span className="sy-row">{inside}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * WHERE THIS CAME FROM. The quiet block, and the whole argument for the family's legitimacy: the
 * official document, where inside it, the hash of the bytes, the day we read them and the named
 * checks that passed. It is stated plainly and never dressed up, because a trust signal that
 * shouts stops being one.
 */
function Provenance({
  node,
  board,
  freshness,
}: {
  node: Node;
  board: Board;
  freshness: Freshness;
}) {
  const source = node.source;
  const checks = checksLine(source);
  const hash = shortHash(source);
  return (
    <section className="sy-source" aria-labelledby="sy-source">
      <h2 id="sy-source">Where this came from</h2>
      <p>{provenance(source, board)}</p>
      {checks ? <p>{checks}</p> : null}
      {source?.url ? (
        <a className="sy-doc" href={source.url} rel="nofollow noopener" target="_blank">
          Open the document on the board's site
        </a>
      ) : null}
      {hash ? (
        <p className="sy-hash" title={source?.hash ?? undefined}>
          Document hash {hash}
        </p>
      ) : null}
      {freshness === 'withdrawn' ? (
        <p className="sy-stale">
          The board no longer lists this one. What is on this page is what its document said when we
          last read it.
        </p>
      ) : null}
    </section>
  );
}

/**
 * Up one, and the two beside. A page in a reference family never leaves a reader at the end.
 *
 * A NEIGHBOUR IS OFFERED ONLY WHERE THE BUILD WROTE ITS PAGE, for the same reason a child is
 * (`Children`, and `hasPage` in `tree.ts`). Six chapters that the gate refuses sit between
 * chapters it publishes, and each of them was linked as "Before this" or "After this" from the
 * page on either side: six more addresses that answered 200 with the wordless SPA shell. The way
 * on from a page has to be a page.
 */
function Around({ place }: { place: Place }) {
  if (place.kind === 'board') return null;
  const beside = neighbours(place);
  const before = beside.before && hasPage(beside.before) ? beside.before : null;
  const after = beside.after && hasPage(beside.after) ? beside.after : null;
  const up = parentOf({
    board: place.board.slug,
    ...(place.level ? { level: place.level.slug } : {}),
    ...(place.subject ? { subject: place.subject.slug } : {}),
    ...(place.chapter ? { chapter: place.chapter.slug } : {}),
    ...(place.topic ? { topic: place.topic.slug } : {}),
  });
  const sideways = (node: Node): string => {
    const address: Address = { board: place.board.slug };
    if (place.kind === 'class') address.level = node.slug;
    else if (place.kind === 'subject') {
      address.level = place.level?.slug;
      address.subject = node.slug;
    } else if (place.kind === 'chapter') {
      address.level = place.level?.slug;
      address.subject = place.subject?.slug;
      address.chapter = node.slug;
    } else {
      address.level = place.level?.slug;
      address.subject = place.subject?.slug;
      address.chapter = place.chapter?.slug;
      address.topic = node.slug;
    }
    return addressPath(address);
  };
  // Nothing above and nothing beside with a page of its own: an empty landmark is worse than none.
  if (!up && !before && !after) return null;
  return (
    <nav className="sy-around" aria-label="The rest of this syllabus">
      {up ? (
        <SiteLink href={addressPath(up)}>
          <em>Up one</em>
          <b>{upLabel(place)}</b>
        </SiteLink>
      ) : null}
      {before ? (
        <SiteLink href={sideways(before)}>
          <em>Before this</em>
          <b>{before.name}</b>
        </SiteLink>
      ) : null}
      {after ? (
        <SiteLink href={sideways(after)}>
          <em>After this</em>
          <b>{after.name}</b>
        </SiteLink>
      ) : null}
    </nav>
  );
}

function upLabel(place: Place): string {
  if (place.kind === 'topic') return (place.chapter as Node).name;
  if (place.kind === 'chapter') return (place.subject as Node).name;
  if (place.kind === 'subject') return (place.level as Node).name;
  return place.board.name;
}

// --- the page --------------------------------------------------------------------------------------

/**
 * The page's body, in the order the chapter page's six parts have to arrive in, with the tutor
 * door handed in as a slot. It is a component of its own so the order and the words can be read
 * back off real markup in a test (`markup.test.tsx`) without standing up the SDK, the chat and the
 * router that the ask box needs: the ORDER is the design decision here, and a design decision
 * nothing checks is a design decision that drifts.
 */
export function SyllabusBody({
  place,
  freshness,
  door,
}: {
  place: Place;
  freshness: Freshness;
  /** The tutor door. It sits after the provenance and before the way on, always. */
  door: ReactNode;
}) {
  const noTopics = place.kind === 'chapter' && place.node.children.length === 0;
  const written = handmade(pathOf(place));
  return (
    <div className="sy">
      <div className="st-wrap">
        <Crumbs place={place} />
        <Head place={place} written={written} />
        {noTopics ? <p className="sy-none">{NO_TOPICS}</p> : null}
        <Children place={place} wide={place.kind === 'board' || place.kind === 'class'} />
        {written ? <Written written={written} /> : null}
        <Provenance node={place.node} board={place.board} freshness={freshness} />
        {door}
        <Around place={place} />
      </div>
    </div>
  );
}

export function Syllabus({ address }: { address: Address }) {
  const { place, freshness } = useSyllabus(address);
  if (!place) {
    return (
      <Suspense fallback={null}>
        <NotFoundScreen />
      </Suspense>
    );
  }
  const door = ask(place);
  return (
    <SiteShell current="subjects" title={title(place)} label={heading(place).name}>
      <SyllabusBody
        place={place}
        freshness={freshness}
        door={
          <PitchAsk
            page="learn"
            heading={door.heading}
            placeholder={door.placeholder}
            chips={door.chips}
            // WHAT THIS PAGE IS ABOUT, so the door answers about THIS chapter. Without it the box
            // sent `page="learn"` and nothing else, and a question typed on a chapter page was
            // answered out of the whole syllabus corpus (docs/GROWTH-SEARCH.md §3: the door is one
            // of the three things that make this family worth publishing, and a door that does not
            // know where it is standing is not one of them).
            about={headingLine(heading(place))}
          />
        }
      />
      <ClosePanel page="syllabus" title={syllabusClose(place.kind)} />
    </SiteShell>
  );
}
