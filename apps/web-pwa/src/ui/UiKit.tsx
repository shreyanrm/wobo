/**
 * /ui-kit — every primitive, in both themes, on one page. Dev only (App.tsx mounts it behind
 * import.meta.env.DEV) so the gate can screenshot the kit next to design/prototypes/app-v1.html.
 *
 * Every word on this page is the prototype's; the section names are the primitives' own. The two
 * panels carry their own `data-theme`, so light and night sit side by side whatever the document
 * is stamped; `?theme=dark` (or light) stamps the document for the shell at the bottom.
 */

import { type ReactNode, useEffect, useState } from 'react';
import { planInWords } from '../screens/allowance-words';
import { type Allowance, allowanceLine, allowanceShare } from '../screens/plans/allowance';
import {
  AllowanceCard,
  AppShell,
  AskBox,
  Avatar,
  Button,
  Card,
  CardFoot,
  Chip,
  HandNote,
  Label,
  Pill,
  Segmented,
  Sticker,
  StreakDays,
  Tag,
  TalkHint,
  Tile,
  ToggleRow,
  TopBar,
  WoboHead,
} from './primitives';
import './UiKit.css';

/**
 * THE GALLERY SPEAKS THE PRODUCT'S VOICE, not a sample of its own.
 *
 * /ui-kit is in `PLAIN_ROUTES` and answers 200, so every word on it is a word a reader can reach.
 * Its allowance samples used to be typed out by hand — "25 of 40 turns left · resets 6:00 am",
 * "Free · 40 turns a day" — which is the one raw allowance DESIGN.md §0 bans, rendered live on a
 * public route. They are now derived from the very functions the product uses, so the gallery
 * demonstrates the lawful sentence and can never drift from it again.
 */
const SAMPLE_ALLOWANCE: Allowance = {
  known: true,
  remaining: 25,
  limit: 40,
  resetsAt: new Date('2026-09-04T06:00:00'),
};
const SAMPLE_NOTE = allowanceLine(SAMPLE_ALLOWANCE);
const SAMPLE_SHARE = allowanceShare(SAMPLE_ALLOWANCE) ?? undefined;

const WEEK = [
  { label: 'M', on: true },
  { label: 'T', on: true },
  { label: 'W', on: true },
  { label: 'T', on: true },
  { label: 'F', on: true },
  { label: 'S', on: true },
  { label: 'S', on: true },
] as const;

const SPAN = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
] as const;

const APPEARANCE = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'auto', label: 'Auto' },
] as const;

function Section({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section className="wk-gal-sec">
      <Tag>{name}</Tag>
      {children}
    </section>
  );
}

/** The three today cards from the home screen, verbatim. */
function TodayCards() {
  return (
    <>
      <Card tint="pig">
        <Tag>Continue</Tag>
        <h3>Pythagoras, the hypotenuse</h3>
        <p>Chapter 6 · lesson 3 of 5. Last time you found c = 5 yourself.</p>
        <CardFoot>
          <Button size="sm">Continue</Button>
          <Pill>6 min</Pill>
        </CardFoot>
      </Card>
      <Card tint="mint">
        <Tag>Practice</Tag>
        <h3>Five triangles, drawn by you</h3>
        <p>Shade, drag and draw. Wobo rings the gap when you're close.</p>
        <CardFoot>
          <Button size="sm" tone="quiet">
            Start
          </Button>
          <Pill>8 min</Pill>
        </CardFoot>
      </Card>
      <Card tint="marigold">
        <Tag>Wobo noticed</Tag>
        <h3>You asked for help after a miss</h3>
        <p>That's exactly how learning looks. It goes in the Sunday note.</p>
        <CardFoot>
          <WoboHead size={40} />
          <Pill>yesterday</Pill>
        </CardFoot>
      </Card>
    </>
  );
}

function Specimens() {
  const [span, setSpan] = useState<(typeof SPAN)[number]['id']>('week');
  const [appearance, setAppearance] = useState<(typeof APPEARANCE)[number]['id']>('auto');
  const [speaks, setSpeaks] = useState(true);
  const [reduce, setReduce] = useState(false);
  const [subject, setSubject] = useState('Mathematics');
  const [plane, setPlane] = useState('Plane');
  return (
    <>
      <Section name="Button">
        <div className="wk-gal-row">
          <Button>Check</Button>
          <Button tone="pig">Ask</Button>
          <Button tone="quiet">Start over</Button>
          <Button size="sm">Continue</Button>
          <Button size="sm" tone="pig">
            Ask
          </Button>
          <Button size="sm" tone="quiet">
            Choose
          </Button>
        </div>
      </Section>

      <Section name="Chip">
        <div className="wk-gal-row">
          <Chip>Streak · 7</Chip>
          {['Full board', 'Plane', 'Notes'].map((c) => (
            <Chip key={c} on={plane === c} onClick={() => setPlane(c)}>
              {c}
            </Chip>
          ))}
          <Chip>Circle</Chip>
          <Chip>Type</Chip>
          <Chip>Talk</Chip>
        </div>
      </Section>

      <Section name="Label and Tag">
        <div className="wk-gal-row">
          <Label>Your subjects</Label>
          <Tag>This week, in Wobo's words</Tag>
          <Tag>Ask about this</Tag>
        </div>
      </Section>

      <Section name="Pill">
        <div className="wk-gal-row">
          <Pill>6 min</Pill>
          <Pill>8 min</Pill>
          <Pill>yesterday</Pill>
          <Pill>not linked yet</Pill>
        </div>
      </Section>

      <Section name="Card">
        <div className="wk-gal-grid">
          <TodayCards />
          <Card tint="rose" compact>
            <Tag>Ask about this</Tag>
            <p style={{ color: 'var(--ink)' }}>
              Circle any part of the board and ask why. Or just say it.
            </p>
            <div className="wk-gal-row">
              <Chip>Circle</Chip>
              <Chip>Type</Chip>
              <Chip>Talk</Chip>
            </div>
          </Card>
          <Card compact>
            <Tag>Your place</Tag>
            <p>Saved as you go. Leave any time, come back to this line.</p>
          </Card>
          <Card tint="lilac" compact>
            <Tag>Parents</Tag>
            <h3>Share the week with a parent</h3>
            <p style={{ color: 'var(--ink)' }}>
              They get the Sunday note and a read-only view of every lesson. Nothing else, nothing
              hidden.
            </p>
            <CardFoot>
              <Button size="sm">Send an invite</Button>
              <Pill>not linked yet</Pill>
            </CardFoot>
          </Card>
        </div>
      </Section>

      <Section name="Tile">
        <div className="wk-gal-grid">
          <Tile
            title="Mathematics"
            meta="Chapter 6 of 14 · triangles"
            on={subject === 'Mathematics'}
            onClick={() => setSubject('Mathematics')}
          />
          <Tile
            title="Science"
            meta="Chapter 4 of 13 · sound"
            on={subject === 'Science'}
            onClick={() => setSubject('Science')}
          />
          <Tile
            title="Social science"
            meta="Chapter 3 of 12"
            on={subject === 'Social science'}
            onClick={() => setSubject('Social science')}
          />
          <Tile
            title="English"
            meta="Unit 2 of 8"
            on={subject === 'English'}
            onClick={() => setSubject('English')}
          />
        </div>
      </Section>

      <Section name="Segmented">
        <div className="wk-gal-row">
          <Segmented options={SPAN} value={span} onChange={setSpan} />
        </div>
      </Section>

      <Section name="Toggle">
        <Card compact>
          <Tag>Settings</Tag>
          <ToggleRow
            title="Wobo speaks replies out loud"
            hint="Voice chosen for India · English"
            on={speaks}
            onChange={setSpeaks}
          />
          <ToggleRow
            title="Reduce motion"
            hint="Still frames instead of animation"
            on={reduce}
            onChange={setReduce}
          />
          <ToggleRow title="Appearance" hint="Auto by time of day">
            <Segmented options={APPEARANCE} value={appearance} onChange={setAppearance} />
          </ToggleRow>
          <ToggleRow title="Festivals we can wish you on" hint="Chosen by your family · none yet">
            <Button size="sm" tone="quiet">
              Choose
            </Button>
          </ToggleRow>
          <ToggleRow title="Your data" hint="Export or delete everything, any time">
            <Button size="sm" tone="quiet">
              Manage
            </Button>
          </ToggleRow>
        </Card>
      </Section>

      <Section name="AskBox">
        <AskBox placeholder="Ask anything from your syllabus, or paste question 7" />
      </Section>

      <Section name="HandNote">
        <Card compact>
          <Tag>This week, in Wobo's words</Tag>
          <HandNote>
            Three lessons, fourteen problems, and you asked for help twice after a miss,{' '}
            <em>which is exactly how learning looks.</em> Next: the other half of triangles, ten
            minutes a day.
          </HandNote>
        </Card>
      </Section>

      <Section name="StreakDays">
        <StreakDays
          count={7}
          title="days in a row"
          days={WEEK}
          note="Rest days don't break it. Learning does not need guilt."
        />
      </Section>

      <Section name="AllowanceCard and Sticker">
        <div className="wk-gal-grid">
          <div className="wk-gal-rel">
            <Sticker rotate={6} style={{ right: -14, top: -16 }}>
              free, every day
            </Sticker>
            <AllowanceCard title="Today's allowance" progress={SAMPLE_SHARE} note={SAMPLE_NOTE} />
          </div>
          <AllowanceCard title="Your plan">
            <span style={{ fontSize: 14, color: 'var(--ink)' }}>{planInWords('Free', 1)}</span>
            <Button size="sm" style={{ justifySelf: 'start' }}>
              See Pro
            </Button>
          </AllowanceCard>
        </div>
      </Section>

      <Section name="TopBar">
        <TopBar
          crumb="Tuesday · CBSE"
          right={
            <>
              <Chip>Streak · 7</Chip>
              <Avatar>A</Avatar>
            </>
          }
        />
        <TopBar
          crumb="You · CBSE · this week"
          right={
            <>
              <Segmented options={SPAN} value={span} onChange={setSpan} />
              <Avatar>A</Avatar>
            </>
          }
        />
      </Section>

      <Section name="TalkHint">
        <TalkHint keyLabel="space">Hold to talk to Wobo</TalkHint>
      </Section>

      <Section name="WoboHead">
        <div className="wk-gal-row" style={{ gap: 24 }}>
          <WoboHead size={180} shadow />
          <WoboHead size={56} mood="thinking" />
          <WoboHead size={44} mood="explaining" />
          <WoboHead size={40} mood="celebrate" />
          <WoboHead size={28} mood="listening" />
        </div>
      </Section>
    </>
  );
}

export function UiKit() {
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('theme');
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
  }, []);
  return (
    <div className="wk-gal">
      <div className="wk-gal-panels">
        <section data-theme="light" className="wk-gal-panel">
          <Specimens />
        </section>
        <section data-theme="dark" className="wk-gal-panel">
          <Specimens />
        </section>
      </div>
      <div className="wk-gal-shell">
        <AppShell
          active="home"
          onNavigate={() => undefined}
          bottom={
            <AllowanceCard title="Today's allowance" progress={SAMPLE_SHARE} note={SAMPLE_NOTE} />
          }
        >
          <TopBar
            crumb="Tuesday · CBSE"
            right={
              <>
                <Chip>Streak · 7</Chip>
                <Avatar>A</Avatar>
              </>
            }
          />
          <div className="wk-gal-today">
            <TodayCards />
          </div>
        </AppShell>
      </div>
    </div>
  );
}
