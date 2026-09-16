# Reaching Primary: the mail law

**The owner, 2026-09-10:** *"We need to use the right wordings in our mails so that we don't end up in Updates or Promotions or Social and definitely not into spam. We need to go straight to Primary."*

Three readers went at this: what the mailbox providers actually document, what separates Primary mail from Promotions in practice, and how our own 24 templates and our envelope read to a classifier. The evidence is preserved in the session scratchpad. What follows keeps certain, probable and folklore apart on purpose, because this subject is unusually full of confident nonsense.

## The law

WOBO MAIL LAW: how our mail reaches Primary. Certain, probable and folklore are kept apart on purpose.

## 0. The frame

No provider documents any sender-side lever over tab placement. Google publishes one-sentence definitions of the five categories and nothing about the classifier. The only tab guidance Google ever published (send different categories from different addresses, never mix categories in one message) was deleted from the Bulk Senders Guidelines between 2019-04-25 and 2020-06-16 and survives only as spam guidance. Outlook's Focused Inbox is a per-mailbox relevance split with no sender lever. Apple's categoriser runs on-device and Apple says only that it reads senders and header information.

So the goal is not "land in Primary". It is: be a sender the recipient recognises and can answer, send mail that honestly is not a promotion, then measure where it lands. We never promise Primary, to each other or to anyone else.

Two consequences shape everything below.

CERTAIN. Placement belongs to the recipient, not to the message. Google documents that dragging a message to a tab trains Gmail; Microsoft exposes a per-user override keyed on the sender's SMTP address as an API. There is no global Primary to win, only one model per person. One stable sending address, held for years, is worth more than any template decision.

CERTAIN. Updates is not a failure. Google defines Updates as automated confirmations, notifications, statements and reminders. Six of our mails (plan confirmation, receipt, both renewal notices, payment failed, cancellation) are that, word for word, and Updates is their correct home. Primary matters for five: the welcome, the quick one, the mid-chapter, the doubt solved, and the Sunday note to a parent.

## 1. Identity: one sender, and why we do not split it

CERTAIN. Every message goes from Wobo <hello@mail.heywobo.com>, with reply-to support@heywobo.com on the root, a mailbox a person reads. Never noreply, never a second display name, never a per-kind address. Google requires exactly one address in From.

The tension is real and must be named. Google's surviving guidance says messages of the same category should share a From address and different categories should use different ones. Our own law (docs/EMAILS-AND-ANIMATIONS.md) says one sender always: the address that sent the welcome sends the streak. One sender wins, for three reasons. Our whole family is one category, a tutor writing to a learner, so the guidance does not bite. Recipient-side training and Outlook's override both key on the SMTP address, so splitting divides the only asset we have. And a second subdomain would be cold on the exact day it carries our only batch. We separate by List-Id and by dial instead of by address.

The one exception, and it is conditional: if the waiting list is ever larger than a few thousand addresses or older than six months on launch day, the launch mail moves to its own subdomain and is warmed there, because a stale list sent in one day is the documented way a domain is burned and our tutoring stream must not be standing next to it.

CERTAIN, and unbuilt as of 2026-09-08. heywobo.com publishes no SPF, DKIM, DMARC or MX, so no mail has ever been delivered. Build to Google's 5,000-a-day tier from the first message, not the small-sender tier: bulk-sender status is documented as permanent, is triggered by a single 24-hour period counted across the primary domain and all its subdomains, and our launch mail to the list can cross it in one hour. The spec is SPF and DKIM both passing, DMARC on the root at p=none moving to p=quarantine after two clean weeks, From aligned to the DKIM domain under mail.heywobo.com, forward and reverse DNS valid, TLS on transmission, RFC 5322 conformance. Outlook is stricter in one respect: SPF and DKIM must pass, not merely exist, or you get 550 5.7.515.

## 2. Two classes of mail, and which of ours is which

CERTAIN. Google's line: one-click unsubscribe is required for marketing and subscribed messages, and transactional messages (password resets, receipts, confirmations, one-time codes) are excluded.

SUBSCRIBED, and each carries both unsubscribe headers plus its own List-Id and its own dial: the quick one, mid-chapter, the streak, the bonus level, the doubt solved, the win, the wish, the Sunday note to a parent, the welcome, the launch mail to the list.

TRANSACTIONAL, and carries no List-Unsubscribe and no List-Id: verify email, password reset, plan confirmation, receipt, both renewal notices, payment failed, cancellation.

The parent invite is neither. It is a cold message to an adult who never gave us their address, sent because a child asked us to. It gets the subscribed treatment: List-Unsubscribe pointing at the signed decline route, which is one-click and idempotent-safe, in addition to the visible "Not me". Today it ships headers: {} (email_templates.py:1366) and that is the single riskiest mail we send.

CERTAIN, and the largest defect in the code today. Ten templates (account_created, verify_email, course_ready, boss_victory, level_up, streak_milestone, weekly_digest, parent_report, reengage, premium_surprise) emit no headers at all, so seven subscribed messages go out with no unsubscribe header. email.py:414 holds a send for a missing stop link only for HAND_KINDS, so none of them is held. Widen the hold: any kind in SUBSCRIBED whose rendered headers lack List-Unsubscribe is queued, never sent.

CERTAIN. RFC 8058: the List-Unsubscribe URL must be safe under GET and HEAD and must only unsubscribe on POST, because scanners fetch header URLs. Our code already promises one-click only when the target is a signed token on our own stop route (email_templates.py:131-142, tokens.py:161-164). Keep that restraint exactly as it is. Honour every unsubscribe within 48 hours; our own answer is immediately.

CERTAIN. Sending correct headers does not make Gmail show its unsubscribe button. Google states the button appears only for messages that pass its eligibility checks. The answer to "we added the headers, where is the button" is reputation, not markup.

## 3. Shape

CERTAIN and already true, and this is the fleet's greatest asset: not one of the fifteen templates contains an img tag, a tracking pixel, a redirect host or an off-domain link. There is no image-to-text ratio question because there is no image. Nothing in this law is worth trading that for.

CERTAIN. The orb GIFs planned in docs/EMAILS-AND-ANIMATIONS.md take every template from zero remote fetches to one. That is the single largest change to our promotional profile that is currently planned. It ships only after a before-and-after seed measurement, at most one image, with alt text, and the message must read complete with images off.

PROBABLE (practitioner consensus across four independent teardowns, no provider document, no controlled test against tab placement anywhere): image-heavy, multi-column, many-linked mail with a footer of badges and social icons correlates with Promotions; plain, text-first, one-CTA mail from a consistent sender correlates with Primary. We already sit on the right side of it. Keep the shape because it is what a note from a teacher looks like, and stop citing it as a rule.

FOLKLORE, and three of these are load-bearing in our own documents today, so strike them from our reasoning while keeping the behaviour they produced: the 60/40 image-to-text ratio (no provider publishes any ratio; the one controlled test, 64 variants across 23 filters, found ratio irrelevant above 500 characters); a link-count ladder; "one image and under 800 words guarantees Primary"; single-word blocklists such as "free" (Gmail's text vectoriser is explicitly built to defeat character-level evasion, and our own copy says "the free plan" twice, correctly); "a subdomain or the token mail. is a red flag"; "tables or CSS get you filed as promotional"; "Precedence: bulk marks you a legitimate bulk sender"; "strip List-Unsubscribe to look less bulky"; "noreply alone sends you to Promotions".

Our 120-word law is a voice law (voice.md section 4) and a good one. It is not a deliverability rule and must never be defended as one. Same for the forbidden vocabulary list: keep it as register. It happens to agree with the category question, because Gmail is classifying topic and gift-and-offer language names the topic, but that is a coincidence of a good rule, not its justification.

The one structural threshold with real data behind it is a floor, not a ceiling: below 500 characters of text, mail got blocked by several filters in the Email on Acid test. Our shortest specs (boss-beaten at 19 words, festival wishes at 20, birthday at 23) are far under that in the body. Do not pad the body. Measure the whole rendered text part, which includes the reason-you-got-this line, the stop line, the postal address and the sign-off, and that clears 500 characters on its own. If a kind still falls under, the footer is wrong, not the copy.

## 4. Words

The register is not negotiable and it also happens to be the best anti-Promotions posture available: calm, warm, second person, specific, never narrating, no exclamation marks, no emoji, no em dash, no ALL CAPS in a subject, sentence case everywhere. Enforced today for exclamation marks and emoji, and it holds across all 24 specs and all 15 templates.

Where the register and the folklore disagree, the register wins and the argument stops there. We do not write "PS: if this landed in Promotions, drag it to Primary". Google's documented user-side lever is real (removing from spam and adding the sender to Contacts both stop future mail going to spam) and every school district in the field uses it, but a sender who asks to be dragged is telling the reader they expect to be filtered, and that is narration about ourselves. So we use the lever in the one place with no register cost: not in the mail but on the product screen the person is already looking at while they wait for it. The "check your email" screen names the address and says that adding it to contacts keeps the rest arriving; the page a parent lands on after accepting the invite says the same about the Sunday note. That is the whole of it.

Two things in the code are promotions by definition and no shaping saves them. premium_surprise ("a gift: 14 days of premium", "i've unlocked", "no strings", a large magenta numeral, a CTA reading "enjoy premium") is a coupon mail written in four registers of offer language, and it breaks our own forbidden list and birthday.md:45. Delete the kind, or rewrite it as a plain account fact ("Your plan is Pro until 24 September. Nothing to enter.") and accept Updates. weekly_digest and parent_report carry literal percent signs, a stat row and coloured progress bars; percentages are on our own forbidden list and a bar chart is the visual grammar of a newsletter. Replace each percentage with the word the number stands for (solid, growing, started) and drop the bars.

Three more from the audit, all register: boss_victory opens on "+250 XP" at 34px, which is a large coloured numeral above the fold and the most reliable promotional tell in a preview; ten templates default a missing name to "there", producing "your week, there", which voice.md:219 names as the anti-pattern; and ten templates write a lowercase "i" for Wobo, which reads as a mail-merge artefact rather than a person writing. A missing name means the sentence is rewritten without a name, never filled with a word.

## 5. Cadence, and launch day

CERTAIN, and already real code, not a paragraph. One address hears from us at most once in twenty-four hours (MailLog.latest_to reads by address, not by learner, so a parent of two children is protected); no nudge on a day the learner came; one win per learner per seven days; quiet hours and quiet days hold a send; unknown locality sends nothing; an empty week is skipped in silence; every send is idempotent twice over, in our log and as the provider's Idempotency-Key. Double sends are a direct complaint-rate input, so none of this is decoration.

Launch day is the only batch we will ever send and it is the only day this law can be undone. Send the list in slices at a steady rate over several days, never in one hour, oldest signups last (they are the ones who have forgotten us). A daily cap lives in the gateway and is raised by the superadmin, not by a deploy. The first line of that mail reminds the reader they asked, on the page they asked from, because consent that the reader remembers is what keeps a complaint from being filed.

CERTAIN. Keep the user-reported spam rate under 0.10 percent as the operating target and treat 0.30 percent as a cliff: above it we lose eligibility for any delivery mitigation from Google until we have been back under for seven consecutive days. For a parent audience, where one confused adult can report a legitimate school notice, 0.1 percent is the ceiling we manage to.

## 6. Measurement

CERTAIN. Google does not track open rates and says it cannot verify third-party open data. Apple downloads remote content regardless of engagement, so an open on Apple Mail means nothing at all. Opens are not a metric here, and they are not an input to suppression, re-engagement or send-time logic. This is easy for us because we have no pixel.

What we measure: the tab each of the five Primary-relevant mails lands in, on Gmail, Outlook, Yahoo and Apple Mail inboxes we own, recorded on the mail desk before launch and monthly after; Postmaster Tools spam rate and domain reputation; complaint rate per kind via Feedback-ID; clicks measured on our side at the deep-link landing; and replies to support@, which are both the point of the mail and the strongest engagement signal practitioners name.

CERTAIN, and the reason this document is a plan and not a report: nothing has ever been delivered. Every judgement above is a read of code and copy against published rules. The seed test is the only thing that can settle any of it.



## What must never appear

- Exclamation marks, anywhere, including inside 'Happy {{festival_name}}'. Register (voice.md section 3). Enforced today by test_email.py and the wish copy gate, and it is the one promotional tell we have fully closed.
- Emoji, anywhere, including the subject and the display name. Register, and Google separately prohibits emoji-based spoofing in the display name.
- Em dashes, anywhere a person reads. Register (DESIGN.md and voice.md section 3: a dash separates a label from its explanation in a list, and running prose uses a comma or a full stop).
- 'free', 'offer', 'deal', 'discount', 'save', '% off', 'exclusive', 'limited', 'gift', 'unlock', 'unlocked', 'on us', 'no strings', 'act now', 'last chance', 'don't miss', 'hurry'. Register first: these are not how Wobo talks. Category second: Google's own model of a promotion is deals, discount codes and product imagery, so this vocabulary tells the classifier what the mail is rather than tricking it. Exception: 'the free plan' in a body sentence is a fact and stays.
- A percent sign, and any mastery figure expressed as a percentage. Our own forbidden list, and voice.md section 6 forbids rounding a mastery figure up. Use the word the number stands for: solid, growing, started. Currently broken in weekly_digest and parent_report, in the plain text twins as well as the html.
- A large coloured numeral above the fold, including '+250 XP' at 34px in boss_victory. Register (praise the behaviour, not the score) and it is the most reliable promotional tell in a rendered preview.
- Progress bars, stat rows and chip rows in a mail. That is the visual grammar of a newsletter. A summary is sentences.
- ALL CAPS in a subject, a preheader or a first line, including uppercase rendered by text-transform ('STRENGTHS', 'WORTH A NUDGE' in parent_report). Register. Small-caps eyebrows deeper in the paper set are a deliberate design device and stay, one per message.
- 'there' as a name fallback, and 'Hey there'. voice.md:219 names it as the anti-pattern. A missing name means the sentence is rewritten without a name.
- A lowercase 'i' for Wobo. Register (voice.md section 3: sentence case everywhere; Wobo speaks as I). It reads as a mail-merge artefact rather than a person writing. Ten templates do this today.
- 'we noticed', 'we miss you', 'we hope', 'just checking in', 'it looks like you have not'. Never narrate, which docs/EMAILS-AND-ANIMATIONS.md extends explicitly to mail. It also tells the reader they are being watched by a system.
- Any request to drag us to Primary, star us, or add us to contacts, in the body of any mail. Register: a sender who asks to be dragged has announced that they expect to be filtered. The documented lever is real and we use it on the product screen instead.
- A price or an amount as the first token of a subject (renewal-reminder-7-days.md:11 is '{{amount}} on {{renewal_date}}'). Honesty wins over the practitioner worry about numerals, so the fact stays, but the subject leads with the verb: 'Your Wobo plan renews on {{renewal_date}}'.
- 'Re:' or 'Fwd:' on anything that is not a genuine reply or forward. Google names this as prohibited, and it is a lie.
- A countdown, a scarcity line, a queue position, or a number of people ahead. voice.md section 9 and docs/DOORS-CLOSED.md section 3. The list page shows none of it and the launch mail repeats none of it.
- noreply as a From or a Reply-To. Not because a provider penalises it (nobody documents that) but because the reply is the point: replies are the strongest engagement signal practitioners name, and a parent must be able to answer a mail about their child.
- A tracking pixel, a click-tracking rewrite, or a utm parameter. A privacy cost on children's mail, which is reason enough on its own; the metric it buys is broken anyway because Apple prefetches remote content regardless of engagement and Google says it does not track opens. Resend's tracking must be off at the domain, which is an owner dashboard action and not visible in the repo.
- Bcc as a way to reach several parents. It is a documented school failure mode, it truncates the recipient view, and it breaks the one-address-per-24-hours law by making it unmeasurable.
- App store badges, social icons and a slogan in the footer. 'Wobo, made for curious minds' (email_templates.py:328) is the only line in any footer that sells rather than explains; the paper footer does it correctly with why-you-got-this, the switches, the legal links and the address.


## The envelope

- SET From: Wobo <hello@mail.heywobo.com>, byte-identical on every kind. One address only (Google requires exactly one in From), one display name, forever. The inbox list shows the display name and the subject; the address is read only if someone expands the header, so the subdomain costs almost nothing in trust and buys isolation for the root.
- SET Reply-To: support@heywobo.com, on the root domain, behind a mailbox a person reads. A root mailbox survives any reputation event on the sending subdomain, and it is the address a worried parent will actually write to. Replies are the strongest positive engagement signal available, so this header is the one that most plausibly earns Primary over time.
- SET Subject, Date, Message-ID, MIME multipart/alternative with a real text part. RFC 5322 conformance is a Google requirement for all senders. We set none of these ourselves today (email.py:417-426 sends six fields); the provider does. Verify once against a real received message rather than assuming.
- SET List-Unsubscribe: <https URL> on every subscribed kind, pointing at the recipient's signed stop link, or the list-wide stop route when no token was minted, or the signed decline route for the parent invite. Required by Google for marketing and subscribed mail, and since July 2025 it is what puts us in Gmail's Manage subscriptions view at all. Without it the frustrated reader's only remaining button is Block, which is far worse than any tab.
- SET List-Unsubscribe-Post: List-Unsubscribe=One-Click, and only when the target is a tokened endpoint that honours a bare POST with no login. Asserting one-click on a preferences page that needs a sign-in is a promise we cannot keep and a check Gmail and Yahoo actually run. The URL must be safe under GET and HEAD and unsubscribe only on POST; that is the entire reason RFC 8058 exists.
- SET List-Id, one per kind, human readable, for example 'Wobo sunday notes <sunday.mail.heywobo.com>'. Google's subscription guidelines ask for it by name. Honest caveat: Gmail's Manage subscriptions is documented as unsubscribing a user from all lists related to a sender, so per-kind granularity there is not proven. Set it because it is asked for and costs nothing, and never tell anyone it protects the other kinds.
- SET Feedback-ID: {kind}:{stream}:{campaign}:{SenderId}, with SenderId a constant 5 to 15 characters across every mail stream, DKIM-signed by our own domain and verified in Postmaster Tools. Monitoring only, with no documented classification effect. It is the cheapest way to turn 'a kind nobody engages with is switched off by the superadmin' into a measurement rather than a guess, because it gives complaint data per kind.
- OMIT Precedence: bulk. RFC 2076 classifies it as non-standard, controversial and discouraged. Google's instruction to send it was on the page Google deleted around 2019 to 2020, so every article still quoting it is quoting a dead page. Harmless to send and pointless to send.
- OMIT Auto-Submitted. It is the standards-track way to mark machine-generated mail (RFC 3834), but its documented purpose is suppressing autoresponders, which we do not need, and it buys nothing at any classifier. Every header we set must have a named reason and this one has none.
- OMIT X-Mailer, X-Campaign, X-Priority, Importance, X-Entity-Ref-ID and every other X- header. None appears in any current Google sender document. They advertise a campaign tool and buy nothing.
- OMIT Sender and On-Behalf-Of. Both make a mail client render 'via' something, which breaks the single identity the recipient is being asked to recognise.
- OMIT any priority or urgency flag. voice.md section 9 forbids manufactured urgency, and no provider documents a benefit.
- OMIT Return-Path as a hand-set header. The MTA owns it; the requirement is that it aligns under mail.heywobo.com so DMARC passes on SPF as well as DKIM.
- OMIT any Bcc, and send exactly one recipient per message.
- DNS, which is the real envelope: SPF and DKIM both, published at the records Resend gives for mail.heywobo.com; DMARC on the root at p=none with rua, moving to p=quarantine after two clean weeks; valid forward and reverse DNS on the sending IP; TLS on transmission. Outlook rejects with 550 5.7.515 if SPF and DKIM do not both pass at volume. As of 2026-09-08 the domain publishes none of these and every live send is held as domain_unverified.
- PROVIDER SETTINGS, invisible in the repo and therefore owner-checked before the first send: open tracking off, click tracking off. The templates emit clean links and the provider can rewrite them after we hand them over.


## The eight subjects

- The quick one: "{{topic_name}} takes about five minutes" (renders to "Fractions, part two, takes about five minutes", 45 characters). A fact about the work, not about the learner's absence. No number leading, no urgency, nothing to accept or claim.
- Mid-chapter: "Two cards left in {{chapter_name}}" (renders to "Two cards left in Linear equations", 34). The number is small, concrete and countable, which is the opposite of a headline figure. It names the exact chapter, so only this learner could have received it.
- The streak: "{{streak_days}} days in a row, rest days included" (renders to "7 days in a row, rest days included", 35). The second clause is the anti-dark-pattern law from streak-milestones.md:40 carried into the subject, and it is also the least promotional thing a streak mail can say.
- A bonus level: "A side door between {{unit_a}} and {{unit_b}}" (renders to "A side door between Motion and Force", 36). Note what is absent: 'bonus', 'unlocked', 'new', 'free'. It is a place, described.
- The doubt solved: "The page you photographed is worked through" (42). Second person, refers to a thing only this person did, and the verb is what we did with it, not that we noticed it.
- The Sunday note to a parent: "{{learner_first_name}}'s week, in one page" (renders to about 36 characters with a short name). The child's name is the subject of the sentence because the child is the subject of the mail. 'in one page' sets the size, which is the promise the parent invite made.
- The welcome: "Wobo is set up for {{board_short}} class {{class_name}}" (renders to "Wobo is set up for CBSE class 9", 31). Already correct in welcome.md:11 and in the built template. It is a statement of fact about their account, it is unique to them, and it says the work is done rather than asking for anything.
- The launch mail to the list: "Wobo is open" (12). Nothing else earns the space. No 'we are live', no 'the wait is over', no date, no offer, no number of people ahead of them. The register carries it and the shortness reads as a person, not a campaign.


## The eight first lines

- The quick one: "Your next card in {{topic_name}} is a short one, about five minutes." It carries the topic, so it could only have been written to this learner. It does not mention the 48 hours, because saying what we observed is narrating.
- Mid-chapter: "Two cards are left in {{chapter_name}}, starting with {{card_title}}." Two specifics in one sentence, and no sentence about stopping, pausing or falling behind.
- The streak: "{{streak_days}} days in a row, and rest days count too." The rest-day clause is mandatory and it goes first, not in a postscript, so a learner who reads one line has already been told they are allowed to stop.
- A bonus level: "A game opened between {{unit_a}} and {{unit_b}}, and it is optional." The word 'optional' in the first line is the whole difference between an invitation and a pull.
- The doubt solved: "The page you photographed is worked through, step by step." No date, no 'you asked us', no 'your request has been processed'. The reader knows which page.
- The Sunday note to a parent: "Here is {{learner_first_name}}'s week in one page: {{headline}}." The current built template opens on "your child's week", which carries nothing about anybody. The name and the week's one true fact belong in the first line.
- The welcome: "I have your syllabus: {{board_full}}, class {{class_name}}, every subject it sets." Wobo speaks as I (voice.md section 1), the sentence is about what is already done, and it names no allowance, no range and no price.
- The launch mail to the list: "You asked to be told when Wobo opened, and it is open." The consent reminder is the first line because a reader who remembers asking does not report the mail, and because it is the only honest thing to open with when months have passed.


## What a test asserts

Each of these is checked over every rendered template by `test_mail_law.py`.

- SUBJECT LENGTH: for every kind, len(render(kind)['subject']) <= 60, and a warning below 45, since a phone shows roughly 40 characters and the mail is read on a phone.
- SUBJECT PUNCTUATION: subject and preheader contain no '!', no emoji (no codepoint in the emoji ranges), no em dash or en dash ('—', '–'), no '%', no currency symbol as the first token, and no 'Re:' or 'Fwd:' prefix.
- SUBJECT CASE: no run of 4 or more consecutive uppercase letters anywhere in the subject, the preheader, or the first 120 characters of the text part. Small-caps eyebrows deeper in the body are a design device and are exempt, capped at one per message.
- WORD COUNT: word count of the text part, excluding the footer block, is <= 120 for every kind, and <= 200 for the four summary kinds (sunday_note, win, first_week, parent_report).
- TEXT FLOOR: the full rendered text part, footer included, is >= 500 characters for every kind. If a kind fails, the footer is incomplete; do not pad the body.
- FORBIDDEN VOCABULARY, SUBJECT AND FIRST LINE ONLY: none of 'free', 'offer', 'deal', 'discount', 'save', 'gift', 'unlock', 'unlocked', 'limited', 'exclusive', 'bonus' (as a reward), 'on us', 'no strings', 'act now', 'last chance', 'hurry', 'don't miss', 'just for you', 'level up' appears in the subject, the preheader, or the first sentence of the text part. 'the free plan' is allowed in the body, where it is a fact.
- NEVER NARRATE: the rendered text contains none of 'we noticed', 'we miss you', 'we hope', 'just checking in', 'it looks like you', 'our AI', 'your AI wobot', 'this is an automated'.
- NAME FALLBACK: no rendered subject, preheader or body contains ', there' or 'Hey there' or 'Hi there'. render(kind, {}) with no name must produce a sentence with no name in it, not a placeholder word.
- NO PERCENTAGES OR RAW SCORES: the text part of every kind contains no '%' character and no digit-plus-'XP' token.
- IMAGES: for every kind, the html contains zero '<img' today. When the orb ships the assertion becomes: at most one '<img', it has a non-empty alt, and the text part is complete (passes every other assertion) with the image removed.
- LINKS: every href in every kind is https, its host is in the allowlist (heywobo.com, api.heywobo.com and subdomains), no href contains 'utm_', no href is a redirect or tracking host, and the count of distinct destinations is <= 5 (<= 4 excluding the footer legal links). Exactly one destination is the CTA above the footer.
- PLAIN TEXT TWIN: the text part contains every destination URL in full, contains no 'click the button' or 'click here', and is at least three sentences that read alone.
- SUBSCRIBED HEADERS: for every kind in SUBSCRIBED (quick, mid_chapter, streak, bonus, doubt, win, wish, sunday_note, welcome, launch, parent_invite), headers['List-Unsubscribe'] matches '^<https://[^>]+>$' and points at our stop route or the signed decline route.
- ONE-CLICK HONESTY: headers['List-Unsubscribe-Post'] == 'List-Unsubscribe=One-Click' if and only if is_one_click(target) is true. Assert both directions, as test_email.py already does for HAND_KINDS, extended to every subscribed kind.
- TRANSACTIONAL HEADERS: for every kind in TRANSACTIONAL (verify_email, password_reset, plan_confirmation, receipt, renewal_30, renewal_7, payment_failed, cancel_thanks), 'List-Unsubscribe' and 'List-Id' are absent from headers.
- LIST-ID: every subscribed kind sets a List-Id that is unique to that kind and human readable, matching '^Wobo [a-z ]+ <[a-z-]+\\.mail\\.heywobo\\.com>$'. Two kinds never share one.
- FEEDBACK-ID: every kind sets Feedback-ID matching '^[a-z0-9-]{1,20}:[a-z0-9-]{1,20}:[a-z0-9-]{1,20}:[a-z0-9]{5,15}$', the fourth field is the same constant SenderId across all kinds, and the first field is the kind name.
- FORBIDDEN HEADERS: for every kind, none of 'Precedence', 'Auto-Submitted', 'X-Mailer', 'X-Campaign', 'X-Priority', 'Importance', 'X-Entity-Ref-ID', 'Sender' appears in headers.
- ENVELOPE CONSTANTS: the From is exactly one address, identical across all fifteen kinds, display name 'Wobo'; the Reply-To is on the root domain and contains none of 'noreply', 'no-reply', 'donotreply'; there is exactly one recipient per send and no Bcc field is ever populated.
- FOOTER COMPLETENESS: every kind renders the postal address, and every subscribed kind renders a visible stop link whose font-size is >= 13px and whose colour against the footer background has a contrast ratio >= 4.5 to 1. Google's word is 'clearly visible'; 12px at #9A9BA2 (email_templates.py:331-333) fails this and is the current state.
- NO DEAD PLACEHOLDER: no rendered html or text contains '{{', '[', 'placeholder', or 'example.com'. Already asserted for some kinds; apply to all.
- SEND-PATH HOLD: send_email queues rather than sends when the kind is subscribed and the rendered headers lack List-Unsubscribe, or when the postal address is missing, or when the domain is unverified. Assert with a fake provider that no HTTP call is made in each of the three cases.
- INBOX LAW: given two learners sharing one parent address, a second send to that address within 24 hours is refused; a nudge kind is refused on a day with a recorded session; a win kind is refused within 7 days of the last win; a send is refused outside the learner's local hours or after 20:00 local; an unknown locality sends nothing.
- IDEMPOTENCY: two calls with the same (kind, recipient, learner, period) produce one provider call and one log row, and the provider Idempotency-Key equals our own key.
- PREHEADER: non-empty, single line, <= 90 characters, and not equal to and not a prefix of the subject; assert token overlap with the subject below 60 percent.
- RENDERED-MESSAGE CHECK, run once by hand against a real received message, not in CI: the delivered message carries a valid Message-ID and a single Date, From, To and Subject; SPF and DKIM both pass; the From aligns with the DKIM d= domain; no link has been rewritten by the provider; no pixel has been inserted.


## What we could not establish, and must measure ourselves

- Whether any header we set is read by any categoriser. Both the claim that List-Unsubscribe forces Promotions and the claim that it is perfectly neutral are unsourced, in both directions. The only defensible position is that the headers are required or recommended and their classification effect is unmeasured. Same for List-Id, Feedback-ID and Precedence.
- Whether a message we send lands in Primary at all. Nothing has ever been delivered from heywobo.com, so we have zero placement data of our own and every judgement in this law is a read of code and copy against published rules. The seed test (the five Primary-relevant mails to Gmail, Outlook, Yahoo and Apple Mail inboxes we own, tab recorded on the mail desk) is the only thing that can settle it, and it must be run before launch and monthly after.
- Whether the orb GIF moves placement. It takes every template from zero remote fetches to one and it is the single largest planned change to our promotional profile. Measure the same five mails before and after, same sending identity, one variable, or ship nothing.
- No controlled experiment isolating a single structural variable against TAB placement exists anywhere in the published or practitioner literature. The one rigorous structural test (64 variants across 23 filters) measures spam placement, not tabs, and predates Gmail's current text vectoriser. If tab placement ever matters commercially, we run it ourselves with seeded Gmail accounts of matched engagement history.
- Whether adding a sender to Contacts affects category placement. Google documents it only for the Spam folder. It is the centrepiece of what every school district tells parents, and the extension to tabs is universally asserted and nowhere documented. We use it anyway because the spam effect alone is worth it, and we should not claim the tab effect.
- Whether Gmail's classifier behaves differently in India. Gmail is roughly 86.7 percent of Indian addresses in Validity's 2025 seed data and India sits at 83.4 percent inbox against Europe's 89.1 percent, but no source reports India-specific tab data. We are extrapolating US and EU practitioner observation onto an audience where Gmail's share is far higher.
- Whether a Hinglish or romanised-Hindi subject line changes anything at any classifier. Zero measured data in either direction. Treat it as a product decision about whether parents read it more warmly, A/B it ourselves, and keep both variants on the same sending identity so placement is not the confound.
- How large the waiting list will be on launch day, which decides permanently whether we are a bulk sender. Crossing 5,000 messages to personal Gmail accounts in any 24 hours, counted across the primary domain and every subdomain, is documented as irreversible. This is why we build to the bulk spec now, and it is also the number that decides whether the launch mail needs its own warmed subdomain.
- Whether Outlook.com honours RFC 8058 one-click unsubscribe or renders an affordance from List-Unsubscribe at all. Microsoft's wording only ever says 'functional unsubscribe link', which is a body link. Worth one empirical test on an Outlook inbox we own.
- Whether Apple's on-device categoriser reads List-Unsubscribe, List-Id or Precedence. Apple says only 'senders and email header information'. Because the processing is on-device, no seed-list vendor can observe it, so this is untestable at scale and we should stop reasoning about it.
- Whether our provider adds RFC 5322 conformance for us: a valid Message-ID, a single Date, no inserted pixel, no rewritten link. Unverified. One received message, read raw, answers all of it.
- Which fleet actually ships. Twenty-three markdown specs and fifteen built templates overlap on five names and disagree on tone, length and structure everywhere else; seven built templates have no spec and sixteen specs describe mail that cannot be sent. Nothing in the tests reconciles them, so this law cannot be enforced until one of the two is named the target and the other is deleted.
- Whether the ten shell templates are still live or superseded by the paper set. They carry every promotional tell listed above and every missing unsubscribe header. If they are dead, the fix is deletion, not rewriting, and it is a smaller job than it looks.
- The From address disagrees with itself in the repo: docs/copy/emails/README.md:17 says hello@heywobo.com, while all 23 spec headers, email.py:83 and the reasoned argument in docs/EMAILS-AND-ANIMATIONS.md say hello@mail.heywobo.com. One line is stale and an owner should say which.
- Which legal entity appears in the postal line. The default in code names one company; receipt.md:35 still carries owner placeholders. That is a question for the owner, not a code decision, and no mail can ship without it because the send path holds on a missing postal address.

## What we have actually measured

Everything above is research. This is evidence, and the file grows here rather than in the theory.

| When | What was sent | From | To | Where it landed |
|---|---|---|---|---|
| 2026-09-11 | the first message Wobo ever delivered (plain text, one paragraph, no image, no link, no tracking) | `Wobo <hello@mail.heywobo.com>`, reply-to `support@heywobo.com` | a Gmail-hosted inbox | **Primary** |

The send id was `6f83f8fa-d869-4f09-b1b0-5f5df1d90d75`. One landing is not a placement rate, and a
message from an unknown sender to an inbox that has never seen it is the hardest case we will face,
so this is the right first test and the wrong thing to generalise from. What it does establish:

- The identity is sound end to end. `mail.heywobo.com` verified in Resend with DKIM, SPF and the
  bounce MX; open tracking and click tracking are both **off** on the domain, which the law requires
  and which we can now see rather than assume.
- The shape the law asks for reaches Primary on its first attempt with no reputation at all: plain
  text, one paragraph, no image, no link, no tracking pixel, a real reply-to, and a subject that is
  a fact rather than a pitch.

What to measure next, in this table, as each is sent for the first time: a message with the orb
image, one with a deep link, the Sunday note to a parent, and the launch mail. Each is a different
shape and each earns its own row. A kind that lands outside Primary gets its row and its diagnosis
here, not a rewrite of the theory above.

## Watching where we land (the owner, 2026-09-16)

The owner: *"we need to keep a track if we went to spam or not"*, and on what happens then: *"be
tactical, dont slow down, and change whats necessary but make sure i get alerted at
shreyan@doteventures.com"*.

What is watched: the provider's delivery events (bounced, complained, delayed), received on a signed
route; a daily placement check that sends one real mail per Primary-relevant kind to inboxes we own on
Gmail, Outlook, Yahoo and Apple Mail and reads which folder it landed in; Google Postmaster Tools'
domain reputation and user-reported spam rate, per Feedback-ID kind.

What happens, without slowing anyone down: the cadence is never lowered across the board. The response
is aimed at the cause. An address that complains or hard-bounces is suppressed at once. A kind whose
complaint rate crosses 0.10 percent is paused on its own while every other kind carries on; at 0.30
percent (Gmail's cliff) every kind that crossed it pauses. Sign-in codes and receipts are never paused.
An authentication failure or a seed landing in spam raises an alert naming the cause.

Who hears: every such event mails shreyan@doteventures.com (`DELIVERABILITY_ALERT_TO`), writes the
alerts line and shows on the mail desk, because an alert about mail must not depend on mail alone.
One bad hour is one alert, not a hundred.

What never happens automatically: the sender name or address changing. The section above settles one
sender for three reasons, and a sender that hops after landing in spam is the pattern filters are built
to catch across the whole of heywobo.com. A sender change remains a single setting (`EMAIL_FROM`) that
the owner makes by hand once the cause is fixed.

## What the global senders do, adopted (the owner, 2026-09-16)

The owner: *"how do all the global brands tackle these issues, we shall do the same"*. What large
consumer senders converge on, and where each lands here:

- **Authentication and one-click unsubscribe** (Gmail and Yahoo's bulk-sender rules, 2024): SPF, DKIM,
  DMARC, RFC 8058 unsubscribe honoured promptly, user-reported spam under 0.30 percent. Already the spec
  above.
- **Send when the person usually shows up.** Already the hours law.
- **Stop reminding someone the reminders are not reaching.** Duolingo's reminders stop after several
  days without a response. Here: the taper in docs/EMAILS-AND-ANIMATIONS.md.
- **A sunset policy.** Large senders stop mailing people who have not engaged for months, because
  mail to the long-gone is what drags a domain toward spam. Here: after a long absence a learner steps
  down to one encouraging note a month, then mail stops until they return. Both spells are console
  dials (defaults 30 and 120 days), and returning restores the full cadence at once. Wave 56.
- **Separate streams, set up once.** Transactional mail (sign-in codes, receipts) goes from its own
  sending subdomain, so a bad week for learning notes never stops a family signing in or getting a
  receipt. This revises "one sender" above for the transactional stream only: learning notes keep one
  sender forever, and the display name is "Wobo" on both. It is set up once and warmed, never switched
  in response to spam. The code reads `EMAIL_FROM_TRANSACTIONAL` and falls back to today's sender until
  the owner's DNS exists. Wave 56.
- **Watch placement continuously.** Postmaster Tools, feedback loops and seed inboxes. The section
  above, wave 56.
- **Put daily reminders on push, and richer mail on email.** The large learning apps nudge daily
  through app notifications and keep email for progress and encouragement, which keeps email volume
  and complaints down. This arrives with the store apps.
- **The brand's logo in the inbox (BIMI).** Needs DMARC at enforcement and usually a registered
  trademark, so it follows the trademark filing.
- **Learn which message works.** Duolingo publishes a bandit method that rotates reminder wording and
  avoids repeating what was just sent. Here, if built, it learns from aggregate results across all
  learners, never from one child's profile (DPDP s.9(3)). Later, not wave 56.
