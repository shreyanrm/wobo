import { describe, expect, it } from 'bun:test';
import type { MasteryBand } from '@wobo/contracts';
import { bandRank, chooseNextNode, isAtFloor, MASTERY_FLOOR } from '../src/reference/chooser';

const node = (id: string, sequence: number, prerequisite_ids: string[] = []) => ({
  node_id: id,
  sequence,
  prerequisite_ids,
});

const CHAIN = [node('a', 1), node('b', 2, ['a']), node('c', 3, ['b'])];

describe('the ordering law', () => {
  it('puts the floor at secure, and reads a band against it', () => {
    expect(MASTERY_FLOOR).toBe('secure');
    expect(isAtFloor('developing')).toBe(false);
    expect(isAtFloor('secure')).toBe(true);
    expect(isAtFloor('independent')).toBe(true);
    expect(bandRank('not_started')).toBe(0);
    expect(bandRank(undefined)).toBe(0);
  });

  it('starts at the first node whose prerequisites are satisfied', () => {
    expect(chooseNextNode(CHAIN, () => 'not_started')?.node_id).toBe('a');
  });

  it('does not walk past a node still below the floor', () => {
    // `a` is secure, `b` was answered badly. `c` is untouched and sits after both.
    const bands: Record<string, MasteryBand> = { a: 'secure', b: 'emerging' };
    expect(chooseNextNode(CHAIN, (id) => bands[id])?.node_id).toBe('b');
  });

  it('takes the weakest unmastered node first, not the earliest', () => {
    // Both are begun and both are owed; `c` is further from the floor, so it is the one taught.
    const bands: Record<string, MasteryBand> = { a: 'secure', b: 'developing', c: 'emerging' };
    const flat = [node('a', 1), node('b', 2), node('c', 3)];
    expect(chooseNextNode(flat, (id) => bands[id])?.node_id).toBe('c');
  });

  it('prefers a topic already begun over an untouched one, however weak the untouched one looks', () => {
    // `b` is emerging (rank 1) and `c` is not_started (rank 0). Raw weakness would pick `c`; the
    // law picks `b`, because "keep teaching them until they master it" beats starting something new.
    const bands: Record<string, MasteryBand> = { a: 'secure', b: 'emerging', c: 'not_started' };
    const flat = [node('a', 1), node('b', 2), node('c', 3)];
    expect(chooseNextNode(flat, (id) => bands[id])?.node_id).toBe('b');
  });

  it('falls back to the blocked debt rather than answering nothing', () => {
    // Every below-floor node is blocked by a prerequisite outside the set. The learner still gets
    // a next step: the weakest of them.
    const orphan = [node('x', 1, ['missing']), node('y', 2, ['missing'])];
    const bands: Record<string, MasteryBand> = { x: 'developing', y: 'emerging' };
    expect(chooseNextNode(orphan, (id) => bands[id])?.node_id).toBe('y');
  });

  it('deepens when everything is learnt, and answers nothing only when everything is independent', () => {
    expect(chooseNextNode(CHAIN, () => 'secure')?.node_id).toBe('a');
    expect(chooseNextNode(CHAIN, () => 'independent')).toBeNull();
    expect(chooseNextNode([], () => 'not_started')).toBeNull();
  });

  it('breaks ties on sequence, not on the order the nodes were handed over', () => {
    const shuffled = [node('c', 3), node('a', 1), node('b', 2)];
    expect(chooseNextNode(shuffled, () => 'not_started')?.node_id).toBe('a');
  });
});
