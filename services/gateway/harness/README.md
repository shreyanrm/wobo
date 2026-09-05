# The teaching harness

The one test that asks whether the teaching is any good.

Every other suite in this repository tests the plumbing AROUND the teaching: that a turn is
metered, that a board event is well formed, that a chunk streams, that a refund lands. Not one of
them asked the question the product exists to answer, which is whether what Wobo says, draws and
explains is **right**. This is that question, asked against the real path.

## Running it

```sh
cd services/gateway

uv run python -m harness --live            # every question, real models, real money
uv run python -m harness --live --case bio # only questions whose id contains "bio"
uv run python -m harness --live --no-judge # arithmetic checks only, roughly a third the cost
uv run python -m harness --replay          # the recorded transcripts: free, no network, for CI
```

A full live run is **12 questions plus the re-teach ladder probe, about 25 model calls, and
roughly $0.20** — a few cents for
the answers and about twice that for the second opinion, which reads every answer in full. The
report states the figure it actually cost, taken from the gateway's own spend ledger rather than
from an estimate.

It is deliberately **not** a pytest file. It calls real models and the owner pays, so it runs when
somebody asks for it and never as a side effect of `uv run pytest` or `bun test`. What IS in the
default suite is `services/gateway/tests/test_teaching_harness.py`: the harness's own test, which
drives every check here against hand-built transcripts and proves each one fails on the failure it
exists to catch. A check that cannot fail is worse than no check — it prints a green tick over
whatever happened.

Reports are written to `harness/reports/` as markdown and JSON. Transcripts are written to
`harness/fixtures/` as they are produced, so the next `--replay` costs nothing.

## What it is made of

| file | what it does |
| --- | --- |
| `cases.py` | the questions, and the ground truth each is judged against — computed here, a different way round from the product |
| `runner.py` | drives `POST /v1/capability/wobo.turn` on the real app: the real door, safety screen, meter, planner, verifier and wire |
| `checks.py` | everything decidable by arithmetic — a wrong number, the verified-number law, an empty board, the voice laws |
| `drawing.py` + `geometry_probe.ts` | the board measured with the product's own `geometryOf` and its real handwriting font |
| `ladder.py` + `ladder_probe.ts` | the re-teach ladder driven for real, then its chosen rung sent through the real gateway |
| `judge.py` | the second opinion: the half a regex cannot decide, marked by the other provider |
| `report.py` | the score sheet, the rollups by subject and board, and every finding with its evidence |

## The rules it works by

**The arithmetic decides, never the judge.** A model can be wrong about whether an explanation was
warm. It must never be the only thing standing between a child and a false fact, so every numeric
claim in the bank is checked deterministically — a named quantity, a regex that finds the QUANTITY
being talked about, and a value set computed here. A judge may lower a score and may never raise
one the arithmetic put on the floor, and it can never fail a run on its own: what it finds is
reported as a weakness for a human to settle. Only arithmetic against ground truth is fatal.

**Ground truth is computed a different way round.** `cases.py` works the answers out with plain
arithmetic and the standard library; the product works them out with SymPy inside the verifier's
sandbox. A mistake has to be made twice, in two places, to survive. That is the doctrine
`tests/test_board_golden.py` already applies to the twelve recorded boards.

**Said, asked and drawn are the same claim.** Every check reads Wobo's spoken line, the question
in the `ask` frame, AND every glyph the hand would write. A false number is just as false written
as said, and just as false in the question put back to the child: the only WRONG finding in the
live run of 2026-09-05 was in an ask prompt, which nothing read at the time.

**And a claim is matched against the board the product really draws.** A board number is matched by
its IDENTITY — the verifier check it names, its unit, and the words on the objects sharing its
anchor — not by hunting for a phrase near it in a blob of joined text. The version before this one
matched prose written to suit its own regexes: eight of nine claims fired on nothing at all when
run against the product's own recorded transcripts, and a timeline dating the Jallianwala Bagh
massacre to 1921 scored four out of four. `test_teaching_harness.py` now walks every recorded
fixture and fails if a claim does not fire on its own case's real transcript.

**The drawing is measured, not described.** `geometry_probe.ts` runs `geometryOf` — the exact
function the renderer paints from — with the real font loaded, and reports where the ink actually
lands: off the 1000-unit board, clipped past the right edge, or written on top of another label.
Without bun on the machine the drawing check is SKIPPED and says so. It is never quietly passed.

**A report, not a tick.** The owner needs to see where the teaching is weak. Every question gets a
score out of four on ten dimensions, rolled up by subject and by board so a weak subject is visible
at a glance, and every finding carries the evidence beside it.

**It says what it does not know.** A question whose truth nothing here can check is scored 2 and
labelled unchecked rather than shown green — including a question with no claims at all, which
used to score a free 4 out of 4 for producing non-empty text. A judge that shares a provider with the tutor is named
as the weaker cross-check it is. A provider with no key on the machine is listed.

## Adding a question

One entry in `cases.py`. The fields that matter:

* `ask` — the learner's own sentence, as they would type it.
* `claims` — a `Claim` per quantity the answer may assert: a name, an `about` regex naming the
  QUANTITY (never the number), and every value that would be right. Anything found outside that set
  is a contradiction and fails the run. `must_include` names the values that have to be among them.
* `needs_drawing` / `expect_kinds` — an empty board on a question that asked for a drawing is a
  failure, not a style choice.
* `forbid` — for the laws that say what Wobo must NOT do, such as handing the final value of x to a
  learner who is mid-working.
* `world` — the learner's own interest, when the case is testing whether the teaching reaches for
  it.

Write the truth into the case, not into the regex, and then **run the case live once and check the
claim fires on what came back**. `test_teaching_harness.py` walks `fixtures/` and fails a claim
that never matches its own recorded transcript, because a claim that matches nothing is a green
tick over an unread answer.
