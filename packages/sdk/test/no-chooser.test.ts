/**
 * THE SDK OFFERS NO NETWORK CHOOSER (docs/LEARNING-MODEL.md, "Who chooses", 2026-09-16).
 *
 * The group that teaches a topic is chosen on the device, by `groupFor`, out of the pool
 * `blueprint()` fetches once per cell per session. The gateway's `curriculum.climb` is retired:
 * every call to it drew on the learner's day of turns and was refused on a spent day, and nothing
 * called it. An SDK method pointing at a retired door would let a screen pick the metered chooser
 * by mistake, so the SDK carries neither the name nor the method.
 */

import { describe, expect, test } from 'bun:test';
import { CURRICULUM_CAPABILITIES, createCurriculumClient } from '../src/curriculum';

describe('the curriculum client has no door that chooses a module', () => {
  test('the retired capability name is not in the list the client routes on', () => {
    expect(Object.values(CURRICULUM_CAPABILITIES)).not.toContain('curriculum.climb');
    expect(Object.keys(CURRICULUM_CAPABILITIES)).not.toContain('climb');
  });

  test('the client a screen holds has no climb method, and reading a pool is the one read', async () => {
    const calls: string[] = [];
    const client = createCurriculumClient('https://brain.test', {
      post: async (capability: string) => {
        calls.push(capability);
        return { blueprint: null, held: 0 };
      },
    });
    expect('climb' in client).toBe(false);

    await client.blueprint({
      node: 'cbse-8-science-force-and-pressure',
      chapter: 'Force and Pressure',
      board: 'CBSE',
      grade: '8',
      subject: 'Science',
      contentVersion: '2026-27',
      topics: [{ id: 't4', name: 'Pressure' }],
    });
    expect(calls).toEqual(['curriculum.blueprint']);
  });
});
