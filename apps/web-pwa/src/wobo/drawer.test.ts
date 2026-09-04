import { afterEach, describe, expect, it } from 'bun:test';
import { openCompanion, resetCompanionOpen, subscribeCompanionOpen } from './drawer';

/**
 * The re-teach ladder asks Wobo for a second explanation on the learner's behalf, and the answer
 * lands in Wobo's drawer. The drawer had exactly one opener: a tap on the orb. So on the workbook
 * the child read "let me show this a different way: I will work one all the way through", the same
 * three items stayed on screen, and the worked example sat in a closed panel they had no reason to
 * open. Six of the seven rungs landed there. This is the second opener.
 */

afterEach(resetCompanionOpen);

describe('the drawer opens when something is put in it for the learner', () => {
  it('tells every listener what arrived and why', () => {
    const heard: string[] = [];
    subscribeCompanionOpen((r) => heard.push(`${r.reason}:${r.ask ?? ''}`));
    openCompanion({ reason: 'reteach', ask: 'work one all the way through' });
    expect(heard).toEqual(['reteach:work one all the way through']);
  });

  it('stops telling a listener that has gone', () => {
    const heard: string[] = [];
    const stop = subscribeCompanionOpen(() => heard.push('x'));
    openCompanion({ reason: 'reteach' });
    stop();
    openCompanion({ reason: 'reteach' });
    expect(heard).toHaveLength(1);
  });

  it('one surface refusing to open never stops another, and never throws at the lesson', () => {
    const heard: string[] = [];
    subscribeCompanionOpen(() => {
      throw new Error('this surface is unmounting');
    });
    subscribeCompanionOpen(() => heard.push('opened'));
    expect(() => openCompanion({ reason: 'reteach' })).not.toThrow();
    expect(heard).toEqual(['opened']);
  });

  it('holds no state: a surface that mounts afterwards is not popped open at random', () => {
    openCompanion({ reason: 'reteach' });
    const heard: string[] = [];
    subscribeCompanionOpen(() => heard.push('opened'));
    expect(heard).toEqual([]);
  });
});
