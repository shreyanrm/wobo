import { describe, expect, it } from 'bun:test';
import { ATOM_NODE_IDS } from '@wobo/kgtopg-contract-seed';
import { AuthNotEnabledError, ConsentDeniedError, createSdk, DevMockIdentity } from '../src/index';

describe('identity boundary', () => {
  it('returns the dev-mock session (opaque subject only) under DEV_AUTH', async () => {
    const sdk = createSdk();
    const session = await sdk.identity.getSession();
    expect(session.subject_id).toBe('00000000-0000-7000-8000-000000000001');
    expect(session.consent_tier).toBe('un_elevated');
    expect(session.display_name).toBe('Learner');
    expect(await sdk.identity.getAccessToken()).toBeNull();
  });

  it('exposes typed auth seams that are not implemented before Phase 4', async () => {
    const id = new DevMockIdentity({
      devAuth: true,
      mockSubjectId: '00000000-0000-7000-8000-000000000001',
      consentTierDefault: 'un_elevated',
      surface: 'pwa',
      llmMode: 'mock',
      contentMode: 'seed',
      persistMode: 'local',
    });
    await expect(id.auth.requestPhoneOtp('+910000000000')).rejects.toBeInstanceOf(
      AuthNotEnabledError,
    );
    await expect(
      id.auth.recordParentalConsent({
        subject_id: 'x',
        guardian_ref: 'g',
        verifier: 'digilocker',
        purposes: [],
      }),
    ).rejects.toBeInstanceOf(AuthNotEnabledError);
  });

  // DEV_AUTH=false is no longer refused — real auth shipped. What it still requires is env-supplied
  // keys, and auth.test.ts states that correctly ("still throws on DEV_AUTH=false without env keys")
  // alongside the live-identity wiring it enables. Restating it here would only re-record the
  // removed constraint.
});

describe('provider seams', () => {
  it('serves a deterministic mock opener and refuses profiling under un_elevated', async () => {
    const sdk = createSdk();
    const opener = await sdk.llm.invoke('generate.opener', {}, { consentTier: 'un_elevated' });
    expect((opener.output as { prompt: string }).prompt).toContain('2x + 3');
    await expect(
      sdk.llm.invoke('archetype.classify', {}, { consentTier: 'un_elevated' }),
    ).rejects.toBeInstanceOf(ConsentDeniedError);
  });

  it('allows profiling capabilities only when elevated', async () => {
    const sdk = createSdk({ consentTierDefault: 'elevated' });
    const result = await sdk.llm.invoke('peakcut.evaluate', {}, { consentTier: 'elevated' });
    expect(result.capability).toBe('peakcut.evaluate');
  });

  it('serves verified seed content for the atom and null for the unknown', async () => {
    const sdk = createSdk();
    const opener = await sdk.content.getVerified(ATOM_NODE_IDS.linearEquations, 'opener');
    expect(opener?.verification_hash).toBe('seed-opener-linear-eq-1');
    expect(await sdk.content.getVerified('nope', 'opener')).toBeNull();
  });
});

describe('kgtopg binding', () => {
  it('exposes the governed ontology through the sdk', async () => {
    const sdk = createSdk();
    const node = await sdk.kgtopg.ontology.getNode(ATOM_NODE_IDS.linearEquations);
    expect(node?.name).toContain('linear equations');
  });
});

/**
 * `config` is the RAW resolved configuration. Under live auth the canonical subject is auth.uid()
 * and `config.mockSubjectId` is still the dev knob, so a governed view asked about it was asked
 * about a learner with no evidence at all and answered from an all-not_started band set. The
 * attribution subject has to be reachable, and it is `sdk.subjectId`.
 */
describe('the subject everything is filed under', () => {
  it('is exposed on the sdk, and is the one the events are attributed to', () => {
    const sdk = createSdk();
    expect(typeof sdk.subjectId).toBe('string');
    expect(sdk.subjectId.length).toBeGreaterThan(0);
    const event = sdk.events.record('learn.node.entered.v1', {
      node_id: '00000000-0000-7000-8000-0000000000c1',
      entry: 'map',
      initial_band: 'not_started',
    });
    expect(event.actor.subject_id).toBe(sdk.subjectId);
  });
});
