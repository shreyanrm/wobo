/**
 * The forge composes from a REAL board's subjects. `isComputable` used to compare a chapter's
 * `subjectId` to the literal 'math', which only the bundled catalog (deleted in wave 6) ever used
 * as an id; a board names its subject "Mathematics", so every forge bound from a real syllabus
 * composed to nothing (seen in a browser: "a forged workbook · 0 pages", "0 items"). The family
 * behind the name decides now, the same way the Learn screen already asks it.
 */

import { describe, expect, it } from 'bun:test';
import { computableSubject } from './pools';

describe('which subjects the forge can generate real problems for', () => {
  it('reads the family behind the name a board gives its subject', () => {
    expect(computableSubject('Mathematics')).toBe(true);
    expect(computableSubject('Maths')).toBe(true);
    expect(computableSubject('math')).toBe(true);
  });

  it('does not generate equations for a subject that is not maths', () => {
    expect(computableSubject('Science')).toBe(false);
    expect(computableSubject('Social Science')).toBe(false);
    expect(computableSubject('English')).toBe(false);
  });
});
