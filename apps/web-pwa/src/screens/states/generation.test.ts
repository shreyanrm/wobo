import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WAIT_GAME_AT_MS, WAIT_SCENE_AT_MS, waitLength } from '@wobo/wobo';
import { isLongWait, LONG_WAIT_MS } from './generation';

describe('when a wait is worth the whole screen', () => {
  it('leaves a short wait to the toast in the corner', () => {
    expect(isLongWait(1_000, 1_000)).toBe(false);
    expect(isLongWait(1_000, 1_000 + LONG_WAIT_MS - 1)).toBe(false);
  });

  it('fills the screen once the learner has really been left waiting', () => {
    expect(isLongWait(1_000, 1_000 + LONG_WAIT_MS)).toBe(true);
    expect(isLongWait(1_000, 40_000)).toBe(true);
  });
});

describe('what a wait is owed, by its length', () => {
  it('is the one law from docs/THE-WAIT.md, read from the library rather than restated here', () => {
    expect(waitLength(WAIT_SCENE_AT_MS - 1)).toBe('breath');
    expect(waitLength(WAIT_SCENE_AT_MS)).toBe('scene');
    expect(waitLength(WAIT_GAME_AT_MS)).toBe('game');
  });

  it('puts a real compose — thirty to forty-five seconds — past the point a scene alone covers', () => {
    expect(waitLength(35_000)).toBe('game');
  });
});

describe('the words a wait used to say', () => {
  it('are not here any more, and nothing in words replaced them', () => {
    const source = readFileSync(join(import.meta.dir, 'generation.ts'), 'utf8')
      // the file's own note about what it lost is the one place those words may still appear
      .replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const gone of [
      'COMPOSE_STAGES',
      'composeStage',
      'LOADING_LINES',
      'loadingLine',
      'Writing the lesson',
      'Almost ready',
      'sharpening the pencil',
    ]) {
      expect(source).not.toContain(gone);
    }
  });
});
