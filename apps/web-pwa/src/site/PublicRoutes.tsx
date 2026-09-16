'use client';

/**
 * Every public-site screen, one chunk each, and the one place that says which address shows which.
 *
 * The module itself is only a table of `lazy()` handles — it costs a few hundred bytes — so both
 * hosts can share it: `PublicSite` renders it on its own for a visitor who has not walked through
 * the door, and the app runtime renders it inside the app's own frame for a learner who has.
 * Neither one can drift from the other, because there is only one table.
 *
 * The loaders are named separately from the components on purpose. React only asks a `lazy()` for
 * its module when it RENDERS it — and every page but the landing renders inside the SDK scope,
 * which is itself a chunk. Left alone that is a queue, not a parallel fetch: the scope's round trip
 * has to finish before the page's even starts, which on a 560 ms link cost the pitch pages nearly
 * two seconds. `preloadPublicScreen` asks for the page's module at the same moment, so the two
 * arrive together.
 */

import { lazy, type ReactNode } from 'react';
import type { Route } from '../shell/router';

const load = {
  about: () => import('../screens/site/About'),
  blog: () => import('../screens/site/blog/Blog'),
  blogPost: () => import('../screens/site/blog/BlogPost'),
  blogTag: () => import('../screens/site/blog/BlogTag'),
  contact: () => import('../screens/contact/Contact'),
  donate: () => import('../screens/donate/Donate'),
  forParents: () => import('../screens/pitch/ForParents'),
  forStudents: () => import('../screens/pitch/ForStudents'),
  gift: () => import('../screens/gift/Gift'),
  help: () => import('../screens/site/Help'),
  helpArticle: () => import('../screens/site/HelpArticle'),
  howItWorks: () => import('../screens/pitch/HowItWorks'),
  landing: () => import('../screens/landing/Landing'),
  legal: () => import('../screens/legal/Legal'),
  meetWobo: () => import('../screens/pitch/MeetWobo'),
  notFound: () => import('../screens/states/StateHost'),
  plans: () => import('../screens/plans/Plans'),
  plansCheckout: () => import('../screens/plans/Checkout'),
  press: () => import('../screens/press/Press'),
  security: () => import('../screens/pitch/Security'),
  signIn: () => import('../screens/auth/Auth'),
  sitemap: () => import('../screens/site/Sitemap'),
  subjects: () => import('../screens/pitch/Subjects'),
  subjectHub: () => import('../screens/syllabus/SubjectHub'),
  compare: () => import('../screens/growth/Compare'),
  exams: () => import('../screens/growth/Exams'),
  glossary: () => import('../screens/growth/Glossary'),
  syllabus: () => import('../screens/syllabus/Syllabus'),
} as const;

const About = lazy(() => load.about().then((m) => ({ default: m.About })));
const Blog = lazy(() => load.blog().then((m) => ({ default: m.Blog })));
const BlogPostPage = lazy(() => load.blogPost().then((m) => ({ default: m.BlogPost })));
const BlogTagPage = lazy(() => load.blogTag().then((m) => ({ default: m.BlogTag })));
const Contact = lazy(() => load.contact().then((m) => ({ default: m.Contact })));
const Donate = lazy(() => load.donate().then((m) => ({ default: m.Donate })));
const ForParents = lazy(() => load.forParents().then((m) => ({ default: m.ForParents })));
const ForStudents = lazy(() => load.forStudents().then((m) => ({ default: m.ForStudents })));
const Gift = lazy(() => load.gift().then((m) => ({ default: m.Gift })));
const Help = lazy(() => load.help().then((m) => ({ default: m.Help })));
const HelpArticle = lazy(() => load.helpArticle().then((m) => ({ default: m.HelpArticle })));
const HowItWorks = lazy(() => load.howItWorks().then((m) => ({ default: m.HowItWorks })));
const Landing = lazy(() => load.landing().then((m) => ({ default: m.Landing })));
const Legal = lazy(() => load.legal().then((m) => ({ default: m.Legal })));
const MeetWobo = lazy(() => load.meetWobo().then((m) => ({ default: m.MeetWobo })));
const NotFoundScreen = lazy(() => load.notFound().then((m) => ({ default: m.NotFoundScreen })));
const PlansCheckout = lazy(() => load.plansCheckout().then((m) => ({ default: m.Checkout })));
const PlansPage = lazy(() => load.plans().then((m) => ({ default: m.Plans })));
const Press = lazy(() => load.press().then((m) => ({ default: m.Press })));
const Security = lazy(() => load.security().then((m) => ({ default: m.Security })));
const SignIn = lazy(() => load.signIn().then((m) => ({ default: m.SignIn })));
const SignUp = lazy(() => load.signIn().then((m) => ({ default: m.SignUp })));
const Sitemap = lazy(() => load.sitemap().then((m) => ({ default: m.Sitemap })));
const Subjects = lazy(() => load.subjects().then((m) => ({ default: m.Subjects })));
// The syllabus family — 1,111 addresses, one chunk. The syllabus itself travels with it (about
// 32 kB over the wire) and nothing else on the site pays for it, which is why it is loaded here
// and never from a shared module.
const SubjectHubPage = lazy(() => load.subjectHub().then((m) => ({ default: m.SubjectHub })));
const SyllabusPage = lazy(() => load.syllabus().then((m) => ({ default: m.Syllabus })));
// The three growth families. Each index and its entries share one chunk, so a reader who walks
// from the glossary index into an entry pays for the syllabus data once.
const ComparePage = lazy(() => load.compare().then((m) => ({ default: m.Compare })));
const CompareEntryPage = lazy(() => load.compare().then((m) => ({ default: m.CompareEntry })));
const ExamsPage = lazy(() => load.exams().then((m) => ({ default: m.Exams })));
const ExamBoardPage = lazy(() => load.exams().then((m) => ({ default: m.ExamBoard })));
const GlossaryPage = lazy(() => load.glossary().then((m) => ({ default: m.Glossary })));
const GlossaryEntryPage = lazy(() => load.glossary().then((m) => ({ default: m.GlossaryEntry })));
// DEV ONLY: the kit gallery at /ui-kit — every primitive in both themes, for the design gate. A
// production build has no chunk for it and the address answers with the 404.
//
// THE IMPORT SITS INSIDE THE GATE, AND IT DID NOT USED TO, which is why this gate read as though
// it had already removed the kit while the kit shipped anyway. `uiKit` was a property of the
// `load` table above, and a property of an always-constructed object is always reachable: the
// dynamic import stayed live in the module graph and Rollup emitted the chunk however dead the
// `lazy` beside it was. Measured in the built app: `UiKit-C5vZXnZD.js`, 8.3 kB, precached into
// every install. A dev-only surface is removed by making its `import()` lexically unreachable in
// a production build, and by nothing else — so no loader for a bench may live in `load`.
const loadUiKit = import.meta.env.DEV ? () => import('../ui/UiKit') : null;
const UiKit = import.meta.env.DEV
  ? lazy(() => import('../ui/UiKit').then((m) => ({ default: m.UiKit })))
  : null;

/** The module a public address needs. Kept beside `publicScreen` so the two cannot drift. */
function loaderFor(route: Route): (() => Promise<unknown>) | null {
  switch (route.name) {
    case 'landing':
      return load.landing;
    case 'about':
      return load.about;
    case 'blog':
      return load.blog;
    case 'blogPost':
      return load.blogPost;
    case 'blogTag':
      return load.blogTag;
    case 'help':
      return load.help;
    case 'helpArticle':
      return load.helpArticle;
    case 'legal':
      return load.legal;
    case 'plans':
      return route.checkout ? load.plansCheckout : load.plans;
    case 'gift':
      return load.gift;
    case 'donate':
      return load.donate;
    case 'sign-in':
    case 'sign-up':
      return load.signIn;
    case 'contact':
      return load.contact;
    case 'sitemap':
      return load.sitemap;
    case 'security':
      return load.security;
    case 'press':
      return load.press;
    case 'meet-wobo':
      return load.meetWobo;
    case 'for-parents':
      return load.forParents;
    case 'for-students':
      return load.forStudents;
    case 'how-it-works':
      return load.howItWorks;
    case 'subjects':
      return load.subjects;
    case 'syllabus':
      return load.syllabus;
    case 'subjectHub':
      return load.subjectHub;
    case 'glossary':
    case 'glossaryEntry':
      return load.glossary;
    case 'exams':
    case 'examBoard':
      return load.exams;
    case 'compare':
    case 'compareEntry':
      return load.compare;
    case 'notfound':
      return load.notFound;
    case 'ui-kit':
      // `loadUiKit` is null in a production build, so the address preloads the 404 it will render.
      return loadUiKit ?? load.notFound;
    default:
      return null;
  }
}

/**
 * Start fetching a public address's chunk NOW, without waiting to render it. The module registry
 * hands the same promise back when React asks for it, so this costs one request, never two.
 */
export function preloadPublicScreen(route: Route): void {
  const loader = loaderFor(route);
  if (loader) void loader();
}

/**
 * The screen a public address shows, or null when the address belongs to the app. Callers render
 * it inside their own <Suspense>, because what waits for a chunk differs either side of the door.
 */
export function publicScreen(route: Route): ReactNode {
  switch (route.name) {
    case 'landing':
      return <Landing />;
    case 'about':
      return <About />;
    case 'blog':
      return <Blog />;
    case 'blogPost':
      return <BlogPostPage slug={route.slug} />;
    case 'blogTag':
      return <BlogTagPage tag={route.tag} />;
    case 'help':
      return <Help />;
    case 'helpArticle':
      return <HelpArticle group={route.group} slug={route.slug} />;
    case 'legal':
      return <Legal {...(route.slug ? { slug: route.slug } : {})} />;
    case 'plans':
      return route.checkout ? <PlansCheckout /> : <PlansPage />;
    case 'gift':
      return <Gift />;
    case 'donate':
      return <Donate />;
    case 'sign-in':
      return <SignIn />;
    case 'sign-up':
      return <SignUp />;
    case 'contact':
      return <Contact />;
    case 'sitemap':
      return <Sitemap />;
    case 'security':
      return <Security />;
    case 'press':
      return <Press />;
    case 'meet-wobo':
      return <MeetWobo />;
    case 'for-parents':
      return <ForParents />;
    case 'for-students':
      return <ForStudents />;
    case 'how-it-works':
      return <HowItWorks />;
    case 'subjects':
      return <Subjects />;
    case 'syllabus':
      return (
        <SyllabusPage
          address={{
            board: route.board,
            ...(route.level ? { level: route.level } : {}),
            ...(route.subject ? { subject: route.subject } : {}),
            ...(route.chapter ? { chapter: route.chapter } : {}),
            ...(route.topic ? { topic: route.topic } : {}),
          }}
        />
      );
    case 'subjectHub':
      return <SubjectHubPage subject={route.subject} />;
    case 'glossary':
      return <GlossaryPage />;
    case 'glossaryEntry':
      return <GlossaryEntryPage slug={route.slug} />;
    case 'exams':
      return <ExamsPage />;
    case 'examBoard':
      return <ExamBoardPage board={route.board} />;
    case 'compare':
      return <ComparePage />;
    case 'compareEntry':
      return <CompareEntryPage slug={route.slug} />;
    case 'notfound':
      return <NotFoundScreen />;
    case 'ui-kit':
      return UiKit ? <UiKit /> : <NotFoundScreen />;
    default:
      return null;
  }
}
