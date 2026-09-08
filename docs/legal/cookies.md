# Cookies and similar technologies

Draft of 3 September 2026. Version 0.1. Written by the Wobo team, not yet reviewed by a lawyer. See `README.md` in this folder for the review checklist.

> **In plain words**
>
> Wobo stores a few things in your browser or on your device. Most of them are the boring, necessary kind: they keep you signed in, remember whether you chose dark mode, and keep your place in a lesson if the network drops.
>
> There are no advertising cookies in Wobo. Nobody is following you around the internet because of us.
>
> Nothing that is not strictly necessary is stored at all, so there is nothing to ask you about and there is no cookie banner. If that ever changes, the banner comes first and this notice is rewritten before it does.

---

## 1. What we mean by cookies

A cookie is a small file a site stores in your browser. We use a few other kinds of local storage too, and we treat them all the same way in this notice: local storage and session storage, IndexedDB, service worker caches for offline lessons, and, in the phone apps, the equivalent device storage.

## 2. What we store, and why

### Strictly necessary

These do not need consent, because without them the product does not work. Turning them off would mean turning Wobo off.

| Name or purpose | What it does | How long |
|---|---|---|
| Session and authentication | keeps you signed in, and stops someone else using your session | until you sign out, or [30 days] |
| Security | protects the session, and helps us tell one device from another when we are limiting abuse | session to [12 months]. [REVIEW: the rate limiting the product runs today is counted on our own servers and not in your browser, and the platform cookies our hosts set have not been enumerated. List the cookies actually set, by name, before this notice is relied on.] |
| Load balancing and routing | sends your request to a working server | session |
| Preferences | theme, language, reduced motion, larger text, high contrast, and whether Wobo speaks out loud | until you clear them |
| Offline learning cache | keeps downloaded lessons and boards on your device so they work without a network | until you clear it, or the download expires |
| In-progress work | your place in a lesson and your unsaved working, so a dropped connection does not lose it | until the lesson is finished |

### Optional

**There is no optional category. There is nothing here.**

The product has no analytics, no crash reporting, no performance reporting and no A/B testing. Not switched off, not behind a consent banner: not in the product. An earlier draft of this notice described all three and a banner to control them, and none of the four existed.

We do not use advertising cookies, cross-site tracking pixels, social media trackers, fingerprinting, or data brokers. [REVIEW: re-confirm against the shipped bundle before every release, including anything a third-party script pulls in. The one third-party origin the product reaches at runtime is a public code delivery network, which serves the Python runtime for computer-science exercises and therefore sees the device's address; it stores nothing on the device on our behalf.]

## 3. Children

There is nothing optional to agree to, at any age, so we do not ask a child for cookie consent and we do not ask a parent either. If an optional category is ever added, a learner under 18 is the one case where it does not go in until the consent flow described in `parental-consent.md` exists and gates it. [REVIEW: ePrivacy consent for minors, the UK Age Appropriate Design Code, and the DPDP Act's restriction on tracking and behavioural monitoring of children.]

## 4. How to change your mind

- **In Wobo:** there is no cookie settings panel, because there is nothing optional for it to switch. On You, under Settings, Your data, "erase and start over" clears everything Wobo has stored on the device.
- **In your browser:** you can block or delete cookies in your browser settings. Blocking the strictly necessary ones will sign you out and break offline lessons.
- **On your phone:** clearing the app's storage removes everything, including downloaded lessons.
- **Global signals:** Global Privacy Control asks a site to stop selling or sharing personal data and to switch off non-essential storage. We do neither, so there is nothing for the signal to turn off, and we do not currently read it. An earlier draft said we honour it, which was a claim about a mechanism we do not have. [REVIEW: CPRA and other US state laws requiring universal opt-out mechanisms, and whether a site with nothing to opt out of still has to read and respond to the signal.]

## 5. Consent, and where the rules come from

In the EU and the UK, storing anything on your device that is not strictly necessary needs your consent, under the ePrivacy rules as well as the GDPR. We store nothing that is not strictly necessary, so we do not ask, and there is no banner. If we ever add something optional, the banner comes first, refusing will be as easy as accepting, with a plain reject control of the same weight and no pre-ticked boxes. [REVIEW: ePrivacy Directive Article 5(3), national implementations, and the guidance on consent-banner design, including the position on refusing without a second click. Two rows in the strictly necessary table in section 2 need deciding here rather than assuming: the preferences store, since the interface-customisation exemption as applied by the EDPB and national regulators reaches only storage set on the user's own explicit request and kept for a short period, which a preferences store written by default does not obviously satisfy. If it fails the exemption, it needs a consent step, and that means a banner after all.]

In India, storage that involves personal data sits under the consent notice described in `privacy-policy.md`. [REVIEW: DPDP Act and its rules.]

In California and other US states, the relevant question is whether any of this counts as selling or sharing. It does not, because none of it goes to an advertiser. [REVIEW: CCPA and CPRA definitions of sale and share, and whether any analytics provider's terms make it a sale.]

## 6. Third parties

There are no optional analytics or crash reporting providers, because there is no analytics and no crash reporting. The categories in `privacy-policy.md` section 5 that are real are the third-party AI and infrastructure providers who run the tutoring itself; the canonical list of recipient categories is the table in `privacy-policy.md` section 5, and every other document uses its names. We name categories rather than companies, for the reason given in `privacy-policy.md` section 5. A named list is available on request at support@heywobo.com. [REVIEW: whether a named list is required in the cookie notice itself in the EU and the UK.]

## 7. Changes

If we add a purpose, we will ask before we store anything for it. Old versions of this notice are not currently kept anywhere a reader can reach; ask at support@heywobo.com and we will send you the previous wording.

Questions: support@heywobo.com.
