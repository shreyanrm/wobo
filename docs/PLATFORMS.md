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

## 6. The order, in one line

Reserve both names this week. Build the web app to four out of four. Ship Android. Then iOS. No desktop.
