import { describe, expect, it } from 'bun:test';
import {
  applyPop,
  bootAddressFor,
  disown,
  headFor,
  pathToRoute,
  type Route,
  routeFromPath,
  routeToPath,
} from './router';

/** One of every named route, including the ones that carry parameters. */
const EVERY_ROUTE: Route[] = [
  { name: 'landing' },
  { name: 'onboarding' },
  { name: 'building' },
  { name: 'home' },
  { name: 'chat' },
  { name: 'learn' },
  { name: 'practice' },
  { name: 'subject', subjectId: 'math', intent: 'learn' },
  { name: 'subject', subjectId: 'science', intent: 'practice' },
  { name: 'course', topicId: 'm2-1' },
  { name: 'course', topicId: 'custom:why the sky is blue' },
  // The link that lands (docs/EMAILS-AND-ANIMATIONS.md §4): a mail's button carries the card.
  { name: 'course', topicId: 'm2-1', cardId: 'scale' },
  { name: 'course', topicId: 'm2-1', cardId: '4' },
  { name: 'sandbox' },
  { name: 'sandbox', topicId: 'm2-1' },
  { name: 'progress' },
  { name: 'you' },
  { name: 'doubt' },
  // The parent account's own family (screens/parent), and the learner's preview that moved off
  // `/parent` so the parent account could have it.
  { name: 'parent' },
  { name: 'parent', action: 'ask' },
  { name: 'parent', action: 'pay' },
  { name: 'parent', action: 'refer' },
  { name: 'parent', action: 'donate' },
  { name: 'parent-preview' },
  { name: 'about' },
  { name: 'help' },
  { name: 'helpArticle', group: 'wobo-basics', slug: 'what-is-wobo' },
  { name: 'sign-in' },
  { name: 'sign-up' },
  { name: 'contact' },
  { name: 'sitemap' },
  { name: 'security' },
  { name: 'meet-wobo' },
  { name: 'for-parents' },
  { name: 'for-students' },
  { name: 'how-it-works' },
  { name: 'subjects' },
  { name: 'concept', which: 'engines' },
];

describe('routes have addresses', () => {
  it('every named route round-trips through its path', () => {
    for (const route of EVERY_ROUTE) {
      expect(pathToRoute(routeToPath(route))).toEqual(route);
    }
  });

  it('gives each route a distinct address', () => {
    const paths = EVERY_ROUTE.map(routeToPath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('carries a free-text course id through the URL intact', () => {
    const route: Route = { name: 'course', topicId: 'custom:photosynthesis, step by step' };
    const path = routeToPath(route);
    expect(path).not.toContain(' ');
    expect(pathToRoute(path)).toEqual(route);
  });

  it('addresses one card of a course, and the course itself keeps its own address', () => {
    // §4 of the design: `/course/<course>/card/<card>`. The course with no card is unchanged, so
    // every link already in an inbox, a bookmark or a share still means what it meant.
    expect(routeToPath({ name: 'course', topicId: 'm2-1', cardId: 'scale' })).toBe(
      '/course/m2-1/card/scale',
    );
    expect(routeToPath({ name: 'course', topicId: 'm2-1' })).toBe('/course/m2-1');
    expect(pathToRoute('/course/m2-1/card/scale')).toEqual({
      name: 'course',
      topicId: 'm2-1',
      cardId: 'scale',
    });
    // The generated player's cards are numbered; the atom's are named. Both are one segment.
    expect(pathToRoute('/course/m2-1/card/4')).toEqual({
      name: 'course',
      topicId: 'm2-1',
      cardId: '4',
    });
    // A free-text course keeps its card too — the id is escaped, the card segment is not lost.
    const custom = { name: 'course', topicId: 'custom:black holes', cardId: '2' } as const;
    expect(routeToPath(custom)).toBe('/course/custom%3Ablack%20holes/card/2');
    expect(pathToRoute(routeToPath(custom))).toEqual(custom);
  });

  it('is a 404 for a card address with nothing in the card segment', () => {
    for (const path of ['/course/m2-1/card', '/course/m2-1/card/', '/course/m2-1/card/a/b']) {
      expect(pathToRoute(path)).toBeNull();
    }
  });

  it('reads the root and ignores a query or hash', () => {
    expect(pathToRoute('/')).toEqual({ name: 'home' });
    expect(pathToRoute('/course/m2-1?utm=x')).toEqual({ name: 'course', topicId: 'm2-1' });
    expect(pathToRoute('/you#top')).toEqual({ name: 'you' });
  });

  it('refuses an address that is not ours, and says so rather than pretending', () => {
    for (const path of [
      '/nonsense',
      '/course', // a course with no topic
      '/course/m2-1/extra',
      '/subject/math', // no intent
      '/subject/math/dance', // not an intent
      '/concept/z',
      '/concept/a', // the deleted design prototypes — an old bookmark is a dead link, and says so
      '/concept/b',
      '/concept/c',
      '/you/settings',
      '/parent/read-the-chat', // a parent account does four things, and there is no fifth address
      '/parent/ask/extra',
      '/you/parent/extra',
    ]) {
      expect(pathToRoute(path)).toBeNull();
      expect(routeFromPath(path)).toEqual({ name: 'notfound', path });
    }
  });

  it('keeps the address a 404 was asked for, so the learner can see the slip in it', () => {
    // The URL bar is evidence. Rewriting it to /404 would hide the typo or the truncated link.
    expect(routeToPath(routeFromPath('/coarse/m2-1'))).toBe('/coarse/m2-1');
    expect(routeFromPath('/gone?from=email')).toEqual({ name: 'notfound', path: '/gone' });
    expect(routeToPath({ name: 'notfound' })).toBe('/404');
  });
});

describe('the first address the router writes', () => {
  /**
   * THE SESSION RIDES IN THE FRAGMENT. A Google sign-in comes back as `/onboarding#access_token=…`
   * (or `/parent#…`), and the SDK that adopts it is built inside a LAZY chunk. The router's boot
   * write used to replace the address with the bare path before that chunk arrived, so the SDK
   * found no fragment and nobody was ever signed in by Google (measured 2026-09-17: the session key
   * stayed null). The same write took a mail link's `?k=` before the runtime could spend it. The
   * boot write keeps what came after the path whenever the path itself is unchanged; the SDK and
   * the runtime each scrub their own piece once they have read it.
   */
  it('keeps the query and the fragment when the path is the one that was asked for', () => {
    expect(
      bootAddressFor({ here: '/parent', target: '/parent', search: '', hash: '#access_token=a' }),
    ).toBe('/parent#access_token=a');
    expect(
      bootAddressFor({ here: '/course/m2-1', target: '/course/m2-1', search: '?k=t', hash: '' }),
    ).toBe('/course/m2-1?k=t');
    expect(bootAddressFor({ here: '/', target: '/', search: '?a=1', hash: '#x' })).toBe('/?a=1#x');
  });

  it('writes the bare path when the address is being corrected to another one', () => {
    expect(bootAddressFor({ here: '/landing', target: '/', search: '?k=t', hash: '#x' })).toBe('/');
  });
});

describe('the parent account’s addresses', () => {
  it('is /parent for the home and /parent/<action> for each of the four doors', () => {
    expect(routeToPath({ name: 'parent' })).toBe('/parent');
    expect(routeToPath({ name: 'parent', action: 'ask' })).toBe('/parent/ask');
    expect(pathToRoute('/parent/donate')).toEqual({ name: 'parent', action: 'donate' });
  });

  it('keeps the learner’s own preview, at an address under their own page', () => {
    expect(routeToPath({ name: 'parent-preview' })).toBe('/you/parent');
    expect(pathToRoute('/you/parent')).toEqual({ name: 'parent-preview' });
  });
});

describe('popstate — the system back gesture drives the stack', () => {
  const home: Route = { name: 'home' };
  const learn: Route = { name: 'learn' };
  const course: Route = { name: 'course', topicId: 'm2-1' };

  it('pops when the browser lands on the entry below the top', () => {
    const stack = [home, learn, course];
    expect(applyPop(stack, '/learn')).toEqual([home, learn]);
    // …and again: back out of learn to home, one screen per gesture (never straight out of the app)
    expect(applyPop([home, learn], '/')).toEqual([home]);
  });

  it('is a no-op when the address already matches the top', () => {
    const stack = [home, learn];
    expect(applyPop(stack, '/learn')).toBe(stack);
  });

  it('enters anything else as a new top, so forward still reads as forward', () => {
    expect(applyPop([home], '/course/m2-1')).toEqual([home, course]);
  });

  it('enters an unknown address as the 404 it is, never as a blank screen', () => {
    const gone: Route = { name: 'notfound', path: '/gone' };
    expect(applyPop([learn, course], '/gone')).toEqual([learn, course, gone]);
    expect(applyPop([home, learn], '/gone')).toEqual([home, learn, gone]);
  });

  it('pops back OFF a 404 the way it pops off any other screen', () => {
    const gone: Route = { name: 'notfound', path: '/gone' };
    expect(applyPop([home, gone], '/')).toEqual([home]);
  });
});

/**
 * AN ADDRESS THE BUILD WROTE NO PAGE FOR, DRAWN BY THE APP, ASKS NOT TO BE INDEXED (2026-09-17).
 * The syllabus family answers every address it can compute, and the build pre-renders only the
 * ones that pass the gate. The rest (the whole topic family, and every chapter the gate refused)
 * were served through the app shell, whose `noindex` the router then took off on the way in and
 * replaced with a canonical to the thin page itself. A crawler that runs the page was invited to
 * index exactly what the gate refused.
 */
describe('a syllabus address with no page behind it', () => {
  const topic: Route = {
    name: 'syllabus',
    board: 'cbse',
    level: 'class-10',
    subject: 'mathematics',
    chapter: 'algebra',
    topic: 'polynomials',
  };

  it('is disowned once the page says so, and owned again when it says otherwise', () => {
    const origin = 'https://heywobo.com';
    expect(headFor(topic, origin).robots).toBeNull();
    disown(routeToPath(topic), true);
    const head = headFor(topic, origin);
    expect(head.robots).toBe('noindex');
    expect(head.canonical).toBeNull();
    expect(head.tags.some((tag) => tag.key === 'canonical')).toBe(false);
    disown(routeToPath(topic), false);
    expect(headFor(topic, origin).robots).toBeNull();
    expect(headFor(topic, origin).canonical).toBe(
      'https://heywobo.com/learn/cbse/class-10/mathematics/algebra/polynomials',
    );
  });
});
