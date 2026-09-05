# The doubt solver — the wire, and the laws the learner side holds it to

Owner, 2026-09-05: "when the students are using their phones or computers or tabs, they can
upload or take a photo of their book or whatever they have a doubt about and wobo can annotate on
that and explain as well." And on the first brief: "it shouldnt just draw on the image, it should
explain while drawing on that photo."

Two halves, one wire. The gateway half is `services/gateway/src/wobo_gateway/doubt.py` (with
migration `0021_doubts.sql` and the sweep in `memory.py`); the learner half is
`apps/web-pwa/src/screens/doubt` and `apps/web-pwa/src/wobo/doubt-surface.ts`. This page is what
the learner side speaks and tests against. Nothing in the client names a model or holds a key.

## 1. Reading the page — `POST /v1/doubt`

The one place the product uses vision. The client sends the bytes and their type, the learner's
words if they typed any, and the board they follow so the gateway can file the doubt (law 4):

```json
{ "image": { "data": "<base64>", "mediaType": "image/jpeg" }, "words": "", "framework_id": "cbse" }
```

The image is downscaled on the device to a 1600 px longest edge and re-encoded as JPEG, upright
(EXIF honoured), before it leaves; bigger than 12 MB is refused on the device. The gateway bounds,
strips and SCREENS it again before reading or keeping anything (law 2): a face, another child's
name, an address, a live exam paper come back as a refusal with `{ "code", "message" }`, and the
client shows the message and keeps nothing, not even in memory.

The reply is `Doubt.as_dict()` plus Wobo's line:

```json
{
  "doubt": "d9f3a1b2",
  "created_at": "2026-09-05T09:00:00Z",
  "status": "read",
  "words": "",
  "say": "I read this as: 3x + 5 = 20; Solve for x. Is that right? Fix anything I got wrong first.",
  "reading": {
    "subject": "Mathematics",
    "topic": "linear equations",
    "question": "Solve 3x + 5 = 20 for x.",
    "lines": [
      { "id": "r1", "text": "3x + 5 = 20",  "box": [0.09, 0.20, 0.55, 0.275] },
      { "id": "r2", "text": "Solve for x.", "box": [0.09, 0.30, 0.40, 0.34] },
      { "id": "r3", "text": "a line with no place", "box": null }
    ],
    "width": 1200, "height": 1600
  },
  "climb": { "node_id": "00000000-0000-7000-8000-…", "node_name": "Linear equations", "framework_id": "cbse" }
}
```

- `lines` are SHOWN to the learner before anything is computed, one input each, under the
  gateway's own ids ("I read this as …. Is that right?"). Law 1.
- `box` is `[x0, y0, x1, y1]` in fractions of the upright page. A line with a box becomes a
  registry target with that exact id on the surface `doubt:<id>`; a line with `null` stays text
  the learner can correct and is never a target. A box off the page is dropped by the client, the
  line kept. Ink circles a line (`kind: "circle"` with a `pad`); it never points at a pixel. Law 3.
- `climb.node_id` is `topic_node_uuid(topic.id)`, the same id the app keys evidence by, so the
  client places the doubt on the learner's map and scheduler under that topic; with no board it
  asks the learner where it belongs.

## 2. Explaining — `POST /v1/doubt/{id}/answer` with `Accept: text/event-stream`

The same frames as every board turn (`docs/BOARD.md` §4: say, ink, action, ask, card, done, in
order), from the doubt's own door. The gateway composes the packet itself from the photo it read;
the client sends only the learner's corrections, by line id (an emptied line leaves), and their
words:

```json
{ "lines": [{ "id": "r1", "text": "3x + 5 = 26" }, { "id": "r2", "text": "Solve for x." }], "words": "I do not get how the 5 moves across" }
```

On the client this is the ordinary conductor (`wobo/board-turn.ts`) with two optional fields on
the stream call, `endpoint` and `body` (`wobo/board-stream.ts`); the transcript, the voice, the
surface choice and the interrupt are the ones every board turn has. Ink anchored to a line
(`{ "anchor": { "target": "r2" } }`) lands on the photo through the registry, pinned to the
screen by the conductor's own rule; a shape in board space opens the plane, which is the only
time the board opens.

**What comes back is held to the owner's law.** Every ink frame anchored to a line of the photo
must land inside the window of a say frame: `say.t <= ink.t <= say.t + say.dur`. Stroke by
sentence. The client replays this fixture through the real parser and holds it to `checkBeats`:

```
say  t=0     dur=2400  "I read this as 3x plus 5 equals 20. Look at the five first."
ink  t=300   circle → r2
say  t=2400  dur=2400  "It moves to the other side and becomes minus five."
ink  t=2700  circle → r3
say  t=4800  dur=2200  "So three x is fifteen, and x is five."
ink  t=5000  circle → r1
done         objects=3
```

"All the ink, then a paragraph" fails the check. "A paragraph, then all the ink" fails the check.
`doubt.py`'s `DoubtShaper` beats each object to its sentence on the way out; `checkBeats` in
`wobo/doubt-surface.ts` is the same arithmetic on the way in, and `tests/doubt.spec.ts` samples the
rendered order from the DOM.

## 3. The memory page — `GET /v1/doubt`, `GET /v1/doubt/{id}/photo`, `DELETE /v1/doubt/{id}`

The device keeps a listing only (`wobo-doubts-v1`, account-scoped, swept with every `wobo-` key):
never the bytes. The memory page takes the gateway's list as the truth when it answers, shows the
picture the gateway kept, and its Remove sends the delete BEFORE it forgets the device copy,
queueing (`wobo-doubts-erase-v1`) any delete the network refused and retrying on the next visit.
`DELETE` takes the row and the object in the bucket; `POST /v1/me/erase` sweeps both
(`memory.py`). The erasure register (`packages/sdk/src/supabase.ts`) records the reach as `gateway`.

## 4. What the learner side proves (real output, `apps/web-pwa`)

- `bun test src/wobo/doubt-surface.test.ts src/screens/doubt` — lines map through zoom, rotation
  and resize as live registry targets under the gateway's ids; off-page strokes are measured; the
  beat law passes a conforming answer and fails both failure shapes over the real SSE parser at the
  answer door; the reading gates Explain line by line; a refusal keeps the gateway's line and no
  bytes; the store is account-keyed, byte-free, reconciled to the gateway's list, and its remove
  reaches the server; the doubt is placed on the map, scheduled to come back, and counted by the
  re-teach ladder.
- `bunx playwright test --config tests/doubt.config.ts` — the whole flow in a browser at 390, 834
  and 1440, both themes, against a gateway answered in the browser on the routes above: the taps
  are counted, the order the explanation arrives in is sampled from the DOM, every stroke is
  measured against the photo's box as it lands, and the memory page's Remove is seen to send the
  delete first.

## 5. The fixer's pass, 2026-09-05

What changed on both halves, each held by a test that failed before it:

- **The reader's `question` is never the learner's words.** It is not shown and cannot be
  corrected, so it could carry a misread digit the learner had fixed. The gateway builds the turn
  from the corrected lines alone (`canvas.equation` is the first corrected line); the client's
  prompt is the learner's own words, or "Explain this to me: <first line as corrected>". The
  `question` still comes back in the reading, for placement and the memory page, and nothing
  else.
- **The learner has words.** A textarea on the confirm step ("Anything to tell me?") rides the
  answer as `words`, bounded to 500 characters. The turn is asked that, not the question vision
  chose.
- **A line is 200 characters on both sides** (`MAX_LINE_CHARS`, api.ts and doubt.py). The
  gateway takes up to 400 and clips; past that it answers `{code: "bad_request", message}` in
  Wobo's voice, never FastAPI's `detail`.
- **Signed in before the shutter.** `doorFor(account)` (flow.ts): an anonymous session meets the
  entry as a button to sign in and the capture screen as a sign-in card, so no photo travels
  before the gateway's 403.
- **Any script.** The topic matcher on both sides tokenises Unicode words (a Devanagari vowel
  sign stays with its letter), so a Hindi page matches a Hindi syllabus node and two Hindi doubts
  are two nodes. When nothing matches, the chips offered are ranked for THIS doubt
  (`suggestTopics`): words in common first, then topics already started, never the first eight
  of the world.
- **The printed caption follows the beat** (`caption.ts`). The runtime feeds each say frame with
  its `t`; the screen prints a sentence when it is spoken. With the sound off the words and the
  strokes still arrive together. A plan with ink and no words draws nothing (the gateway refuses
  the marks and says so in `done.refused`).
- **Figures are lines.** The reader is told a diagram, graph or table is one line whose text is
  `[figure: ...]`, so a page that is only a diagram can be asked about; and a photo that is not
  schoolwork gets its own line, not one about a person.
- **What `offPageStrokes` measures is containment**, not correctness: a mark inside the photo.
  Whether a box sits on the right line is checked by nobody but the learner on the confirm step.
- **The harness measures it.** `services/gateway/harness` has a doubt case
  (`doubt.cbse.8.linear-photo`) that goes through both doors and reads the `off the page` count
  and the beat law off the wire. Its recorded fixture is keyless and says so.
