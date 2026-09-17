/**
 * The words on the parent's ask and the parent's memory page. Held by a test (talk.test.tsx),
 * never rewritten beside the screen.
 *
 * The register is docs/copy/voice.md 10a, and the reader is an adult who is busy and cares: short,
 * plain, no reassurance they did not ask for. Nothing here is about money; that is
 * docs/copy/money.md's and another screen's. The child is never named by us: the name, when there
 * is one, is the one the gateway hands back, and "your child" when there is not.
 */

export function childLabel(name: string | null | undefined): string {
  const first = (name ?? '').trim();
  return first || 'your child';
}

/** Sentence-initial form of the child label. */
function Child(name: string | null | undefined): string {
  const label = childLabel(name);
  return label === 'your child' ? 'Your child' : label;
}

export const TALK_COPY = {
  tabAsk: 'Ask',
  tabMemory: 'What Wobo remembers',
  chooseChild: 'Choose a child',
  signIn: 'Sign in',
  loading: 'Opening',

  askTitle: (name: string | null) => `Ask about ${childLabel(name)}`,
  askLede:
    'Ask in your own words. I answer from the weekly record: what is landing, what needs another pass, and where the term is heading. What they say to me stays between the two of us.',
  askLabel: 'Your question',
  askPlaceholder: 'Ask about their learning',
  askSend: 'Ask',
  askSending: 'Asking',
  askSuggestions: [
    'How did this week go?',
    'What should we practise this week?',
    'Are they ready for the test?',
  ] as readonly string[],
  you: 'You',
  wobo: 'Wobo',

  offerAsk: 'Shall I pass this on?',
  offerPass: 'Pass it on',
  offerNotNow: 'Not now',
  offerYes: 'Yes, pass it on',
  offerKeep: 'Keep it back',
  offerPassed: (name: string | null) =>
    `Passed on. ${Child(name)} will see it on their memory page, marked as from you.`,
  offerKept: 'Kept back. Nothing was passed on.',

  memoryTitle: 'What Wobo remembers',
  memoryLede:
    'What you have told me, kept for the next time you ask. Only you see this list, and you can clear any line.',
  tellLabel: 'Tell Wobo something',
  tellPlaceholder: 'A tutor on Tuesdays, an exam date, a subject that worries them',
  scopeChild: (name: string | null) => `About ${childLabel(name)}`,
  scopeFamily: 'About the family',
  tellSend: 'Remember this',
  tellSending: 'Remembering',
  aboutChild: (name: string | null) => `About ${childLabel(name)}`,
  aboutFamily: 'About the family',
  emptyChild: (name: string | null) =>
    `Nothing yet. Tell me something about ${childLabel(name)} and it lands here.`,
  emptyFamily: 'Nothing about the family yet.',
  sourceParent: 'you said',
  sourceReport: 'from the weekly note',
  forget: 'Forget',
  forgetting: 'Forgetting',
  offerTo: (name: string | null) => `Offer to ${childLabel(name)}`,
  offeredTitle: (name: string | null) => `Offered to ${childLabel(name)}`,
  offeredLede: (name: string | null) =>
    `A line you pass on goes to ${childLabel(name)}'s own memory page, marked as from you. ${Child(name)} can remove it, and then it stays removed.`,
  statusPending: 'Waiting for your yes',
  statusAccepted: 'Passed on',
  statusWithdrawn: 'Kept back',
} as const;
