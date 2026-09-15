"""The map board: a map of India is a map of India (docs/INK-FOUR.md, Correctness).

THE DEFECT THESE TESTS WERE WRITTEN FOR (the adversary, wave 58). "Draw a labelled map of India
and mark Maharashtra" drew three objects: a rectangle, the word "maharashtra" inside it, and a ring
around it. Nothing false was SPOKEN, which is why four waves of ledger checks passed it — the
honesty machinery asks whether the say matches the glass and never whether the glass answers the
question. There was no India on the glass: no coastline, no neighbour, no other state, nothing that
made the rectangle a place rather than a box, and "mark Maharashtra" has no meaning without the
thing it is marked on.

So these tests ask the question the ledger could not: is the drawing a MAP? Every state is the
bundle's own polygon, every state is where it really is relative to every other, one scale in both
directions, and the marked one is marked ON the country rather than alone in a box.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest
from wobo_gateway.board import naming, schema
from wobo_gateway.board.pipelines import FIGURE, FIGURE_UNION, TYPE_UNITS, run_intent
from wobo_gateway.board.verify import Unverified
from wobo_gateway.plexus.maps import CATALOG_IDS, region_name, region_ring
from wobo_gateway.wobo import board_intents, mock_board_plan

MAP_ASK = "Draw a labelled map of India and mark Maharashtra"

BUNDLE = json.loads(
    (
        Path(__file__).resolve().parents[3] / "apps/web-pwa/src/engines/geo/india-lite.json"
    ).read_text()
)


def mercator(lon: float, lat: float) -> tuple[float, float]:
    """The projection the client's own map engine uses (d3 geoMercator), reimplemented here so the
    test proves the drawing against geography rather than against the pipeline's own arithmetic."""
    return math.radians(lon), math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def draw(ask: str = MAP_ASK):
    intents = board_intents(ask)
    assert intents and intents[0].get("op") == "map", intents
    return run_intent(intents[0], ask=ask)


def polygons(draft) -> dict[str, dict]:
    """Every drawn polygon, by the region it is titled with — ids are minted, titles are meant.

    The title is the name a learner hears ("madhya pradesh"); the catalog id is that name's slug.
    """
    out: dict[str, dict] = {}
    for obj in draft.objects:
        if obj["kind"] == "polygon":
            out[str(obj.get("title") or obj["id"]).lower().replace(" ", "-")] = obj
    return out


def absolute(draft, obj) -> list[list[float]]:
    """A polygon's points in absolute board space (``Draft.add`` rebases them onto the anchor)."""
    origin = draft.origins.get(obj["id"]) or obj["anchor"]["board"]
    return [[origin[0] + p[0], origin[1] + p[1]] for p in obj["points"]]


def box(points: list[list[float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


# --- the drawing is a map ------------------------------------------------------------------------


def test_the_map_of_india_draws_india_and_not_one_box() -> None:
    """The finding itself: three objects, one of them a rectangle standing for a state."""
    draft = draw()
    shapes = polygons(draft)
    assert set(CATALOG_IDS) <= set(shapes), (
        f"the map drew {sorted(shapes)} — a state marked on nothing is not a map of India"
    )
    assert not [o for o in draft.objects if o["kind"] == "region"], (
        "a state is a polygon on a map, never a rectangle standing in for one"
    )


def test_every_state_is_the_bundles_own_polygon() -> None:
    """Not a drawn-from-memory outline: the same vertices the learner taps in MapScene."""
    draft = draw()
    shapes = polygons(draft)
    for rid in CATALOG_IDS:
        ring = region_ring(rid)
        assert ring is not None
        # the closing vertex is the polygon's own doing, so the drawn ring is one shorter
        assert len(shapes[rid]["points"]) == len(ring) - 1, rid


def test_every_state_sits_where_it_really_is() -> None:
    """The relationship drawn is the true one: Gujarat west of Maharashtra, Tamil Nadu south of
    Madhya Pradesh, north up. Checked over every pair, in both axes."""
    draft = draw()
    shapes = polygons(draft)
    centres: dict[str, tuple[float, float]] = {}
    true: dict[str, tuple[float, float]] = {}
    for rid in CATALOG_IDS:
        x0, y0, x1, y1 = box(absolute(draft, shapes[rid]))
        centres[rid] = ((x0 + x1) / 2, (y0 + y1) / 2)
        ring = region_ring(rid)
        assert ring is not None
        pts = [mercator(*p) for p in ring]
        true[rid] = (
            (min(p[0] for p in pts) + max(p[0] for p in pts)) / 2,
            (min(p[1] for p in pts) + max(p[1] for p in pts)) / 2,
        )
    for a in CATALOG_IDS:
        for b in CATALOG_IDS:
            if a >= b:
                continue
            east = true[a][0] - true[b][0]
            north = true[a][1] - true[b][1]
            dx = centres[a][0] - centres[b][0]
            dy = centres[a][1] - centres[b][1]
            if abs(east) > 1e-6:
                assert math.copysign(1, east) == math.copysign(1, dx), f"{a} is not east of {b}"
            if abs(north) > 1e-6:
                # board y grows downward: north is up
                assert math.copysign(1, north) == math.copysign(1, -dy), f"{a} is not north of {b}"


def test_the_map_is_drawn_at_one_scale() -> None:
    """One degree east is one length and one degree north is the same length, under one projection.
    The projectile's 2.9x vertical stretch (wave 43, defect 4) on a map is a false coastline."""
    draft = draw()
    shapes = polygons(draft)
    drawn = box([p for rid in CATALOG_IDS for p in absolute(draft, shapes[rid])])
    pts = [mercator(*p) for rid in CATALOG_IDS for p in (region_ring(rid) or ())]
    span_x = max(p[0] for p in pts) - min(p[0] for p in pts)
    span_y = max(p[1] for p in pts) - min(p[1] for p in pts)
    per_x = (drawn[2] - drawn[0]) / span_x
    per_y = (drawn[3] - drawn[1]) / span_y
    assert abs(per_x - per_y) / per_y < 0.02, f"{per_x:.1f} units per unit east, {per_y:.1f} north"


def test_the_marked_state_is_marked_on_the_country() -> None:
    """The mark IS the state's own boundary, the name is the name, and both belong to the state the
    learner asked about rather than to a box.

    Not a ring. The first rebuild ringed the state, and on the glass (the map closer, wave 58,
    390 and 1440, all three modes) the ring did two things a map may not: it crossed Gujarat,
    Madhya Pradesh and Karnataka — "nothing else is marked" — and its pad reserved the whole 24 px
    band round the state, so the placer pushed the name 28 to 30 px off the thing it names. The
    state drawn in full accent with the wash marks exactly Maharashtra and leaves the band for
    its name. ``opacity`` is absent because the renderer scales the STROKE by it too, and a
    quarter-strength accent outline is not the one hit of pigment the answer is."""
    draft = draw()
    shapes = polygons(draft)
    maharashtra = shapes["maharashtra"]
    assert not [o for o in draft.objects if o["kind"] == "ring"], (
        "a ring round a state crosses its neighbours and holds the name out of reach"
    )
    style = maharashtra.get("style", {})
    assert style.get("ink") == "accent"
    assert style.get("fill") == "wash"
    assert "opacity" not in style, "the marked state's outline is drawn at full strength"
    assert [o for o in draft.objects if o["kind"] == "label"], "a labelled map carries the name"
    named = [o for o in draft.objects if o["kind"] == "label" and o["text"] == "Maharashtra"]
    assert named, [o.get("text") for o in draft.objects if o["kind"] == "label"]
    # the name hangs off the state it names, so the client's placer keeps it within reach of it
    assert named[0]["anchor"].get("object") == maharashtra["id"]


def test_the_land_is_faint_and_the_answer_is_not() -> None:
    """A map a learner can read at a glance: the country in the faint ink, the state asked about in
    the one hit of pigment."""
    draft = draw()
    shapes = polygons(draft)
    for rid in CATALOG_IDS:
        ink = shapes[rid].get("style", {}).get("ink")
        assert ink == ("accent" if rid == "maharashtra" else "faint"), rid


def test_the_name_on_the_map_is_a_name_and_not_a_slug() -> None:
    """A learner reads "Madhya Pradesh"; "madhya-pradesh" is the catalog's id for it.

    A PLACE IS A PROPER NOUN, IN BOTH HANDS (the adversary, wave 60). The name was written
    ``.lower()`` for a board whose other writing is common nouns ("cell wall", "up-speed is zero
    here"), and the naming pass reads what the board wrote: keyless and live the transcript came
    back "Rajasthan, gujarat, maharashtra, madhya pradesh." — seven proper nouns in lower case,
    spoken by a teacher who would never write them that way. The state's own name is the bundle's
    own name, on the glass, in the title a listener hears, and in the say."""
    draft = draw("Draw a map of India and mark Madhya Pradesh")
    labels = [o["text"] for o in draft.objects if o["kind"] == "label"]
    assert labels == ["Madhya Pradesh"], labels
    assert region_name("madhya-pradesh") == "Madhya Pradesh"
    titles = {str(o.get("title")) for o in draft.objects if o["kind"] == "polygon"}
    assert titles == {region_name(r) for r in CATALOG_IDS}, titles
    # AND THE PROMPT IS A NAME TOO. "find madhya-pradesh" wrote the catalog's id on the board.
    written = [o["text"] for o in draft.objects if o["kind"] == "write"]
    assert written == ["find Madhya Pradesh"], written


# --- what the map SAYS ----------------------------------------------------------------------------


def said(ask: str = MAP_ASK) -> str:
    """The whole spoken line of the keyless turn, composed the way the wire composes it.

    ``board/stream.py`` takes the plan's say and runs ``naming.name_what_is_drawn`` over
    everything on the glass; ``wobo.mock_board_plan`` writes that say from the intent
    (``naming.opening``) or falls back to the family's line. This is those three steps and
    nothing else, so a test here fails for the same reason a learner hears the wrong sentence.
    """
    plan = mock_board_plan({"context": {"turn": {"lastUserInput": ask}}})
    objects = [
        obj
        for index, intent in enumerate(plan.get("intents") or [])
        for obj in run_intent(intent, index=index, ask=ask).objects
    ]
    line, _ = naming.name_what_is_drawn(
        plan["say"], objects, ask=str((plan.get("ask") or {}).get("prompt") or "") or None
    )
    return line


def test_the_map_says_the_state_it_marked_and_not_a_roll_call_of_the_country() -> None:
    """THE DEFECT (the adversary, wave 60, on the rebuilt map). The mark closed and the say did
    not: keyless and live the transcript read

        "Rajasthan, gujarat, maharashtra, madhya pradesh. Uttar pradesh, karnataka, kerala,
         tamil nadu. Read the labels as they land, and say which one is missing."

    Eight names over a board that writes ONE, in lower case, under an instruction to read labels
    when exactly one label lands. The country is the ground the answer stands on, not an
    inventory: a learner who is listening is owed the state they asked about and the place it
    sits in, and nothing the board never wrote.
    """
    line = said()
    assert "Maharashtra" in line, line
    strangers = [
        name
        for rid in CATALOG_IDS
        if rid != "maharashtra" and (name := region_name(rid)) and name.lower() in line.lower()
    ]
    assert not strangers, f"{strangers} named over a board that writes one name: {line!r}"
    assert "label" not in line.lower(), line
    assert len(naming.split(line)) == 1, line


def test_the_say_is_about_the_state_the_learner_asked_about() -> None:
    """Two different asks said one identical sentence before this: the roll call is the catalog's
    order, so it cannot tell Maharashtra from Madhya Pradesh."""
    assert "Madhya Pradesh" in said("Draw a map of India and mark Madhya Pradesh")


def test_the_map_never_falls_back_to_the_familys_line() -> None:
    """The bio_social family's line is "Read the labels as they land, and say which one is
    missing.", written for a diagram whose parts are all labelled. A map writes one name, so it
    makes its own first sentence, from its own intent, keyless and live alike
    (``naming.opening``)."""
    marked = board_intents(MAP_ASK)[0]
    assert "Maharashtra" in naming.in_register(naming.opening(marked, MAP_ASK))
    assert naming.in_register(naming.opening(dict(CHOROPLETH), "which state grows the most"))


def test_the_country_is_ground_and_the_say_does_not_read_it_out() -> None:
    """The mechanism, named on the object itself: a state the question is not about is the ground
    the answer stands on. It keeps its ``title``, because ``spoken.ts`` reads that title out to a
    learner who asks what is on the board, and it is not one of the parts the say runs through
    (``naming.part_name``)."""
    draft = draw()
    shapes = polygons(draft)
    for rid, shape in shapes.items():
        ground = bool((shape.get("meta") or {}).get("ground"))
        assert ground == (rid != "maharashtra"), rid
        assert shape.get("title"), rid
        assert (naming.part_name(shape) is None) == ground, rid


def test_a_mark_on_the_ground_is_still_spoken() -> None:
    """GROUND IS NOT SILENCE. The country is not read out as a list of parts; it is still what a
    mark on it is ABOUT, so a ring on Gujarat is owed Gujarat's own name and gets it from the
    shape it hangs off (``naming.mark_subject``), not from the parts pass.

    The sentence it is owed comes back as "This is the gujarat." — ``naming.as_a_sentence`` puts
    an article in front of a bare label and lower-cases its head, which is right for "wrong sign"
    and wrong for a place. Nothing on the fifty-nine turns draws that mark, so it is named here
    rather than fixed here; the subject is what this test is for.
    """
    draft = draw()
    gujarat = polygons(draft)["gujarat"]
    ring = {"id": "m1", "kind": "ring", "anchor": {"object": gujarat["id"]}}
    by_id = {str(o["id"]): o for o in [*draft.objects, ring]}
    assert naming.mark_subject(ring, by_id) == "Gujarat"
    line, _ = naming.name_what_is_drawn("Where is it?", [*draft.objects, ring])
    assert "gujarat" in line.lower(), line


def test_a_shaded_map_says_the_states_it_shaded() -> None:
    """Ground is what the question is not about, never "everything but one": on a choropleth every
    shaded state carries a name and a number, and every one of them is said."""
    draft = run_intent(dict(CHOROPLETH))
    line, _ = naming.name_what_is_drawn(
        naming.in_register(naming.opening(dict(CHOROPLETH), "which state grows the most")),
        draft.objects,
    )
    for rid in ("maharashtra", "gujarat", "kerala"):
        assert (region_name(rid) or "") in line, line
    for rid in ("rajasthan", "karnataka", "tamil-nadu"):
        assert (region_name(rid) or "").lower() not in line.lower(), line


# --- the budgets the board is held to -------------------------------------------------------------


def test_the_map_keeps_the_figure_budget() -> None:
    """Every point of every state, and every anchor, inside the union the type floor is built on."""
    draft = draw()
    slack_x = (FIGURE_UNION[0] - FIGURE[2]) / 2
    slack_y = (FIGURE_UNION[1] - FIGURE[3]) / 2
    lo_x, hi_x = FIGURE[0] - slack_x, FIGURE[0] + FIGURE[2] + slack_x
    lo_y, hi_y = FIGURE[1] - slack_y, FIGURE[1] + FIGURE[3] + slack_y
    points: list[list[float]] = []
    for obj in draft.objects:
        at = obj.get("anchor")
        if isinstance(at, dict) and "board" in at:
            points.append(list(at["board"]))
        if obj["kind"] == "polygon":
            points.extend(absolute(draft, obj))
    assert points
    for x, y in points:
        assert lo_x <= x <= hi_x, f"x={x:g} is outside the figure budget"
        assert lo_y <= y <= hi_y, f"y={y:g} is outside the figure budget"


def test_the_map_is_grammatical_and_written_at_the_boards_type_size() -> None:
    draft = draw()
    for obj in draft.objects:
        assert schema.validate_object(obj) == [], f"{obj['id']}: {schema.validate_object(obj)}"
        if obj["kind"] in ("label", "write"):
            assert obj.get("size") == TYPE_UNITS


def test_the_gateways_geometry_is_the_bundle_vertex_for_vertex() -> None:
    """The mirror is only worth having if it cannot drift from the geometry the client taps."""
    bundled = {
        f["properties"]["id"]: (
            f["properties"]["name"],
            tuple(tuple(p) for p in f["geometry"]["coordinates"][0]),
        )
        for f in BUNDLE["features"]
    }
    assert set(bundled) == set(CATALOG_IDS)
    for rid, (name, ring) in bundled.items():
        assert region_name(rid) == name
        assert region_ring(rid) == ring, rid


# --- the shaded map ------------------------------------------------------------------------------


CHOROPLETH = {
    "pipeline": "bio_social",
    "op": "map",
    "regions": ["maharashtra", "gujarat", "kerala"],
    "values": [
        {"id": "maharashtra", "value": 3},
        {"id": "gujarat", "value": 1},
        {"id": "kerala", "value": 2},
    ],
}


def test_a_shaded_map_shades_the_real_states() -> None:
    draft = run_intent(dict(CHOROPLETH))
    shapes = polygons(draft)
    assert set(CATALOG_IDS) <= set(shapes)
    for rid in ("maharashtra", "gujarat", "kerala"):
        ring = region_ring(rid)
        assert ring is not None
        assert len(shapes[rid]["points"]) == len(ring) - 1
        assert shapes[rid].get("style", {}).get("fill") == "wash"
    assert shapes["maharashtra"]["style"]["ink"] == "accent"  # the derived extreme
    by_id = {shapes[r]["id"]: r for r in ("maharashtra", "gujarat", "kerala")}
    values = {
        by_id[o["anchor"]["object"]]: o["value"]
        for o in draft.objects
        if o["kind"] == "number" and o["anchor"].get("object") in by_id
    }
    assert values == {"maharashtra": 3.0, "gujarat": 1.0, "kerala": 2.0}
    # every shaded state is named on the map, so a number is read with the state it belongs to
    labels = {o["text"] for o in draft.objects if o["kind"] == "label"}
    assert labels == {"Maharashtra", "Gujarat", "Kerala"}


def test_the_receipt_says_what_actually_ran() -> None:
    """The ledger claimed "shading with one extreme" on a map with no shading at all — a receipt
    for a check that did not happen is the same hole the finding came through."""
    marked = [c for c in draw().ledger.checks if c.name == "board.map_scene"]
    assert marked and marked[0].passed
    assert "shading" not in (marked[0].detail or "")
    assert "maharashtra" in (marked[0].detail or "")
    shaded = [c for c in run_intent(dict(CHOROPLETH)).ledger.checks if c.name == "board.map_scene"]
    assert shaded and "shaded" in (shaded[0].detail or "")


# --- what is still refused ------------------------------------------------------------------------


@pytest.mark.parametrize(
    "intent,because",
    [
        ({"pipeline": "bio_social", "op": "map", "regions": []}, "a map needs regions"),
        ({"pipeline": "bio_social", "op": "map", "regions": ["narnia"]}, "not one I can prove"),
        (
            {
                "pipeline": "bio_social",
                "op": "map",
                "regions": ["kerala"],
                "values": [{"id": "kerala", "value": 1}],
            },
            "not one I can prove",
        ),
    ],
)
def test_a_map_it_cannot_prove_is_still_refused(intent: dict, because: str) -> None:
    with pytest.raises(Unverified) as raised:
        run_intent(intent)
    assert because in str(raised.value)
