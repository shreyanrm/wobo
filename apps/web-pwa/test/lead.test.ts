/**
 * THE PARAGRAPHS A SEARCH RESULT IS WRITTEN FROM.
 *
 * The rule used to be a CSS selector inside `page.evaluate`, which no test could read, and it was
 * wrong: it silenced the bare tags `header` and `footer`, and every growth page opens with
 * `<header class="gw-head">` holding the heading and the page's own lead. So the one paragraph
 * written to describe the page was skipped and the description fell through to the standing line
 * the whole family shares. `/exams/cbse`, `/exams/icse`, `/exams/isc` and `/exams/nios` shipped one
 * description between them, as did the four `/compare` pages, and the build failed on it.
 */

import { describe, expect, it } from 'bun:test';
import { leadParagraphs } from '../scripts/lead';

/** The shape every growth page emits: site chrome outside `<main>`, the lead inside a `<header>`. */
const PAGE = `
<header class="st-header st-print-hide"><div class="st-inner">
  <a href="/">Wobo</a>
  <nav aria-label="Wobo's public pages"><a href="/plans">Plans, and what each one buys you</a></nav>
</div></header>
<main id="site-main">
  <div class="st-wrap">
    <nav class="st-crumb" aria-label="Where this sits"><a href="/exams">The syllabus, from the board</a><b>/</b><b>CBSE</b></nav>
    <header class="gw-head">
      <span class="wk-label">Central Board of Secondary Education</span>
      <h1>CBSE: the syllabus we hold, and where every line came from</h1>
      <p class="gw-lead">We hold 23 syllabuses for CBSE, edition 2026-27, read off 23 official documents.</p>
    </header>
    <p class="gw-standing">Everything here is the board's own document, and we do not summarise a circular.</p>
  </div>
</main>
<footer class="st-footer st-print-hide"><p>Wobo is made by Dot eVentures Pvt Ltd in Hyderabad, India.</p></footer>
`;

describe('the opening words of a page', () => {
  it('takes the lead a page writes inside its own <header>, which is where every growth page puts it', () => {
    expect(leadParagraphs(PAGE)[0]).toBe(
      'We hold 23 syllabuses for CBSE, edition 2026-27, read off 23 official documents.',
    );
  });

  it('says the page in the order the page says it', () => {
    expect(leadParagraphs(PAGE)).toEqual([
      'We hold 23 syllabuses for CBSE, edition 2026-27, read off 23 official documents.',
      "Everything here is the board's own document, and we do not summarise a circular.",
    ]);
  });

  it('leaves out the site chrome, which is the same on all 605 pages', () => {
    const all = leadParagraphs(PAGE).join(' ');
    expect(all).not.toContain('Dot eVentures');
    expect(all).not.toContain('Plans, and what each one buys you');
  });

  it('leaves out the draft notice, which describes a document rather than saying it', () => {
    const legal = `<main><p class="st-note">Draft. Drafted 3 September 2026 by the Wobo team, and it is not advice.</p>
      <p>Wobo stores a few things in your browser or on your device, and this page says which.</p></main>`;
    expect(leadParagraphs(legal)).toEqual([
      'Wobo stores a few things in your browser or on your device, and this page says which.',
    ]);
  });

  it('skips a label that names a card rather than saying anything', () => {
    const card = `<main><p>In plain words: this is the label the card wears, not the card.</p>
      <p>The rest of this page is what the card actually says to a reader.</p></main>`;
    expect(leadParagraphs(card)).toEqual([
      'The rest of this page is what the card actually says to a reader.',
    ]);
  });

  it('silences the shell by tag when a page renders no <main> to scope to', () => {
    const bare = `<header><p>Sign in, or start free today, on every page of the site.</p></header>
      <p>The doors do not wear the site shell, so the chrome has to be named by tag.</p>`;
    expect(leadParagraphs(bare)).toEqual([
      'The doors do not wear the site shell, so the chrome has to be named by tag.',
    ]);
  });

  it('reads no words out of a script or a style block', () => {
    const noisy = `<main><script>const p = "this is a string of code, not a paragraph of prose";</script>
      <p>Only the prose on the page can describe the page in a search result.</p></main>`;
    expect(leadParagraphs(noisy)).toEqual([
      'Only the prose on the page can describe the page in a search result.',
    ]);
  });
});
