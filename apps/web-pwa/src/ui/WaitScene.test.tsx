/**
 * The waiting scene, as a screen reader and a page meet it.
 *
 * There is no browser in this suite, so the scene is rendered to static markup and read as markup.
 * That covers the two laws this component owns and the pure module cannot: the scene puts the marks
 * of its own frame on the page, once each, and it NEVER NARRATES — a waiting screen has no text in
 * it at all, no percentage, and nothing that says what Wobo is doing.
 */

import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { WAIT_SCENE_NAMES, WaitScene, type WaitSceneName, waitFrame } from '@wobo/wobo';

const names = WAIT_SCENE_NAMES as readonly WaitSceneName[];

/**
 * Every run of text a person would READ on the page: markup removed, and with it the parts of the
 * rig that are not on screen - Wobo's sleeping z's, which every rig carries and only a sleeping
 * Wobo ever shows.
 */
function visibleText(html: string): string {
  return html
    .replace(/<g[^>]*display:none[^>]*>[\s\S]*?<\/g>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('a waiting scene says nothing', () => {
  it('renders no text at all, for any subject', () => {
    for (const subject of ['math', 'physics', 'chemistry', 'biology', 'cs', 'social', 'doubt']) {
      expect(visibleText(renderToStaticMarkup(<WaitScene subject={subject} />))).toBe('');
    }
  });

  it('carries no percentage and no word about what is happening', () => {
    const html = renderToStaticMarkup(<WaitScene subject="physics" />);
    expect(visibleText(html)).not.toMatch(/\d\s?%/);
    expect(visibleText(html)).not.toMatch(/loading|generating|composing|rendering|please wait/i);
  });

  it('tells assistive tech it is busy without describing the software', () => {
    const html = renderToStaticMarkup(<WaitScene subject="math" label="Wobo" />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Wobo"');
  });
});

describe('a waiting scene draws its own frame', () => {
  it('puts one element on the page for every mark of the scene', () => {
    for (const name of names) {
      const html = renderToStaticMarkup(<WaitScene scene={name} orb={false} />);
      const drawn = (html.match(/<(line|circle|rect|path)\b/g) ?? []).length;
      expect(drawn).toBe(waitFrame(name, 0).length);
    }
  });

  it('draws the subject’s own pigment where a scene asks for pigment, and Wobo’s ink elsewhere', () => {
    const html = renderToStaticMarkup(
      <WaitScene subject="physics" pigment="var(--violet)" orb={false} />,
    );
    expect(html).toContain('var(--violet)');
    expect(html).toContain('var(--wr-body)');
  });

  it('is themed by the rig’s own tokens rather than by a colour of its own', () => {
    const html = renderToStaticMarkup(<WaitScene subject="biology" orb={false} />);
    expect(html).toContain('wobo-rig');
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });
});
