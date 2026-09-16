"""TIER TWO OF THE PUBLIC CHAPTER PAGES, frozen to one file the website is BUILT from.

``curriculum/snapshot.py`` freezes the syllabus itself: the board's chapters, its topics and the
provenance behind each. That is tier one, it is live, and it is honest and plain
(docs/GROWTH-SEARCH.md §4). This module freezes the half nobody else in this market has.

**What tier two is.** One chapter page, for one topic the board itself published under that
chapter, carries:

  · **the concept's own explanation** — the ``idea`` and the ``why`` out of the concept core, which
    is the same core a learner's lesson is rendered from. Not a summary written for a search
    engine: the thing the tutor teaches from, shown plainly;
  · **an original figure** drawn for that concept by the same pipeline that draws for a learner
    (``plexus.engines`` ``engine.diagram``). Not one competitor page in this category carries an
    original explanatory figure at all (docs/GROWTH-SEARCH.md §1), and ours is generated per
    concept rather than chosen from a library, so an electrostatics page carries a field diagram
    and a French Revolution page a timeline;
  · **three questions**, taken word for word out of the concept's own check and its own two
    misconceptions. Nothing is written here. The frame around a misconception is a question mark;
    everything a reader reads is the core's own sentence.

**Why it is frozen rather than fetched.** The same reason the syllabus is (``snapshot.py``): the
site is BUILT. A page that read this over the network would ship empty the first time a service was
slow, and the count we published would be whatever the network returned, which is what the
honest-count law forbids (WOBO-TASKS §10.21). Frozen, a chapter page costs a visitor nothing: the
explanation is bytes in a file that was written once.

**Why a page can be at tier one on Monday and tier two on Friday, and never the other way.** A
chapter with no core in the cache is simply absent from this file, and its page renders exactly as
it does today, claiming nothing it does not have. That is the rule this whole module exists to
keep: *a tier one page never implies it has an explanation it does not have* (§6).

**The pace is a person's act, and it is recorded.** :func:`merge` adds at most :data:`LIMIT`
chapters per run and never removes one, so publishing tier two is: run the command, read the
figures it wrote, commit them. There is no path in here that publishes 171 pages in one night, and
there is none that quietly unpublishes a page somebody is reading because a laptop's cache was
cold.

Run: ``uv run python -m wobo_gateway.curriculum.explained`` (add ``--limit N`` to change the pace,
``--dry-run`` to see what would ship and why the rest would not).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from wobo_gateway.curriculum import public
from wobo_gateway.curriculum.public import Entry, Tree
from wobo_gateway.plexus import sanitize, store

#: Where the website reads it. One committed file, imported by the chapter page family.
DEFAULT_OUT = (
    Path(__file__).resolve().parents[5]
    / "apps"
    / "web-pwa"
    / "src"
    / "screens"
    / "syllabus"
    / "explained.json"
)

#: Where the figures land. Real files under the app's ``public/``, so the figure a reader sees and
#: the figure the ``ImageObject`` markup names are the same bytes at the same address, and a
#: reviewer can open one before it ships.
FIGURES_DIR = (
    Path(__file__).resolve().parents[5] / "apps" / "web-pwa" / "public" / "learn" / "figures"
)

#: The URL prefix those files answer at, which is their path under ``public/``.
FIGURES_URL = "/learn/figures"

#: Bumped when the shape below changes, so a website built against an older shape says so loudly
#: rather than rendering a page with holes in it.
SHAPE = 1

#: How many chapters one run may ADD. The measured pace of docs/GROWTH-SEARCH.md §4, as a number.
#: Small on purpose: every figure in a run is meant to be looked at by a person before it ships,
#: and a number nobody can review in a sitting is a number that gets rubber-stamped.
LIMIT = 12

#: The judge's score a core must clear to be READ BY A STRANGER.
#:
#: ``plexus.validate.PASS_THRESHOLD`` is 70 and that is the bar for serving a lesson to a learner
#: who asked for it, inside a session that can re-teach, escalate and try again. A public page is
#: none of those things: it is permanent, it is read by people who never asked us anything, and
#: nothing follows it. So the bar here is a clear pass rather than a bare one.
JUDGE_FLOOR = 80.0

#: The depth bands, and the classes in each (docs/CONTENT-INTERACTION.md §5b). Read from the class
#: the page is for, never invented, and never widened: a core written for one band may not be shown
#: to a reader in another.
BANDS: tuple[tuple[str, int, int], ...] = (
    ("foundation", 1, 5),
    ("middle", 6, 8),
    ("senior", 9, 12),
)

_CLASS_NUMBER = re.compile(r"(\d{1,2})")

#: The models that are not a hand. ``seed`` is the topic-agnostic placeholder and ``mock`` is the
#: keyless test painter; either one on a public page is a claim to have drawn something we did not.
_NOT_A_HAND = {"", "seed", "mock", "core-render"}


#: The site's own floors for a chapter page (``apps/web-pwa/src/screens/syllabus/tree.ts``,
#: ``hasPage``): at least this many topics whose names are not the chapter's own, and at least this
#: many words of its own in the chapter's name and those topics' names. A chapter under them has no
#: page, so tier two is not written for it: the run's allowance goes to pages a reader can reach.
OWN_TOPIC_FLOOR = 3
OWN_WORD_FLOOR = 15
_A_WORD = re.compile(r"[^\W_]")


def has_page(chapter: Entry) -> bool:
    """Does the site write a page for this chapter? The same rule as the website's ``hasPage``."""
    if not chapter.publishable or not chapter.children:
        return False
    own = [
        topic.name
        for topic in chapter.children
        if topic.name.strip().lower() != chapter.name.strip().lower()
    ]
    if len(own) < OWN_TOPIC_FLOOR:
        return False
    words = [w for w in " ".join([chapter.name, *own]).split() if _A_WORD.search(w)]
    return len(words) >= OWN_WORD_FLOOR


def band_of(level_name: str) -> str | None:
    """The depth band a class sits in, or ``None`` when the level carries no number.

    Pure, offline and testable, which is what docs/CONTENT-INTERACTION.md §5b asks of the band
    resolver. A level with no number in it ("Foundation", "Senior Secondary") has no band here and
    therefore asks for no core: guessing one would be the borrowing that section forbids.
    """
    found = _CLASS_NUMBER.search(level_name or "")
    if not found:
        return None
    number = int(found.group(1))
    for name, low, high in BANDS:
        if low <= number <= high:
            return name
    return None


# --- the three questions --------------------------------------------------------------------------


def _tidy(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _as_asked(belief: str) -> str:
    """A misconception, as a question, with NOTHING added to it.

    The belief is the core's own sentence, written in the words learners actually use. The only
    thing this puts around it is a question: the first letter is lowered where lowering it is safe
    (never on an acronym or a proper noun, which would misspell somebody's word), and a full stop
    at the end becomes the question mark.
    """
    text = _tidy(belief).rstrip(".")
    if not text:
        return ""
    head = text[0]
    rest = text[1:]
    # "Light always bends" lowers; "Newton's third law holds" and "DNA is a protein" do not.
    if head.isupper() and not rest[:1].isupper() and rest.split(" ", 1)[0].islower():
        text = head.lower() + rest
    return f"Is it true that {text}?"


def questions(core: dict[str, Any] | None) -> list[dict[str, str]] | None:
    """The three questions a chapter page asks, or ``None`` when the core cannot supply them.

    The core's own check first, because it is the one question the core says proves the idea is
    held rather than recalled. Then one per misconception, each answered by that misconception's
    own counter-example. Two misconceptions is the core schema's own floor
    (``engines._verify_core``), so a core carrying one is a core that is not what it claims to be
    and half a set of questions is worse than none.
    """
    if not isinstance(core, dict):
        return None
    check = core.get("check") if isinstance(core.get("check"), dict) else {}
    first_q = _tidy((check or {}).get("question"))
    first_a = _tidy((check or {}).get("answer"))
    if not first_q or not first_a:
        return None
    out = [{"q": first_q, "a": first_a}]
    wrong = core.get("misconceptions")
    if not isinstance(wrong, list) or len(wrong) < 2:
        return None
    for item in wrong[:2]:
        if not isinstance(item, dict):
            return None
        asked = _as_asked(item.get("belief", ""))
        answer = _tidy(item.get("counter"))
        if not asked or not answer:
            return None
        out.append({"q": asked, "a": answer})
    return out


# --- the figure -----------------------------------------------------------------------------------

_VIEWBOX = re.compile(r'viewBox\s*=\s*["\']\s*([-\d.]+)[,\s]+([-\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)')

#: The seed diagram, in one line: two circles labelled "idea" and "effect" with an arrow between
#: them, drawn identically for every concept in the catalogue (``engines._seed_diagram``). It is a
#: correct placeholder inside a lesson and a lie on a public page, so it is named here and refused.
_SEED_MARKS = (">idea<", ">effect<")


def figure_of(record: dict[str, Any] | None, *, concept: str, name: str) -> dict[str, Any] | None:
    """One drawn figure, ready to be written as a file, or ``None`` where there is not one.

    What is refused, and why each:

      · **a seeded figure** — the same two labelled circles for every concept. 171 pages carrying
        one picture is exactly the thin page docs/GROWTH-SEARCH.md §5 rules out, and it also claims
        a drawing for this concept that nobody made;
      · **a figure no model drew** — ``mock`` and ``seed`` are the keyless painters that let tests
        and a laptop run without a network. Neither is a hand;
      · **a figure that does not sanitize** — the same rule the learner's board lives under
        (``plexus.sanitize``): an ``<svg>`` root with a ``viewBox``, no scripts, no foreign
        objects. A public page is the last place to relax it;
      · **a figure with no viewBox** — it has no size, so a page cannot reserve its space and the
        layout shifts under the reader as it loads.

    The ``alt`` is the board's own name for the topic and nothing else. It is deliberately not a
    description of the drawing: nobody has read this drawing, and a caption written from a filename
    would be an invention. What the figure shows is said in words directly beneath it, in the
    core's own paragraph, so a reader who cannot see it loses nothing.
    """
    if not isinstance(record, dict):
        return None
    if record.get("seeded"):
        return None
    model = str((record.get("provenance") or {}).get("model") or "").strip().lower()
    if model in _NOT_A_HAND:
        return None
    svg = record.get("artifact")
    if not isinstance(svg, str) or not svg.strip():
        return None
    if any(mark in svg for mark in _SEED_MARKS):
        return None
    clean = sanitize.sanitize_svg(svg)
    if not clean:
        return None
    box = _VIEWBOX.search(clean)
    if not box:
        return None
    width = round(float(box.group(3)))
    height = round(float(box.group(4)))
    if width <= 0 or height <= 0:
        return None
    digest = hashlib.sha256(clean.encode("utf-8")).hexdigest()[:12]
    return {
        "file": f"{concept}--{digest}.svg",
        "svg": clean,
        "width": width,
        "height": height,
        "alt": _tidy(name),
    }


# --- the gate -------------------------------------------------------------------------------------

#: Every way a chapter can fail to reach tier two, as the words the console prints. A reason is
#: never "quality"; it is always the one thing that was wrong, so a tally of a run reads as a list
#: of what to go and fix.
REFUSALS = (
    "no_core",
    "stale",
    "no_band",
    "other_band",
    "not_canonical",
    "unjudged",
    "below_the_bar",
    "em_dash",
    "no_questions",
    "no_figure",
)


def _walk_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [s for item in value for s in _walk_strings(item)]
    if isinstance(value, dict):
        return [s for item in value.values() for s in _walk_strings(item)]
    return []


def refusals(
    core: dict[str, Any] | None, figure: dict[str, Any] | None, *, band: str | None
) -> list[str]:
    """Why this chapter does not reach tier two, or an empty list when it does.

    A refusal is not a failure to be worked around. The whole design of this family is that a page
    that cannot honestly carry an explanation carries none, so every branch in here ends in the
    page staying exactly as good as it already is.
    """
    if not isinstance(core, dict):
        return ["no_core"]
    out: list[str] = []
    if store.core_is_stale(core):
        out.append("stale")
    # docs/CONTENT-INTERACTION.md §5b. A core that does not say which band it was written for is
    # not KNOWN to be written for this reader, and the section's own rule is that borrowing across
    # a band is not expressible. Silence is not permission.
    written_for = str(core.get("band") or "").strip()
    if not band or not written_for:
        out.append("no_band")
    elif written_for != band:
        out.append("other_band")
    if str(core.get("status") or store.CANONICAL) != store.CANONICAL:
        out.append("not_canonical")
    judge = (core.get("provenance") or {}).get("judge")
    score = (judge or {}).get("score") if isinstance(judge, dict) else None
    if not isinstance(score, int | float):
        out.append("unjudged")
    elif float(score) < JUDGE_FLOOR:
        out.append("below_the_bar")
    # docs/copy/voice.md §3: nothing a person reads carries an em dash, and every word that gets
    # past this gate is read by a person on a public page.
    if any("—" in text for text in _walk_strings(core)):
        out.append("em_dash")
    if questions(core) is None:
        out.append("no_questions")
    if not isinstance(figure, dict):
        out.append("no_figure")
    return out


# --- walking the syllabus -------------------------------------------------------------------------


def _path_of(board: Entry, level: Entry, subject: Entry, chapter: Entry) -> str:
    return f"/learn/{board.slug}/{level.slug}/{subject.slug}/{chapter.slug}"


def candidates(tree: Tree | None = None) -> tuple[list[dict[str, Any]], Counter[str]]:
    """Every chapter that could carry tier two today, and a tally of why the rest cannot.

    THE TOPIC A PAGE EXPLAINS IS THE BOARD'S OWN, and it is the first one under the chapter whose
    concept has a core and a figure, in the board's own order. We do not choose which idea leads a
    chapter; the board already did, by publishing its topics in an order. On ICSE and ISC, which
    give us a unit and nothing under it, there is no topic, so there is no tier two and the page
    stays what it is: the unit, the document and the hash (docs/GROWTH-SEARCH.md §3).
    """
    tree = tree or public.build_tree()
    found: list[dict[str, Any]] = []
    why: Counter[str] = Counter()
    for board in tree.boards:
        for level in board.children:
            band = band_of(level.name)
            for subject in level.children:
                for chapter in subject.children:
                    if not chapter.children:
                        why["no_topic"] += 1
                        continue
                    if not has_page(chapter):
                        why["too_few_topics"] += 1
                        continue
                    entry = _first_explainable(board, level, subject, chapter, band=band, why=why)
                    if entry is not None:
                        found.append(entry)
    return found, why


def _first_explainable(
    board: Entry,
    level: Entry,
    subject: Entry,
    chapter: Entry,
    *,
    band: str | None,
    why: Counter[str],
) -> dict[str, Any] | None:
    reasons: list[str] = []
    if band is None:
        # A level with no number in it has no band, and a page with no band asks for no core
        # (docs/CONTENT-INTERACTION.md §5b). Asking the store anyway would let its resolver pick a
        # band for us, which is the guess that section forbids.
        why["no_band"] += 1
        return None
    for topic in chapter.children:
        scope = {"subject": subject.name, "chapter": chapter.name}
        concept = store.concept_id(topic.name, scope)
        # THE BAND IS THE PAGE'S OWN CLASS, named to the store outright. The core key is
        # ``concept x band`` (docs/CONTENT-INTERACTION.md §5b) and the store resolves the band
        # from a request's grade when nobody names one; a chapter page has no request and no
        # learner, only the class it is published under, so the band is read from that class
        # (:func:`band_of`) and handed over as the key's own argument. A core written for another
        # band is then unreachable by construction, which is the section's prohibition.
        core = store.load_core(topic.name, scope, band=band)
        drawn = store.load(topic.name, "diagram", "core", scope)
        figure = figure_of(drawn, concept=concept, name=topic.name)
        refused = refusals(core, figure, band=band)
        if refused:
            reasons.extend(refused)
            continue
        asked = questions(core)
        if asked is None or figure is None or not isinstance(core, dict):
            reasons.append("no_questions")
            continue
        return {
            "path": _path_of(board, level, subject, chapter),
            "topic": topic.slug,
            "name": topic.name,
            "concept": concept,
            "band": band,
            "idea": _tidy(core["idea"]),
            "why": _tidy(core["why"]),
            "questions": asked,
            "figure": {k: v for k, v in figure.items() if k != "svg"},
            "svg": figure["svg"],
        }
    # One chapter is one line in the tally, named by the FIRST thing that stopped it, so a run
    # reads as "212 chapters have no core yet" rather than as 711 topic-shaped refusals.
    why[reasons[0] if reasons else "no_topic"] += 1
    return None


def merge(
    standing: list[dict[str, Any]], fresh: list[dict[str, Any]], *, limit: int = LIMIT
) -> list[dict[str, Any]]:
    """What the file holds after a run: everything it already held, plus at most ``limit`` more.

    Nothing is ever removed. A page that is live and being read does not vanish because the machine
    somebody ran the command on had a cold cache, and a run on a laptop can never unpublish what a
    run on the platform published. Removing a page is a deliberate act: delete its line.
    """
    held = {entry["path"] for entry in standing}
    out = list(standing)
    for entry in fresh:
        if len(out) - len(standing) >= limit:
            break
        if entry["path"] in held:
            continue
        held.add(entry["path"])
        out.append(entry)
    return out


# --- the file -------------------------------------------------------------------------------------


def read(path: Path | None = None) -> dict[str, Any]:
    """What is published today. An absent or unreadable file is an empty family, never a guess."""
    target = path or DEFAULT_OUT
    try:
        data = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"shape": SHAPE, "chapters": []}
    if not isinstance(data, dict) or data.get("shape") != SHAPE:
        return {"shape": SHAPE, "chapters": []}
    chapters = data.get("chapters")
    return {"shape": SHAPE, "chapters": chapters if isinstance(chapters, list) else []}


def render(data: dict[str, Any]) -> str:
    """The file's bytes. Stable key order and one trailing newline, so a run that changed nothing
    produces a file that changed nothing and the diff is only ever a page arriving."""
    return json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True) + "\n"


def write(
    out: Path | None = None,
    figures: Path | None = None,
    tree: Tree | None = None,
    *,
    limit: int = LIMIT,
) -> tuple[Path, list[dict[str, Any]], Counter[str]]:
    """Freeze what passes, write the figures it names, and leave everything else at tier one."""
    target = out or DEFAULT_OUT
    art = figures or FIGURES_DIR
    fresh, why = candidates(tree)
    standing = read(target)["chapters"]
    kept = merge(standing, fresh, limit=limit)
    art.mkdir(parents=True, exist_ok=True)
    by_path = {entry["path"]: entry for entry in fresh}
    for entry in kept:
        drawn = by_path.get(entry["path"])
        if drawn is None:
            continue  # already published on an earlier run; its file is already on disk
        (art / drawn["figure"]["file"]).write_text(drawn["svg"], encoding="utf-8")
    body = {
        "shape": SHAPE,
        "stamp": (tree or public.build_tree()).stamp,
        "written": datetime.now(UTC).strftime("%Y-%m-%d"),
        "chapters": [{k: v for k, v in entry.items() if k != "svg"} for entry in kept],
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(render(body), encoding="utf-8")
    return target, kept, why


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Freeze tier two of the public chapter pages: the explanation, the figure "
        "and the three questions, for the chapters whose concept core has landed."
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--figures", type=Path, default=FIGURES_DIR)
    parser.add_argument("--limit", type=int, default=LIMIT, help="how many chapters this run adds")
    parser.add_argument("--dry-run", action="store_true", help="say what would ship, write nothing")
    args = parser.parse_args(argv)
    if args.dry_run:
        fresh, why = candidates()
        standing = {entry["path"] for entry in read(args.out)["chapters"]}
        new = [entry for entry in fresh if entry["path"] not in standing]
        print(f"tier two: {len(standing)} published, {len(new)} ready, {args.limit} per run")
        for entry in new[: args.limit]:
            print(f"  + {entry['path']}  {entry['name']}  ({entry['band']})")
        for reason, count in why.most_common():
            print(f"  {count:>5} chapters held back: {reason}")
        return 0
    path, kept, why = write(args.out, args.figures, limit=args.limit)
    print(f"tier two: {path}")
    print(f"  {len(kept)} chapter page(s) carry an explanation, a figure and three questions")
    for reason, count in why.most_common():
        print(f"  {count:>5} at tier one: {reason}")
    return 0


if __name__ == "__main__":  # pragma: no cover - a command, not a code path
    raise SystemExit(main())
