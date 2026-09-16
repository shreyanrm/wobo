/**
 * The register desk: who has a seat, what each person EFFECTIVELY holds, and the owner's hand on
 * each capability (docs/CONSOLE-ROLES-AND-BOARD.md §2).
 *
 * "The screen always shows the effective set rather than the theory", so every cell is computed
 * from the gateway's `capabilities` (effective) with `granted` and `revoked` saying which of them
 * was the owner's own doing. Nothing here decides who holds what: it renders and it asks.
 */

process.env.VITE_GATEWAY_URL = 'https://gateway.test';

import { describe, expect, it } from 'bun:test';
import { write } from './api';
import {
  cellOf,
  changeFor,
  isInvitationAnswer,
  isRegister,
  type RegisterSeat,
  registerPanels,
  seatPath,
  startingSet,
} from './register';

const VOCAB = [
  {
    id: 'money',
    name: 'Money and allowance',
    question: 'q',
    read: 'panel.money.read',
    act: 'panel.money.act',
  },
  {
    id: 'register',
    name: 'The register',
    question: 'q',
    read: 'panel.register.read',
    act: 'panel.register.act',
  },
];

function seat(overrides: Partial<RegisterSeat> = {}): RegisterSeat {
  return {
    id: '7b2c1a52-0000-4000-8000-000000000001',
    email: 'ops@example.com',
    role: 'operator',
    status: 'active',
    mfa_required: true,
    permissions: ['console.read'],
    capabilities: ['panel.money.read'],
    granted: [],
    revoked: [],
    granted_by: null,
    invitation_expires_at: null,
    ...overrides,
  };
}

const REGISTER = {
  admins: [seat()],
  roles: ['viewer', 'operator', 'owner'],
  vocabulary: VOCAB,
  defaults: { viewer: ['panel.money.read'], operator: ['panel.money.read'], owner: [] },
  owner_count: 1,
};

describe('the register comes over the wire whole or not at all', () => {
  it('accepts the gateway shape', () => {
    expect(isRegister(REGISTER)).toBe(true);
  });

  it('refuses a body that is nearly right', () => {
    expect(isRegister({ ...REGISTER, admins: [{ ...seat(), capabilities: 'all' }] })).toBe(false);
    expect(isRegister({ ...REGISTER, vocabulary: [{ id: 'money' }] })).toBe(false);
    expect(isRegister({ ...REGISTER, owner_count: '1' })).toBe(false);
    expect(isRegister(null)).toBe(false);
  });

  it('accepts an invitation only with its link, its deadline and its message', () => {
    const answer = {
      admin: seat({ status: 'invited' }),
      invitation: {
        to: 'ops@example.com',
        link: 'https://console.test/admin.html?invite=a.b',
        expires_at: '2026-09-20T09:30:00+00:00',
        sent: false,
        mail: { subject: 's', text: 't', html: '<p>h</p>' },
      },
    };
    expect(isInvitationAnswer(answer)).toBe(true);
    expect(isInvitationAnswer({ ...answer, invitation: { ...answer.invitation, link: '' } })).toBe(
      false,
    );
    expect(
      isInvitationAnswer({ ...answer, invitation: { ...answer.invitation, link: 'javascript:x' } }),
    ).toBe(false);
    expect(isInvitationAnswer({ admin: answer.admin })).toBe(false);
  });
});

describe('each cell is the effective set, with its source', () => {
  it('reads a role default, an owner grant and an owner revoke apart', () => {
    expect(cellOf(seat(), 'panel.money.read')).toEqual({ held: true, source: 'role' });
    expect(cellOf(seat(), 'panel.money.act')).toEqual({ held: false, source: 'role' });
    expect(
      cellOf(
        seat({ capabilities: ['panel.money.act'], granted: ['panel.money.act'] }),
        'panel.money.act',
      ),
    ).toEqual({ held: true, source: 'granted' });
    expect(
      cellOf(seat({ capabilities: [], revoked: ['panel.money.read'] }), 'panel.money.read'),
    ).toEqual({ held: false, source: 'revoked' });
  });

  it('turns a press into exactly one change', () => {
    expect(changeFor({ held: true, source: 'role' })).toBe('revoke');
    expect(changeFor({ held: false, source: 'role' })).toBe('grant');
    // An owner's own change is undone by putting the role's default back, never by a second row.
    expect(changeFor({ held: true, source: 'granted' })).toBe('default');
    expect(changeFor({ held: false, source: 'revoked' })).toBe('default');
  });

  it('starts a new person from their role and sends only what differs', () => {
    expect(startingSet(REGISTER, 'viewer')).toEqual(['panel.money.read']);
    expect(startingSet(REGISTER, 'nobody')).toEqual([]);
  });
});

describe('the register as panels', () => {
  it('names every person with what they effectively hold, and never a digest', () => {
    const panels = registerPanels(
      {
        ...REGISTER,
        admins: [
          seat(),
          seat({
            id: 'x',
            email: 'new@example.com',
            status: 'invited',
            invitation_expires_at: '2026-09-20T09:30:00+00:00',
          }),
        ],
      },
      '2026-09-17T10:00:00Z',
    );
    const rows = panels.find((panel) => panel.kind === 'rows');
    expect(rows?.kind).toBe('rows');
    if (rows?.kind !== 'rows') return;
    expect(rows.provenance.source).toContain('/v1/admin/admins');
    const text = rows.rows.map((row) => row.cells.join(' | ')).join('\n');
    expect(text).toContain('ops@example.com');
    expect(text).toContain('Money and allowance');
    expect(text).toContain('waiting');
    expect(text).not.toMatch(/[0-9a-f]{64}/);
  });

  it('says it could not read the register rather than showing nobody', () => {
    const panels = registerPanels(null, '2026-09-17T10:00:00Z');
    expect(panels).toHaveLength(1);
    expect(panels[0]?.kind).toBe('absent');
  });
});

describe('a change goes to the one person it names', () => {
  it('builds a path the transport will send, and nothing else', () => {
    expect(seatPath('7b2c1a52-0000-4000-8000-000000000001', 'capabilities')).toBe(
      '/7b2c1a52-0000-4000-8000-000000000001/capabilities',
    );
    expect(seatPath('../session', 'suspend')).toBeNull();
    expect(seatPath('a/b', 'invitation')).toBeNull();
  });

  it('sends a per-person write to that person, and carries the gateway’s refusal code back', async () => {
    const calls: string[] = [];
    const fetcher = (async (url: string | URL) => {
      calls.push(String(url));
      return Response.json({ detail: { code: 'reauth_required', message: 'x' } }, { status: 401 });
    }) as unknown as typeof fetch;
    const result = await write(
      'admins',
      { capability: 'panel.money.read', effect: 'revoke' },
      (value): value is unknown => value !== null,
      fetcher,
      'POST',
      '/7b2c1a52-0000-4000-8000-000000000001/capabilities',
    );
    expect(calls).toEqual([
      'https://gateway.test/v1/admin/admins/7b2c1a52-0000-4000-8000-000000000001/capabilities',
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('reauth_required');
  });

  it('refuses a path that could leave the register', async () => {
    const fetcher = (async () => Response.json({})) as unknown as typeof fetch;
    const result = await write(
      'admins',
      {},
      (v): v is unknown => true,
      fetcher,
      'POST',
      '/../session',
    );
    expect(result.ok).toBe(false);
  });
});
