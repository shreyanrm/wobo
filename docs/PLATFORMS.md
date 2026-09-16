# The stores: what ships when, and why not all at once

**The owner, 2026-09-09:** *"How about our mobile apps and desktop apps we had planned? Are they going
to be last on the list?"*

The plan (WOBO-PLAN section on platforms, owner-confirmed 2026-09-02) is store apps for iOS and
Android, phones and tablets, through Capacitor, from the same codebase, in the launch phase. Nothing is
built yet; what exists is a web app that already installs to a home screen with its own icon and runs
standalone. No desktop app appears anywhere in the plan, and section 4 below argues it should stay that
way.

They should not be last. But they split into three pieces with very different costs and very different
risks, and treating them as one item is what would push them to the end.

## 1. This week, and it is a form rather than an app

**Reserve the name Wobo in Google Play Console and App Store Connect.** No code, no review, no release.
An app name is a namespace like a handle, it is first-come, and it is the one part of this that is
genuinely time-sensitive: the moment the product draws attention, somebody takes the name. It also does
entity work immediately, because a store listing is one of the strongest signals an answer engine reads
about what a name means (docs/GROWTH-ENTITY.md).

Cost: two developer accounts, about 2,500 rupees a year for Google and about 8,000 for Apple. Do it
before anything else on this page.

## 2. Android next, and sooner than people expect

**Android is about 95 percent of Indian smartphones, and Google Play accepts a web app in a shell
readily.** Our web app already meets the installability bar, so the Android build is a Capacitor shell
around the same codebase plus the store assets, not a rewrite. The listing is worth having well before
the iOS one, for four reasons:

- **Discovery.** Indian parents search the Play Store as directly as they search Google. We are absent
  from a surface where our audience looks.
- **Trust.** A parent about to pay trusts a store listing more than a website.
- **Retention.** An icon on a home screen is most of the retention game for a product meant to be used
  daily.
- **Reviews.** The reviews on that listing are what an answer engine quotes when someone asks whether
  Wobo is any good, and they take months to accumulate, so they should start early.

**But not before the tutor is good.** A one-star review is permanent and the store's ranking never
forgets it. So Android ships when the ink scores four (docs/INK-FOUR.md) and the first boards are real,
not before. That is the gate, and it is a product gate rather than a calendar one.

## 3. iOS after that

Apple reviews harder and rejects thin wrappers under its own rule about minimum functionality, so the
iOS build needs the native pieces that make it a real app: proper offline, notifications, the camera
path for photographing homework, and share targets. Those are worth building anyway. It is also the
smaller share of our market and the more expensive mistake to make badly, so it follows Android rather
than accompanying it.

## 4. No desktop app, and this is a recommendation rather than a deferral

A desktop shell would cost real work and buy almost nothing. There is no discovery surface on desktop
that matters for our audience, the web app already installs on a laptop with its own window and icon,
and a learner on a laptop opens a browser. The one thing a desktop app could add, drawing over other
applications the way Clicky does, is a different product from the one we are building, which draws on
its own page. If that ever becomes the product, it deserves its own decision rather than inheriting
this one.

## 5. What we build in the meantime, which is most of the work anyway

Everything that makes a store app good is web work we should do regardless, and it is already in the
plan: offline lessons, a fast cold start on a cheap Android phone, the camera path, the share targets,
push notifications, and the install prompt in the right place. Doing these makes the web app better on
its own and turns the store builds into packaging rather than a project.

## 6. The gate is the owner's own review (owner, 2026-09-09)

*"On the mobile and desktop apps, I want the web version to be ready. I view it and test it, and then
when I am satisfied is when we will implement it."*

So the gate is not a score and not a date. **No store build begins until the owner has walked the web
version end to end and said it is ready.** Four out of four on the ink and the first real boards are
what make that walk worth doing, not a substitute for it.

What that means in practice:

- Every hour that would have gone into a shell goes into the web version instead, which is where the
  work belongs anyway: offline lessons, a fast cold start on a cheap Android phone, the camera path,
  share targets, notifications, and the install prompt in the right place. All of it makes the web
  version better on its own and turns the store builds into packaging.
- When the owner is ready to walk it, they get a clean build and a route through every surface: the
  door, onboarding, a lesson with the ink, a photographed doubt, the arcade, the parent's view, the
  plans, the console. Not a demo, the real thing, on a real phone.
- The one thing that is not an implementation and does not wait, if the owner wants it: **reserving the
  name Wobo in both stores**, which is a form rather than a build, protects a first-come namespace, and
  is a strong entity signal on its own. That is the owner's call, and everything else holds.

## 7. What a store build changes about the money, and it is not the price

This survived from the earlier version of this page because it is a standing owner ruling rather
than a plan, and the rewrite above dropped it: it belongs wherever store apps are described.

- The web terms describe our own billing and our own cancellation, which lives on the You screen,
  on the card called Your plan. There is no goodwill refund policy to describe: the owner's ruling
  of 4 September 2026 is **cancel, never refund**, and the only refunds left are the ones the law
  requires, listed in `docs/legal/refund-and-cancellation.md` section 5.
- The iOS terms must say the subscription is billed by the App Store, that it renews unless
  cancelled before the period ends, that cancellation is managed in the device's account settings,
  and that refunds there are handled by the store rather than by us. Apple's own model text for an
  auto-renewing subscription is required near the purchase control.
- The Android terms say the same with the Play billing equivalents.
- The price is the same on every platform. A store takes its cut out of what we receive, never out
  of what a family pays.
- One privacy policy serves all platforms, and it names recipients only as "third-party AI and
  infrastructure providers".

## 8. The order, in one line

Build the web version until the owner walks it and is satisfied. Then Android. Then iOS. No desktop.
Reserve the two store names whenever the owner chooses, since that is a namespace rather than a build.

## 7. What the owner set aside, 2026-09-16

Section 5 lists offline lessons and the install prompt among the web work that makes a store build
"packaging rather than a project". Two of those are now set aside by the owner, and this section
supersedes that line rather than leaving it to be read as still true.

**"We will be releasing our own apps on both stores, so that shouldn't be a concern."** The install
prompt is a WEB affordance: it adds Wobo to a home screen from the browser. A learner who installs
from Play or the App Store never meets it. It is built and landed and costs nothing to keep, but it
earns no more work: the settings row that would let a learner who declined ask again is NOT built,
and `askAgain()` keeps zero callers on purpose.

**"We are currently not focusing on offline."** What wave 53 landed stays — a lesson already opened
plays without the network, and removing that would be destroying working, tested code for nothing.
What stops is further investment: no expiry rule for a kept lesson, no offline work in any queued
wave, and the offline items drop out of the walk's own list above.

**One consequence worth stating, because it cuts the other way.** The 33.8-second cold start measured
in wave 53 is dominated by fetching 1,195 kB over slow 3G. Inside a store app the bundle is already on
the device, so that figure largely goes away for app learners — it stays only for web visitors, who
are the SEO surface and the owner's own walk. The cold-start wave therefore drops in urgency for
learners and keeps its urgency for the public site.
