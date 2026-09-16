/**
 * The mail desk (wave 56, the deliverability watch), held to the rules every desk is held to.
 *
 *   1. "We could not ask" is never "nothing is wrong". A failed read is an absence that says so; an
 *      unreadable watch shows no rate at all; a check nobody configured says "not configured" and
 *      names what would configure it.
 *   2. Every number is the server's, set against the two lines the law draws: 0.10 percent pauses a
 *      kind, 0.30 percent is Gmail's cliff.
 *   3. Suppressed addresses are a count. Nothing on this desk can carry an address or a digest,
 *      because the type has no field for one.
 *   4. The one control lifts a pause, and it is offered only for a kind that is paused.
 */

import { describe, expect, it } from 'bun:test';
import { ENDPOINT } from './contract';
import { DESKS, desk } from './desks';
import {
  isMailDesk,
  type MailDesk,
  mailPanels,
  pausedKinds,
  placementTone,
  rateWords,
} from './mail';

const AT = '2026-09-16T09:00:00.000Z';

function reading(over: Partial<MailDesk> = {}): MailDesk {
  return {
    at: AT,
    readable: true,
    thresholds: { pause: 0.001, cliff: 0.003, window_days: 7, min_complaints: 2 },
    complaints: {
      overall: {
        delivered: 1000,
        complained: 2,
        rate: 0.002,
        hard_bounces: 1,
        soft_bounces: 0,
        delayed: 3,
        state: 'over_pause',
      },
      kinds: [
        {
          kind: 'learning_note',
          delivered: 800,
          complained: 2,
          rate: 0.0025,
          state: 'over_pause',
          paused: true,
        },
        { kind: 'quick_one', delivered: 200, complained: 0, rate: 0, state: 'ok', paused: false },
      ],
    },
    bounces: { hard: 1, soft: 0, delayed: 3, suppressed_by_provider: 0, failed: 0 },
    days: [{ day: '2026-09-16', kind: 'learning_note', event: 'delivered', count: 800 }],
    suppressed: { count: 3 },
    paused: [
      {
        kind: 'learning_note',
        since: '2026-09-16T08:00:00+00:00',
        reason: 'complaint_rate',
        source: 'provider',
        rate: 0.0025,
        threshold: 0.001,
      },
    ],
    never_paused: ['account_created', 'mail_alert', 'plan_opened', 'verify_email'],
    placement: {
      configured: false,
      live: false,
      providers: [
        { provider: 'gmail', configured: false },
        { provider: 'outlook', configured: false },
        { provider: 'yahoo', configured: false },
        { provider: 'apple', configured: false },
      ],
      kinds: ['welcome', 'quick_one'],
      send_hour: 16,
      zone: 'Asia/Kolkata',
      results: [],
    },
    postmaster: { configured: false, reading: null, note: 'v2 has no reputation grade.' },
    webhook: { configured: true, path: '/v1/mail/events', last_event_at: AT },
    alerts: [
      {
        at: AT,
        cause: 'complaint_rate',
        kind: 'learning_note',
        severity: 'warn',
        message: 'Complaints on learning_note reached 0.25 percent.',
        action: 'Paused learning_note only.',
        mailed: true,
      },
    ],
    alert_to_set: false,
    streams: {
      learning: 'Wobo <hello@mail.heywobo.com>',
      transactional: 'Wobo <hello@mail.heywobo.com>',
      separate: false,
      variable: 'EMAIL_FROM_TRANSACTIONAL',
    },
    ...over,
  };
}

function panel(desk_: MailDesk | null, id: string) {
  return mailPanels(desk_, AT).find((p) => p.id === id);
}

describe('the desk is on the console, and so are its two routes', () => {
  it('is a live desk with a source an engineer can chase', () => {
    const found = desk('mail');
    expect(found.supply.kind).toBe('live');
    expect(DESKS.map((d) => d.id)).toContain('mail');
    if (found.supply.kind === 'live') expect(found.supply.from).toContain('ops.mail_watch');
  });

  it('reads the desk and lifts a pause on the gateway’s own paths', () => {
    expect(ENDPOINT.mail).toBe('/v1/admin/mail');
    expect(ENDPOINT.mailUnpause).toBe('/v1/admin/mail/unpause');
  });
});

describe('the shape is checked before a number is shown', () => {
  it('takes the gateway’s answer, and the answer to a lifted pause', () => {
    expect(isMailDesk(reading())).toBe(true);
    expect(isMailDesk({ ...reading(), saved: true })).toBe(true);
  });

  it('refuses nonsense', () => {
    expect(isMailDesk(null)).toBe(false);
    expect(isMailDesk([])).toBe(false);
    expect(isMailDesk({ ...reading(), suppressed: { count: -1 } })).toBe(false);
    expect(isMailDesk({ ...reading(), readable: 'yes' })).toBe(false);
    const broken = reading();
    expect(
      isMailDesk({
        ...broken,
        complaints: { ...broken.complaints, kinds: [{ kind: 'x', state: 'fine' }] },
      }),
    ).toBe(false);
  });
});

describe('could not ask is not nothing wrong', () => {
  it('a failed read is an absence with no figure', () => {
    const panels = mailPanels(null, AT);
    expect(panels).toHaveLength(1);
    expect(panels[0]?.kind).toBe('absent');
  });

  it('an unreadable watch shows no rate and says why', () => {
    const panels = mailPanels(reading({ readable: false }), AT);
    expect(panels.find((p) => p.id === 'mail-complaints')).toBeUndefined();
    expect(panels.find((p) => p.id === 'mail-unreadable')?.kind).toBe('absent');
  });

  it('a check nobody configured says so and names what would configure it', () => {
    const seeds = panel(reading(), 'mail-placement');
    expect(seeds?.kind).toBe('absent');
    if (seeds?.kind === 'absent') {
      expect(seeds.because).toContain('not configured');
      expect(seeds.wouldFill).toContain('MAIL_SEED_GMAIL_ADDRESS');
    }
    const google = panel(reading(), 'mail-postmaster');
    expect(google?.kind).toBe('absent');
    if (google?.kind === 'absent') {
      expect(google.because).toContain('not configured');
      expect(google.wouldFill).toContain('POSTMASTER_REFRESH_TOKEN');
    }
    const hook = panel(
      reading({ webhook: { configured: false, path: '/v1/mail/events', last_event_at: null } }),
      'mail-webhook',
    );
    expect(hook?.kind === 'figure' && hook.value).toBe('not configured');
    expect(hook?.kind === 'figure' && hook.tone).toBe('warn');
  });
});

describe('every number is the server’s, against the law’s two lines', () => {
  it('writes a complaint rate to two places', () => {
    expect(rateWords(0.0012)).toBe('0.12%');
    expect(rateWords(0)).toBe('0.00%');
    expect(rateWords(null)).toBe('—');
  });

  it('colours the overall rate by the line it crossed', () => {
    const over = panel(reading(), 'mail-complaints');
    expect(over?.kind === 'figure' && over.value).toBe('0.20%');
    expect(over?.kind === 'figure' && over.tone).toBe('warn');
    const base = reading();
    const cliff = panel(
      reading({
        complaints: {
          ...base.complaints,
          overall: { ...base.complaints.overall, rate: 0.004, state: 'over_cliff' },
        },
      }),
      'mail-complaints',
    );
    expect(cliff?.kind === 'figure' && cliff.tone).toBe('critical');
    const none = panel(
      reading({
        complaints: {
          ...base.complaints,
          overall: { ...base.complaints.overall, delivered: 0, rate: null, state: 'no_mail' },
        },
      }),
      'mail-complaints',
    );
    expect(none?.kind === 'figure' && none.tone).toBe('unknown');
  });

  it('tabulates each kind as the gateway counted it', () => {
    const kinds = panel(reading(), 'mail-kinds');
    if (kinds?.kind !== 'rows') throw new Error('the kinds are rows');
    expect(kinds.columns).toEqual([
      'Kind',
      'Delivered',
      'Complaints',
      'Rate',
      'Against 0.10% and 0.30%',
      'Paused',
    ]);
    expect(kinds.rows.map((r) => r.cells)).toEqual([
      ['learning_note', '800', '2', '0.25%', 'over 0.10%', 'paused'],
      ['quick_one', '200', '0', '0.00%', 'under both', ''],
    ]);
    expect(kinds.rows.map((r) => r.tone)).toEqual(['warn', 'ok']);
  });

  it('counts suppressed addresses and never lists one', () => {
    const suppressed = panel(reading(), 'mail-suppressed');
    expect(suppressed?.kind === 'figure' && suppressed.value).toBe('3');
    const text = JSON.stringify(mailPanels(reading(), AT));
    expect(text).not.toMatch(/[0-9a-f]{16}/);
    expect(text).not.toContain('@example');
  });

  it('shows bounces, pauses and alerts', () => {
    expect(panel(reading(), 'mail-bounces')?.kind === 'figure').toBe(true);
    const paused = panel(reading(), 'mail-paused');
    if (paused?.kind !== 'rows') throw new Error('the paused kinds are rows');
    expect(paused.rows[0]?.cells.slice(0, 2)).toEqual(['learning_note', 'complaint rate']);
    const calm = panel(reading({ paused: [] }), 'mail-paused');
    expect(calm?.kind === 'figure' && calm.value).toBe('none');
    const alerts = panel(reading(), 'mail-alerts');
    if (alerts?.kind !== 'rows') throw new Error('the alerts are rows');
    expect(alerts.rows[0]?.cells).toContain('complaint rate');
    expect(alerts.rows[0]?.tone).toBe('warn');
  });

  it('shows where each seed landed, and alarms only on spam and missing', () => {
    const base = reading();
    const configured = reading({
      placement: {
        ...base.placement,
        configured: true,
        live: true,
        results: [
          {
            provider: 'gmail',
            kind: 'welcome',
            tab: 'primary',
            folder: 'INBOX',
            day: '2026-09-16',
            auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
            at: AT,
          },
          {
            provider: 'yahoo',
            kind: 'quick_one',
            tab: 'spam',
            folder: 'Bulk',
            day: '2026-09-16',
            auth: { spf: 'pass', dkim: 'fail' },
            at: AT,
          },
        ],
      },
    });
    const seeds = panel(configured, 'mail-placement');
    if (seeds?.kind !== 'rows') throw new Error('the seeds are rows');
    expect(seeds.rows.map((r) => r.cells[2])).toEqual(['primary', 'spam']);
    expect(seeds.rows.map((r) => r.cells[4])).toEqual([
      'spf pass, dkim pass, dmarc pass',
      'spf pass, dkim fail',
    ]);
    expect(seeds.rows.map((r) => r.tone)).toEqual(['ok', 'critical']);
    expect(placementTone('promotions', {})).toBe('warn');
    expect(placementTone('missing', {})).toBe('critical');
    expect(placementTone('inbox', { dmarc: 'fail' })).toBe('critical');
  });

  it('shows Gmail’s own day when there is one', () => {
    const base = reading();
    const read = reading({
      postmaster: {
        configured: true,
        note: base.postmaster.note,
        reading: {
          day: '2026-09-15',
          domain: 'mail.heywobo.com',
          spam_rate: 0.0004,
          kinds: { learning_note: 0.0002 },
          auth: { spf: 1, dkim: 1, dmarc: 1 },
          verdict: { state: 'COMPLIANT', reason: 'USER_FEEDBACK_POSITIVE' },
          needs_work: [],
        },
      },
    });
    const google = panel(read, 'mail-postmaster');
    expect(google?.kind === 'figure' && google.value).toBe('0.04%');
    expect(google?.kind === 'figure' && google.tone).toBe('ok');
    const waiting = panel(
      reading({ postmaster: { configured: true, reading: null, note: base.postmaster.note } }),
      'mail-postmaster',
    );
    expect(waiting?.kind).toBe('absent');
  });

  it('says which sender the transactional stream uses', () => {
    const streams = panel(reading(), 'mail-streams');
    expect(streams?.kind === 'figure' && streams.value).toBe('shared');
  });
});

describe('an alert says whether the owner was mailed, one by one', () => {
  const unmailed = (over: Partial<MailDesk> = {}) => {
    const base = reading(over);
    const first = base.alerts[0];
    if (!first) throw new Error('the reading has an alert');
    return reading({
      ...over,
      alerts: [first, { ...first, at: '2026-09-16T10:00:00.000Z', mailed: false }],
    });
  };

  it('never claims every alert was mailed when one was not', () => {
    const alerts = panel(unmailed(), 'mail-alerts');
    if (alerts?.kind !== 'rows') throw new Error('the alerts are rows');
    expect(alerts.columns).toContain('Mailed');
    expect(alerts.rows.map((r) => r.cells[alerts.columns.indexOf('Mailed')])).toEqual([
      'yes',
      'not yet, tried again every hour',
    ]);
    expect(alerts.provenance.caveat ?? '').not.toContain('Each was also mailed');
    expect(alerts.rows[1]?.tone).toBe('critical');
  });

  it('refuses an alert that does not say whether it was mailed', () => {
    const base = reading();
    const first = base.alerts[0];
    if (!first) throw new Error('the reading has an alert');
    const { mailed: _dropped, ...silent } = first;
    expect(isMailDesk({ ...base, alerts: [silent] })).toBe(false);
  });
});

describe('the one control', () => {
  it('offers only what is paused', () => {
    expect(pausedKinds(reading())).toEqual(['learning_note']);
    expect(pausedKinds(reading({ paused: [] }))).toEqual([]);
    expect(pausedKinds(null)).toEqual([]);
  });
});
