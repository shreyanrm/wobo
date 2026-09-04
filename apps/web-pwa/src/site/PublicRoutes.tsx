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
  security: () => import('../screens/pitch/Security'),
  signIn: () => import('../screens/auth/Auth'),
  sitemap: () => import('../screens/site/Sitemap'),
  subjects: () => import('../screens/pitch/Subjects'),
  uiKit: () => import('../ui/UiKit'),
} as const;

const About = lazy(() => load.about().then((m) => ({ default: m.About })));
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
const Security = lazy(() => load.security().then((m) => ({ default: m.Security })));
const SignIn = lazy(() => load.signIn().then((m) => ({ default: m.SignIn })));
const SignUp = lazy(() => load.signIn().then((m) => ({ default: m.SignUp })));
const Sitemap = lazy(() => load.sitemap().then((m) => ({ default: m.Sitemap })));
const Subjects = lazy(() => load.subjects().then((m) => ({ default: m.Subjects })));
// DEV ONLY: the kit gallery at /ui-kit — every primitive in both themes, for the design gate. A
// production build has no chunk for it and the address answers with the 404.
const UiKit = import.meta.env.DEV
  ? lazy(() => load.uiKit().then((m) => ({ default: m.UiKit })))
  : null;

/** The module a public address needs. Kept beside `publicScreen` so the two cannot drift. */
function loaderFor(route: Route): (() => Promise<unknown>) | null {
  switch (route.name) {
    case 'landing':
      return load.landing;
    case 'about':
      return load.about;
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
    case 'notfound':
      return load.notFound;
    case 'ui-kit':
      return UiKit ? load.uiKit : load.notFound;
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
    case 'notfound':
      return <NotFoundScreen />;
    case 'ui-kit':
      return UiKit ? <UiKit /> : <NotFoundScreen />;
    default:
      return null;
  }
}
