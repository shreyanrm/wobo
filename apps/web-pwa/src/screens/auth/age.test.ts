import { describe, expect, it } from 'bun:test';
import {
  ACCOUNT_AGE,
  ageOn,
  bandFor,
  blockedBy,
  CONSENT_AGE,
  consentBranch,
  looksLikeEmail,
  type SignUpFields,
} from './age';

const NOW = new Date(2026, 8, 3);
const born = (y: number, m: number, d: number) => new Date(y, m, d).toISOString().slice(0, 10);

describe('working out how old somebody is', () => {
  it('counts whole years, and does not round a birthday up', () => {
    expect(ageOn(born(2013, 8, 3), NOW)).toBe(13);
    // one day short of the thirteenth birthday is still twelve
    expect(ageOn(born(2013, 8, 4), NOW)).toBe(12);
    expect(ageOn(born(2008, 0, 1), NOW)).toBe(18);
  });

  it('refuses a date that cannot be a birthday', () => {
    expect(ageOn('', NOW)).toBeNull();
    expect(ageOn('the third', NOW)).toBeNull();
    expect(ageOn(born(2030, 0, 1), NOW)).toBeNull(); // the future
    expect(ageOn(born(1850, 0, 1), NOW)).toBeNull(); // a typed year, not a life
  });
});

describe('the two lines the law draws', () => {
  it('puts the account in a parent’s hands below thirteen', () => {
    expect(bandFor(ACCOUNT_AGE - 1)).toBe('child');
    expect(consentBranch(ACCOUNT_AGE - 1).holder).toBe('parent');
    expect(consentBranch(ACCOUNT_AGE - 1).parentRequired).toBe(true);
  });

  it('gives a teenager the account, and still asks a parent about the optional features', () => {
    expect(bandFor(ACCOUNT_AGE)).toBe('teen');
    expect(bandFor(CONSENT_AGE - 1)).toBe('teen');
    const teen = consentBranch(15);
    expect(teen.holder).toBe('learner');
    expect(teen.parentRequired).toBe(false);
    expect(teen.parentOffered).toBe(true);
  });

  it('asks an adult nobody', () => {
    const adult = consentBranch(CONSENT_AGE);
    expect(adult.band).toBe('adult');
    expect(adult.parentRequired).toBe(false);
    expect(adult.parentOffered).toBe(false);
  });

  it('never gates the teaching itself on consent', () => {
    // parental-consent.md, in plain words: "Your child can learn either way."
    for (const age of [5, 12, 13, 17, 18, 40]) {
      const branch = consentBranch(age);
      expect(branch.notice).not.toMatch(/cannot learn|no lessons|blocked/i);
    }
    expect(consentBranch(10).notice).toContain('parent');
  });
});

describe('what still stands in the way of an account', () => {
  const fields = (over: Partial<SignUpFields> = {}): SignUpFields => ({
    birth: born(2005, 0, 1),
    parentContact: '',
    agreed: true,
    ...over,
  });

  it('asks for the date of birth first', () => {
    expect(blockedBy(fields({ birth: '' }), NOW)).toBe('birth');
    expect(blockedBy(fields({ birth: 'nonsense' }), NOW)).toBe('birth-invalid');
  });

  it('will not let a child past without a parent’s own contact', () => {
    const child = fields({ birth: born(2018, 0, 1) });
    expect(blockedBy(child, NOW)).toBe('parent-contact');
    expect(blockedBy({ ...child, parentContact: 'not an address' }, NOW)).toBe('parent-contact');
    expect(blockedBy({ ...child, parentContact: 'parent@example.com' }, NOW)).toBeNull();
  });

  /**
   * THE SHAPE OF THAT CONTACT IS THE SCREEN'S TO DECIDE, because only the screen knows which seam
   * is wired. No shipped build has ever had an email seam, so a gate that could only accept an
   * address was a gate no child could ever pass: `parental-consent.md` §2 names a message to the
   * parent's "email address or phone number", and the door asks for whichever one it can send to.
   */
  it('takes whatever contact the build can actually reach a parent by', () => {
    const child = fields({ birth: born(2018, 0, 1), parentContact: '+91 98765 43210' });
    const byPhone = (v: string) => /^\+\d[\d\s-]{6,}$/.test(v.trim());
    expect(blockedBy(child, NOW)).toBe('parent-contact');
    expect(blockedBy(child, NOW, byPhone)).toBeNull();
  });

  it('does not hold a teenager up for a parent’s address', () => {
    expect(blockedBy(fields({ birth: born(2011, 0, 1) }), NOW)).toBeNull();
  });

  it('never treats an unticked box as agreement', () => {
    expect(blockedBy(fields({ agreed: false }), NOW)).toBe('agree');
  });

  it('reports one thing at a time, in the order the learner meets it', () => {
    const nothing: SignUpFields = { birth: '', parentContact: '', agreed: false };
    expect(blockedBy(nothing, NOW)).toBe('birth');
  });
});

describe('the shape of an address', () => {
  it('accepts what an address looks like', () => {
    expect(looksLikeEmail('a@b.co')).toBe(true);
    expect(looksLikeEmail('  parent@example.com  ')).toBe(true);
  });

  it('refuses what plainly is not one', () => {
    expect(looksLikeEmail('')).toBe(false);
    expect(looksLikeEmail('parent')).toBe(false);
    expect(looksLikeEmail('parent@example')).toBe(false);
    expect(looksLikeEmail('a b@example.com')).toBe(false);
  });
});
