/**
 * Every word the parent's door and the parent's home say, in one place.
 *
 * A parent is spoken to as an adult who is busy and cares (docs/copy/voice.md 10a): short
 * sentences, the answer first, no hype, no em dash, no exclamation mark, never a late hour. Money
 * is not described here at all: a line about money comes verbatim from docs/copy/money.md, and the
 * two money rows a parent reads belong to the pay screen and the donate screen, so the home names
 * those doors and says nothing more about them.
 *
 * Every refusal the server can send is the SERVER's sentence, shown as it came. The lines below
 * are only the ones the server has no reason to write: the door, the home, and the way on.
 */

export const DOOR = {
  /** The tab. */
  tab: 'Parents',
  /** Wobo's greeting, in Wobo's hand beside the head. */
  hand: 'hello',
  title: 'The parent’s door.',
  lede: 'Sign in with Google, using the address your child invited, and I will find them from there.',
  /** Why there is one way in, said once, under it. */
  whyEmail:
    'Your child’s invite went to an email address, so that address is how I know you are their parent. If it is not a Google account, ask your child to invite an address that is.',
  /** The dial is closed: existing parent accounts still sign in. */
  closedLede:
    'New parent accounts are not open yet. If you already have one, sign in and everything is where you left it.',
  /** The other door, in the bar. */
  learnerPrompt: 'Learning yourself?',
  learnerAction: 'Sign in here',
  /** On the learner doors, pointing here. */
  parentPrompt: 'A parent?',
  parentAction: 'Your door is here',
} as const;

export const HOME = {
  tab: 'Your children',
  /** The greeting when the account has a name. */
  hello: (name: string | null) => (name ? `Hello, ${name}.` : 'Hello.'),
  /** Above the switch, for a parent with two or more. */
  switchLabel: 'Whose week are you looking at?',
  /** The child on screen. */
  about: (name: string) => `About ${name}`,
  /** The four doors. Labels only: the screens behind them say the rest. */
  ask: (name: string) => `Ask Wobo about ${name}`,
  askLine: 'How the week went, what is coming, and where a hand would help.',
  pay: (name: string) => `Pay for ${name}’s plan`,
  refer: 'Tell another family',
  referLine: 'Share Wobo with a parent you know.',
  donate: 'Give a place',
  /** A door whose screen is not built yet keeps its shape and says so. */
  soon: 'soon',
  notYet: 'This door is not open yet.',
  /** The promise the whole product rests on, said where a parent reads it. */
  privacy: (name: string) =>
    `You see how ${name} is doing. You never see their conversations with me.`,
  /** A child the server has no name for. */
  unnamed: 'your child',
  /** Nobody linked yet. */
  noneTitle: 'No child is linked to this account yet.',
  noneBody:
    'Ask your child to open You in Wobo and invite this email address. Accept the invite from the email, then look again here.',
  /** A parent with children, adding another. */
  anotherTitle: 'Another child?',
  anotherBody: 'They invite this email address from You in Wobo. Accept it, then look again.',
  lookAgain: 'Look again',
  lookedNone: 'Nothing new yet. Once the invite is accepted, the child appears here.',
  signOut: 'Sign out',
  choose: 'Choose a child to carry on.',
} as const;

export const TROUBLE = {
  title: 'That did not work.',
  tryAgain: 'Try again',
  signOut: 'Sign out',
  /** A build with no gateway has no parent side. */
  unwired: 'The parent side needs a connection to Wobo, and this build has none.',
  /** The page behind a door that is not built. */
  notBuiltTitle: 'This part is on its way.',
  notBuiltBody: 'Everything else is where you left it.',
  back: 'Back to your children',
} as const;

/** Every string above, for the copy test. Functions are called with a name and with none. */
export function everyLine(): string[] {
  const out: string[] = [];
  for (const group of [DOOR, HOME, TROUBLE] as Record<string, unknown>[]) {
    for (const value of Object.values(group)) {
      if (typeof value === 'string') out.push(value);
      else if (typeof value === 'function') {
        out.push((value as (n: string) => string)('Asha'));
        if (value.length === 1) out.push((value as (n: string | null) => string)(null as never));
      }
    }
  }
  return out;
}
