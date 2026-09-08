import type { ConsentTier } from '@wobo/contracts';
import { gatewayFetch, throwForGatewayStatus } from './gateway';

/**
 * The external-provider seams. Each has the same typed interface for its mock and live forms, so
 * going live is a provider binding + an env flag, never a refactor. Phase 0 runs the mock side.
 */

// --- LLM (via the gateway) ----------------------------------------------------------------------

export type CapabilityInput = Record<string, unknown>;

export interface LLMResult {
  capability: string;
  output: unknown;
  track: 'track_1' | 'track_2';
  cached: boolean;
}

/** Raised when a profiling capability is requested without the elevated consent tier. */
export class ConsentDeniedError extends Error {
  constructor(capability: string) {
    super(`capability ${capability} requires the elevated consent tier`);
    this.name = 'ConsentDeniedError';
  }
}

export interface LLMProvider {
  invoke(
    capability: string,
    input: CapabilityInput,
    ctx: { consentTier: ConsentTier },
  ): Promise<LLMResult>;
}

/** Capabilities that profile the learner — refused under un_elevated (DPDP). Mirrors the gateway. */
const ELEVATED_ONLY = new Set(['archetype.classify', 'peakcut.evaluate']);

/**
 * Wobo's voice, canned. About the work on the page, never about Wobo or what Wobo can see
 * (DESIGN.md §0.x). Rotated deterministically by the input.
 */
const MOCK_WOBO_TURNS = [
  {
    say: 'Which line are you least sure of? Start there.',
    actions: [
      { type: 'setMood', mood: 'thinking' },
      { type: 'highlight', targetId: 'concept-linear-eq', level: 'primary' },
      { type: 'annotate', targetId: 'concept-linear-eq', mark: 'lookHere', level: 'secondary' },
    ],
  },
  {
    say: 'Take the first step, then check it before the next.',
    actions: [{ type: 'setMood', mood: 'listening' }],
  },
  {
    say: 'Say where it feels wobbly. That is the step to redo.',
    actions: [{ type: 'setMood', mood: 'thinking' }],
  },
  {
    say: 'Point at the part that is new. Begin with that.',
    actions: [{ type: 'setMood', mood: 'hint' }],
  },
];

/** Deterministic seed so the mock rotates without ever being random. */
function mockSeed(input: CapabilityInput): number {
  const body = JSON.stringify(input) ?? '';
  let h = 0;
  for (let i = 0; i < body.length; i++) h = (h * 31 + body.charCodeAt(i)) >>> 0;
  return h;
}

function mockOutputFor(capability: string, input: CapabilityInput): unknown {
  switch (capability) {
    case 'generate.opener':
      return {
        prompt: 'Find the value of x that makes 2x + 3 = 7 true.',
        interactive: true,
        verification_hash: 'seed-opener-linear-eq-1',
      };
    case 'wobo.turn': {
      const turn = MOCK_WOBO_TURNS[
        mockSeed(input) % MOCK_WOBO_TURNS.length
      ] as (typeof MOCK_WOBO_TURNS)[number];
      return { ...turn, grounded: true, handed_answer: false };
    }
    case 'generate.course':
      return {
        title: 'Your course',
        estMinutes: 90,
        nodes: [
          { id: 'n1', name: 'Getting oriented', blurb: 'Where we start and why.' },
          { id: 'n2', name: 'The core idea', blurb: 'The one concept everything rests on.' },
          { id: 'n3', name: 'Working it out', blurb: 'Try it step by step, unhurried.' },
          { id: 'n4', name: 'Common snags', blurb: 'Where learners slip, and how to catch it.' },
          { id: 'n5', name: 'Putting it together', blurb: 'Bring the pieces into one whole.' },
        ],
      };
    case 'grade.attempt':
      return { correct: true, rationale: 'mock grade' };
    case 'verify.math':
      return { verified: true, confidence: 1 };
    default:
      return { note: `mock ${capability}` };
  }
}

/** Deterministic, network-free LLM responses. Never contacts a provider. */
export class MockLLMProvider implements LLMProvider {
  async invoke(
    capability: string,
    input: CapabilityInput,
    ctx: { consentTier: ConsentTier },
  ): Promise<LLMResult> {
    if (ELEVATED_ONLY.has(capability) && ctx.consentTier !== 'elevated') {
      throw new ConsentDeniedError(capability);
    }
    return {
      capability,
      output: mockOutputFor(capability, input),
      track: 'track_2',
      cached: false,
    };
  }
}

/**
 * The live LLM provider posts to the gateway service.
 *
 * It sends no consent tier and no limit: the brain derives the learner's tier server-side from
 * their verified subject, so a client-declared tier could never open a door. Identity rides the
 * `Authorization` header attached by `gatewayFetch`; refusals come back typed (sign-in needed,
 * budget spent) in Wobo's voice, never as a status code and never naming a provider.
 */
export class GatewayLLMProvider implements LLMProvider {
  constructor(private readonly gatewayUrl: string) {}

  async invoke(capability: string, input: CapabilityInput): Promise<LLMResult> {
    const res = await gatewayFetch(`${this.gatewayUrl}/v1/capability/${capability}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: input }),
    });
    if (res.status === 403) throw new ConsentDeniedError(capability);
    await throwForGatewayStatus(res);
    const data = (await res.json()) as {
      capability: string;
      output: unknown;
      track: 'track_1' | 'track_2';
      cache_hit: boolean;
    };
    return {
      capability: data.capability,
      output: data.output,
      track: data.track,
      cached: data.cache_hit,
    };
  }
}

// --- Content (verified) -------------------------------------------------------------------------

export interface VerifiedItem {
  node_id: string;
  modality: string;
  verification_hash: string;
  body: unknown;
}

/** A practice item: a problem with a verifier-frozen correct answer (unaided evidence). */
export interface PracticeItem {
  id: string;
  node_id: string;
  equation: string;
  /** The verifier-established correct value of x (frozen at seed time). */
  answer: string;
  /** IRT-ish difficulty in [0, 1]. */
  difficulty: number;
}

export interface ContentProvider {
  getVerified(nodeId: string, modality: string): Promise<VerifiedItem | null>;
  getPracticeItems(nodeId: string): Promise<PracticeItem[]>;
}

const ATOM_LINEAR_EQ = '00000000-0000-7000-8000-00000000a003';

const ATOM_PRACTICE: PracticeItem[] = [
  {
    id: '00000000-0000-7000-8000-000000000101',
    node_id: ATOM_LINEAR_EQ,
    equation: 'x + 7 = 12',
    answer: '5',
    difficulty: 0.15,
  },
  {
    id: '00000000-0000-7000-8000-000000000102',
    node_id: ATOM_LINEAR_EQ,
    equation: '2x + 3 = 7',
    answer: '2',
    difficulty: 0.2,
  },
  {
    id: '00000000-0000-7000-8000-000000000103',
    node_id: ATOM_LINEAR_EQ,
    equation: '3x = 12',
    answer: '4',
    difficulty: 0.25,
  },
  {
    id: '00000000-0000-7000-8000-000000000104',
    node_id: ATOM_LINEAR_EQ,
    equation: '5x - 2 = 13',
    answer: '3',
    difficulty: 0.4,
  },
  {
    id: '00000000-0000-7000-8000-000000000105',
    node_id: ATOM_LINEAR_EQ,
    equation: 'x/2 = 5',
    answer: '10',
    difficulty: 0.5,
  },
  {
    id: '00000000-0000-7000-8000-000000000106',
    node_id: ATOM_LINEAR_EQ,
    equation: '2(x + 3) = 10',
    answer: '2',
    difficulty: 0.6,
  },
];

/** Serves the seeded, verifier-passed content for the atom (the tier-1 warm path). */
export class SeedContentProvider implements ContentProvider {
  private readonly seed = new Map<string, VerifiedItem>([
    [
      '00000000-0000-7000-8000-00000000a003:opener',
      {
        node_id: '00000000-0000-7000-8000-00000000a003',
        modality: 'opener',
        verification_hash: 'seed-opener-linear-eq-1',
        body: {
          prompt: 'Find the value of x that makes this equation true. Show each step.',
          equation: '2x + 3 = 7',
          interactive: true,
        },
      },
    ],
  ]);

  async getVerified(nodeId: string, modality: string): Promise<VerifiedItem | null> {
    return this.seed.get(`${nodeId}:${modality}`) ?? null;
  }

  async getPracticeItems(nodeId: string): Promise<PracticeItem[]> {
    return ATOM_PRACTICE.filter((item) => item.node_id === nodeId);
  }
}

// --- Messaging (parent) -------------------------------------------------------------------------

export interface MessagingProvider {
  sendParentDigest(msg: {
    to: string;
    artifact: unknown;
  }): Promise<{ delivered: boolean; mode: string }>;
}

/** Renders a digest preview; never sends (WhatsApp goes live Phase 2-3). */
export class MockMessagingProvider implements MessagingProvider {
  async sendParentDigest(): Promise<{ delivered: boolean; mode: string }> {
    return { delivered: false, mode: 'preview' };
  }
}

// --- Payment ------------------------------------------------------------------------------------

export interface Subscription {
  plan: 'free' | 'superstar';
  status: 'none' | 'active' | 'cancelled';
}

export interface PaymentProvider {
  getSubscription(subjectId: string): Promise<Subscription>;
}

/** Mock subscription state (Razorpay/IAP go live Phase 4). */
export class MockPaymentProvider implements PaymentProvider {
  async getSubscription(): Promise<Subscription> {
    return { plan: 'free', status: 'none' };
  }
}
