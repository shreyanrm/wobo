# Accessibility statement

Draft of 3 September 2026. Version 0.1. Written by the Wobo team, not yet reviewed by a lawyer, and not yet audited by an accessibility specialist. See `README.md` in this folder for the review checklist.

> **In plain words**
>
> We want Wobo to work for everyone: with a keyboard, with a screen reader, with motion turned down, with large text, on a small phone, and with a stylus.
>
> Some of it does that well today. Some of it does not yet, and we would rather name the gaps than claim we are finished.
>
> If something in Wobo is in your way, tell us at support@heywobo.com and we will fix it, and give you a way through in the meantime.

---

## 1. What we are aiming for

We are building Wobo to meet the Web Content Accessibility Guidelines version 2.2 at level AA. We have not yet been independently audited against them, so this is a statement of intent and of current state, not a claim of conformance. When the audit is done, this document will say what it found. [REVIEW: WCAG version and level to commit to; whether a formal conformance claim, an accessibility conformance report, or an EU accessibility statement in the prescribed format is required.]

Legal frameworks that may apply to us: the European Accessibility Act and the harmonised standard EN 301 549; the Equality Act 2010 in the UK; the Americans with Disabilities Act and, for public-sector customers, Section 508 in the United States; the Rights of Persons with Disabilities Act 2016 and the guidelines for Indian government websites. [REVIEW: which of these bind us given where we sell, and the deadlines under the European Accessibility Act.]

## 2. What we are aiming to be able to say

**None of the list below has been measured, and three items in it are known to be wrong today.** It is written here as the target, not as a description, and it stays in the future tense until each line has a test behind it. What is known to be wrong, as of 4 September 2026: the main call to action does not meet the contrast ratio in the dark theme on nine pages; the focus ring on the public site is well under the required ratio in the light theme; and the board announces several of the objects it draws as nothing at all, which matters more here than anywhere because drawing is the product. Those three are being worked on, and this section is rewritten line by line as each one is measured rather than all at once.

**The target**

- **Keyboard.** Every control can be reached and used with a keyboard, with a visible focus ring, and a skip link to the main content.
- **Screen readers.** Interactive elements carry names, roles and states. Wobo's speech is also available as text.
- **Reduced motion.** Setting reduced motion on your device turns off the drawing animation, the character's idle movement and the transitions. Wobo still teaches; the board simply appears rather than being drawn.
- **Text and zoom.** The interface reflows to 400 per cent zoom and respects the text size set on your device.
- **Contrast.** Text and meaningful interface elements are checked against the 4.5 to 1 and 3 to 1 ratios in both the light and the dark theme.
- **Colour is never the only signal.** Right and wrong are shown by a mark, a shape and words, not by red and green alone.
- **Voice is optional.** Nothing needs a microphone, and nothing needs sound. Every spoken explanation exists as text.
- **Touch targets** are at least 44 by 44 pixels, and the layout is composed for a phone in portrait, a tablet in either orientation, a laptop and a large monitor.
- **Timing.** Nothing in a lesson is timed against you, and no answer expires.

[REVIEW: no line above may move into the present tense without an automated test or a recorded manual test behind it, named here with its date. There is no automated accessibility scan of any kind in the build today, which is the first thing to fix, because a statement like this one is only as good as the thing that stops it drifting.]

## 3. Where we are not there yet

We would rather list these than let you discover them.

- **The board.** Wobo's central idea is drawing, and a drawing is hard to convey without sight. Every board carries a text description of what was drawn and what it means, and Wobo narrates as the ink appears. That is not the same as seeing it, and for some diagrams the description is thinner than it should be. This is our largest gap and our largest area of work. [REVIEW: whether describing a board in text meets WCAG 2.2 success criterion 1.1.1 for non-text content and 1.4.5 for images of text, whether the board counts as a live region needing 4.1.3 status messages, and whether a product whose central mechanism is visual can claim level AA at all without an equivalent non-visual path.]
- **Drawing your own answer.** Some practice items ask you to draw a line, shade a region, or place a point. Each of those has a keyboard and screen-reader path, and some of those paths are more awkward than the pointer version. Where an item cannot be answered without drawing, you can ask Wobo for a different way to answer the same question.
- **Handwriting recognition** works less well with some handwriting than others, and it is not a fair way to assess anyone. It is never the only route to an answer.
- **Simulations.** Some of the older interactive simulations predate this standard and are being rebuilt. Until they are, Wobo can explain and operate them for you on request.
- **Language.** Wobo teaches in English today, with more languages planned. Curriculum names appear in their original language alongside an English rendering.
- **Captions.** Where Wobo plays a short animated explanation, captions are not yet available, and neither is audio description. Wobo's spoken explanations do exist as text, which covers most of what a learner hears, but the animated explanations do not carry captions today. [REVIEW: whether the animated explanations are prerecorded media under WCAG 2.2, which would bring 1.2.2 captions and 1.2.5 audio description into scope, or synchronised generated speech, which may not be.]
- **High contrast.** There is a high-contrast switch in settings and it does not yet reach every surface, for the reason in section 4. There is a light theme and a dark theme, neither of them yet measured against the ratios in section 2, and the contrast, inversion and colour-filter settings on your own device apply on top of them.

## 4. Things you can turn on

In settings: appearance, light, dark or follow the device; reduce motion, on or off; larger text, on or off; high contrast, on or off; and whether Wobo speaks replies out loud.

**High contrast is a switch that does less than its name promises.** It is there, it turns on, and it does not currently reach the colour tokens the app paints most of its surfaces with, so parts of the screen do not change. That is a defect and not a design, and it is named here rather than in the list of things we are proud of.

Not in settings, and described in an earlier draft of this document as though they were: a text-size slider with steps, a sound-effects switch separate from the voice, a narration switch separate from the voice, a drawing-speed control for the board, and a proactivity dial. None of the five is built.

## 5. Assistive technology we test with

We test with [screen readers], [browsers] and [operating systems], on a phone, a tablet and a desktop. [REVIEW: name the actual test matrix once it exists, and state the date of the most recent test.]

## 6. Tell us

Write to support@heywobo.com. Tell us what you were trying to do, what got in the way, and what you use. We will reply, tell you what we are going to do, and give you a way to get the thing done in the meantime. [REVIEW: an earlier draft promised a reply within five working days. Nobody is rostered to meet that and there is no ticketing system to measure it, so it has been removed rather than left standing. Put a number back only when someone is answerable for it.]

If our answer is not good enough, you can escalate to [named person or role] at support@heywobo.com, and, where you have one, to the enforcement body in your country. [REVIEW: name the enforcement route per jurisdiction, which the EU accessibility statement format requires.]

## 7. How this document is kept honest

This statement is reviewed whenever a surface changes materially, and at least every six months. It records what we have tested, not what we hope. Prepared on 3 September 2026, based on a self-assessment. Last tested: [date]. Next review: [date]. [REVIEW: the EU statement format prescribes the preparation method, the date, and the feedback mechanism.]
