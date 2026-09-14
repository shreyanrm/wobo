import { describe, expect, it } from 'bun:test';
import { applyPop, pathToRoute, type Route, routeFromPath, routeToPath } from './router';

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
