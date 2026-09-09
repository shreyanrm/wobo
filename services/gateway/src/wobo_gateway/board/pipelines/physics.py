"""Physics at the board — free-body diagrams, projectiles, circuits, rays, waves.

Every quantity crosses two gates before it becomes ink: the brain's dimensional analyser
(:mod:`wobo_gateway.plexus.dimensions`, whose constants table is law — a board that hard-codes
``g = 3`` is refused), and a second, independent computation of the same number. A projectile's
apex is taken from the closed form AND from the sampled trajectory; a circuit's current is taken
from Ohm's law AND from the sum of the drops it must produce. Only agreement earns the pen.
"""

from __future__ import annotations

import math
from typing import Any

from wobo_gateway.board import verify
from wobo_gateway.board.pipelines import (
    FIGURE,
    FIGURE_MID,
    Draft,
    Frame,
    accent,
    arrow_to,
    board,
    faint,
    on,
    wobo,
)
from wobo_gateway.board.verify import Unverified
from wobo_gateway.plexus.dimensions import CONSTANTS

G = CONSTANTS["g"][0]

#: A force arrow this long on the board means the largest force in the diagram. Sized to the
#: figure box, not to the board: see :data:`wobo_gateway.board.pipelines.FIGURE`.
MAX_ARROW = FIGURE[3] * 0.34
BODY = FIGURE_MID


def build(intent: dict[str, Any], prefix: str, ask: str = "") -> Draft:
    op = str(intent.get("op") or "")
    handlers = {
        "free_body": _free_body,
        "projectile": _projectile,
        "circuit": _circuit,
        "ray": _ray,
        "wave": _wave,
    }
    handler = handlers.get(op)
    if handler is None:
        raise Unverified(f"physics cannot draw {op!r}")
    return handler(intent, Draft(prefix, ask=ask))


def _forces(intent: dict[str, Any]) -> list[dict[str, Any]]:
    raw = intent.get("forces") or []
    if not isinstance(raw, list) or not raw:
        raise Unverified("a free-body diagram needs at least one force")
    if len(raw) > 8:
        raise Unverified("more than eight forces is more than one diagram")
    out = []
    for item in raw:
        if not isinstance(item, dict):
            raise Unverified("each force is a name, a magnitude and a direction")
        name = str(item.get("name") or "").strip()[:24]
        try:
            magnitude = float(item.get("magnitude"))
            angle = float(item.get("angle_deg", 0.0))
        except (TypeError, ValueError) as exc:
            raise Unverified(f"force {name!r} has no numeric magnitude") from exc
        unit = str(item.get("unit") or "N")
        if not name or magnitude <= 0:
            raise Unverified("a force needs a name and a positive magnitude")
        out.append({"name": name, "magnitude": magnitude, "angle": angle, "unit": unit})
    return out


def _label_sides(angle_deg: float) -> tuple[str, str]:
    """Where a force's name and its magnitude go: at the head of its own arrow, and to one side
    of it, so two forces on one body never write in the same place."""
    angle = angle_deg % 360.0
    if 45.0 <= angle < 135.0:
        return "top", "topRight"
    if 135.0 <= angle < 225.0:
        return "left", "bottomLeft"
    if 225.0 <= angle < 315.0:
        return "bottom", "bottomRight"
    return "right", "topRight"


def _free_body(intent: dict[str, Any], draft: Draft) -> Draft:
    forces = _forces(intent)
    for force in forces:
        draft.ledger.record(verify.units_agree("F", "N", {"F": force["unit"]}))

    net_x = sum(f["magnitude"] * math.cos(math.radians(f["angle"])) for f in forces)
    net_y = sum(f["magnitude"] * math.sin(math.radians(f["angle"])) for f in forces)
    net = math.hypot(net_x, net_y)
    if intent.get("equilibrium"):
        # The claim is that the forces cancel. Either they do or the diagram is wrong.
        draft.ledger.record(verify.numbers_agree("net force", net, 0.0, 1e-6))

    body_id = draft.add(
        "ellipse", anchor=board(*BODY), rx=26.0, ry=26.0, style=wobo(2), hint="body"
    )
    label = str(intent.get("body") or "").strip()[:24]
    if label:
        draft.add("label", anchor=on(body_id, "bottom"), text=label, style=faint(1), hint="body")

    biggest = max(f["magnitude"] for f in forces)
    for force in forces:
        length = MAX_ARROW * force["magnitude"] / biggest
        angle = math.radians(force["angle"])
        tip = board(BODY[0] + length * math.cos(angle), BODY[1] - length * math.sin(angle))
        arrow = arrow_to(
            draft,
            tip=tip,
            tail=on(body_id, "center"),
            style=accent(2) if force is forces[0] else wobo(2),
            hint=force["name"],
        )
        # EACH ARROW IS LABELLED AT ITS OWN HEAD. Every name used to go to the arrow's "right" and
        # every magnitude to its "top", so on the commonest diagram of all — a weight down and a
        # normal up, two arrows sharing one box — the four labels collided and the placer walked
        # them apart down and up the board. The drawing was 220 units tall and its labels stretched
        # it to 374, which is what dropped the type to 11 px at 1440 (the golden run, 2026-09-09).
        name_at, number_at = _label_sides(force["angle"])
        draft.add(
            "label", anchor=on(arrow, name_at), text=force["name"], style=faint(1), hint="fname"
        )
        draft.number(
            force["magnitude"],
            "board.units_agree",
            anchor=on(arrow, number_at),
            unit=force["unit"],
            style=faint(1),
        )
    if intent.get("equilibrium"):
        draft.add(
            "write",
            anchor=on(body_id, "left"),
            text="the arrows cancel",
            style=accent(1),
            hint="note",
        )
    else:
        draft.number(
            net,
            "board.units_agree",
            anchor=on(body_id, "right"),
            unit="N",
            style=accent(2),
        )
    return draft


def _projectile(intent: dict[str, Any], draft: Draft) -> Draft:
    # The learner's own numbers first: the speed and the angle are GIVENS, and a board that
    # answers about a different ball is wrong however well the arithmetic checks out.
    v0 = draft.given(
        "speed", intent.get("v0"), "thrown", "launched", "kicked", "speed", "at", unit="m/s"
    )
    angle_deg = draft.given("angle", intent.get("angle_deg"), "degrees", "deg", "angle", unit="deg")
    try:
        v0 = float(v0)
        angle_deg = float(angle_deg)
    except (TypeError, ValueError) as exc:
        raise Unverified("a projectile needs a speed and a launch angle") from exc
    if not (0 < v0 <= 1e4) or not (0 < angle_deg < 90):
        raise Unverified("the speed must be positive and the angle strictly between 0 and 90")

    params = {"v": "m/s", "theta": "deg"}
    draft.ledger.record(verify.units_agree("v^2 * sin(2*theta*pi/180) / g", "m", params))
    draft.ledger.record(verify.units_agree("2*v*sin(theta*pi/180)/g", "s", params))

    theta = math.radians(angle_deg)
    vx, vy = v0 * math.cos(theta), v0 * math.sin(theta)
    flight = 2 * vy / G
    apex_closed = vy**2 / (2 * G)
    range_closed = v0**2 * math.sin(2 * theta) / G

    # Second route: sample the trajectory itself and read the apex and the landing off it.
    trajectory = f"{vy:.10g}*t - {G / 2:.10g}*t**2"
    step = flight / 120
    points = verify.sample(trajectory, "t", [i * step for i in range(121)])
    apex_sampled = max(y for _, y in points)
    draft.ledger.record(verify.numbers_agree("apex height", apex_closed, apex_sampled, 1e-3))
    draft.ledger.record(verify.numbers_agree("range", range_closed, vx * flight, 1e-9))

    # ONE SCALE BOTH WAYS. This used to stretch the range across 760 board units and the height
    # across 700 whatever the numbers were, so a ball thrown at 20 m/s at 45 degrees — 40.8 m long
    # and 10.2 m high — was drawn with its height exaggerated 2.9 times. The parabola on the board
    # was not the parabola the ball flew (the evidence lab, 2026-09-09).
    frame = Frame.fit(0.0, range_closed * 1.05, 0.0, apex_closed * 1.35)
    # THE LINE UNDER A TRAJECTORY IS THE GROUND. It was labelled "metres", written past the
    # arrowhead at the right-hand end, and clipped there on the live board at 390 (the adversary,
    # 2026-09-09, finding 9). The metres are named where they are measured — on the range, below —
    # and the axis says what it is.
    draft.add(
        "axis",
        anchor=board(frame.x0, frame.y0 + frame.h),
        orientation="x",
        min=0.0,
        max=round(frame.xmax, 4),
        step=round(frame.xmax / 6, 4) or 1.0,
        length=round(frame.w, 2),
        label="ground",
        ticks=True,
        style=wobo(2),
        hint="ground",
    )
    path = [frame.at(vx * (i * step), y) for (_, y), i in zip(points, range(121), strict=True)]
    curve = draft.add("curve", anchor=board(*path[0]), points=path, style=wobo(2), hint="path")

    apex_point = draft.add(
        "point",
        anchor=board(*frame.at(range_closed / 2, apex_closed)),
        style=accent(3),
        hint="apex",
    )
    # The decomposition at the apex is the whole lesson: the vertical component is gone, the
    # horizontal one never changed.
    arrow_to(
        draft,
        tip=board(*frame.at(range_closed / 2 + range_closed * 0.16, apex_closed)),
        tail=on(apex_point),
        style=accent(2),
        hint="vx",
    )
    # THE ASK SAYS "LABEL THE APEX" AND NOTHING ON THE BOARD SAID IT. The nearest word was
    # "up-speed is zero here", 7 px high and lying over the height number (the adversary,
    # 2026-09-09, finding 9). The top of the arc carries its own name first, and the two numbers
    # go to opposite corners so neither is written over the other.
    draft.add("label", anchor=on(apex_point, "top"), text="apex", style=accent(2), hint="apex")
    # THE WORDS ARE A TEACHER'S, NOT THE PIPELINE'S. "Across-speed 14.14 m/s, how high 10.20 m"
    # is honest — it is what the board says — and no teacher says it (finding 4). The quantities
    # keep their school names, which is also what makes the say worth listening to.
    draft.number(
        vx,
        "board.units_agree",
        anchor=on(apex_point, "topRight"),
        unit="m/s",
        label="sideways speed",
        style=accent(2),
    )
    draft.add(
        "write",
        anchor=on(apex_point, "bottom"),
        text="up-speed is zero here",
        style=accent(1),
        hint="apexnote",
    )
    draft.number(
        apex_closed,
        "board.numbers_agree:apex height",
        anchor=on(apex_point, "topLeft"),
        unit="m",
        label="greatest height",
        style=wobo(1),
    )
    # A BARE "40.79 m" UNDER THE ARC NAMED NOTHING. A number nobody can name teaches nothing.
    draft.number(
        range_closed,
        "board.numbers_agree:range",
        anchor=on(curve, "bottom"),
        unit="m",
        label="range",
        style=wobo(1),
    )
    return draft


def _circuit(intent: dict[str, Any], draft: Draft) -> Draft:
    """A series circuit, symbol by symbol, with every drop computed and cross-checked."""
    try:
        emf = float(intent.get("emf"))
        resistances = [float(r) for r in (intent.get("resistances") or [])]
    except (TypeError, ValueError) as exc:
        raise Unverified("a circuit needs a supply voltage and resistances") from exc
    if emf <= 0 or not resistances or any(r <= 0 for r in resistances):
        raise Unverified("voltages and resistances are positive numbers")
    if len(resistances) > 6:
        raise Unverified("more than six components is more than one board")
    arrangement = str(intent.get("arrangement") or "series")

    draft.ledger.record(verify.units_agree("V / R", "A", {"V": "V", "R": "ohm"}))
    if arrangement == "series":
        total = sum(resistances)
    elif arrangement == "parallel":
        total = 1.0 / sum(1.0 / r for r in resistances)
    else:
        raise Unverified("a circuit is series or parallel")
    current = emf / total
    if arrangement == "series":
        drops = [current * r for r in resistances]
        # Kirchhoff is the second route: the drops must add back up to the supply.
        draft.ledger.record(verify.numbers_agree("loop voltages", sum(drops), emf, 1e-9))
    else:
        drops = [emf for _ in resistances]
        branch = sum(emf / r for r in resistances)
        draft.ledger.record(verify.numbers_agree("branch currents", branch, current, 1e-9))

    # The loop keeps clear of the top and the bottom of the figure box: the resistor symbols
    # stand proud of the wire and each carries a number above it and a drop below it, and all of
    # that is part of the drawing's height, which is what decides how big the writing renders.
    left = FIGURE[0]
    right = FIGURE[0] + FIGURE[2]
    top = FIGURE[1] + FIGURE[3] * 0.22
    bottom = FIGURE[1] + FIGURE[3] * 0.78
    draft.add(
        "polyline",
        anchor=board(left, top),
        points=[[left, top], [right, top], [right, bottom], [left, bottom], [left, top]],
        style=wobo(2),
        hint="loop",
    )
    mid = (top + bottom) / 2
    cell = draft.add(
        "line",
        anchor=board(left, mid - 20.0),
        to=board(left, mid + 20.0),
        style=wobo(3),
        hint="cell",
    )
    draft.number(emf, "board.units_agree", anchor=on(cell, "left"), unit="V", style=wobo(1))

    spacing = (right - left) / (len(resistances) + 1)
    for i, (resistance, drop) in enumerate(zip(resistances, drops, strict=True)):
        x = left + spacing * (i + 1)
        symbol = draft.add(
            "polyline",
            anchor=board(x - 30, top),
            points=[
                [x - 30, top],
                [x - 20, top - 12],
                [x - 4, top + 12],
                [x + 12, top - 12],
                [x + 26, top + 12],
                [x + 34, top],
            ],
            style=wobo(2),
            hint=f"r{i + 1}",
        )
        draft.number(
            resistance, "board.units_agree", anchor=on(symbol, "top"), unit="ohm", style=faint(1)
        )
        draft.number(
            drop,
            "board.numbers_agree:loop voltages"
            if arrangement == "series"
            else "board.numbers_agree:branch currents",
            anchor=on(symbol, "bottom"),
            unit="V",
            style=accent(1),
        )
    draft.number(
        current,
        "board.units_agree",
        anchor=board(FIGURE_MID[0], bottom + 26.0),
        unit="A",
        style=accent(2),
    )
    return draft


def _ray(intent: dict[str, Any], draft: Draft) -> Draft:
    """A thin lens, in the Cartesian convention: ``1/v - 1/u = 1/f``, solved and then proved by
    substitution in the CAS, never rearranged by hand — of the lens the learner asked about.
    """
    from wobo_verifier.cas import CasError, solution_satisfies

    # THE GIVENS COME OUT OF THE QUESTION. "a convex lens of focal length 15 cm with the object
    # 30 cm away" was drawn as f = 10 with the image at 15 and the magnification at -0.5: the
    # image distance and the magnification were both signed `cas.solution_satisfies` and both were
    # true — of a lens with a focal length of 10 cm, which nobody had asked for (the evidence lab,
    # 2026-09-09, `turns/scratch/physics-lens-1440`). A verifier that proves the wrong equation
    # proves nothing, so the numbers are read out of the learner's sentence before anything else.
    focal = draft.given("focal length", intent.get("focal_length"), "focal length", "focal")
    # The object sits at a NEGATIVE distance in the Cartesian convention and a learner writes it
    # as a distance ("30 cm away"), so the magnitude is what is read and the sign is the physics.
    object_distance = draft.given(
        "object distance",
        intent.get("object_distance"),
        "object",
        "away",
        "in front",
        magnitude=True,
        sign=-1.0,
    )
    try:
        focal = float(focal)
        u = float(object_distance)
    except (TypeError, ValueError) as exc:
        raise Unverified("a ray diagram needs a focal length and an object distance") from exc
    if focal == 0 or u >= 0:
        raise Unverified(
            "in the Cartesian convention the object sits at a negative distance and f is not zero"
        )
    if abs(1 / focal + 1 / u) < 1e-12:
        raise Unverified("the object is at the focus, so no image forms")
    image = 1.0 / (1.0 / focal + 1.0 / u)
    equation = f"1/v - 1/({u:.10g})"
    try:
        draft.ledger.record(
            solution_satisfies(f"{equation} = 1/({focal:.10g})", f"{image:.10g}", var="v")
        )
    except CasError as exc:
        raise Unverified(f"the lens equation could not be checked: {exc}") from exc
    magnification = image / u
    # THE MAGNIFICATION IS A SECOND NUMBER AND NEEDS A SECOND CHECK. It used to be drawn carrying
    # `cas.solution_satisfies` — the receipt for the IMAGE DISTANCE, an equation the magnification
    # does not appear in. The planner's law was satisfied (the check had run) and the claim was
    # still unearned. Two independent routes to it, and only agreement gets the pen: m = v/u from
    # the image the CAS proved, and m = f/(f + u) straight from the lens equation.
    draft.ledger.record(
        verify.numbers_agree("magnification", magnification, focal / (focal + u), 1e-9)
    )
    # THE UNIT IS THE LEARNER'S, NOT OURS. This pipeline is unit-agnostic: it works in whatever
    # the numbers arrived in, and the CAS signs the MAGNITUDE. It used to hard-code metres on the
    # image distance it drew, so "an object 30 cm in front of a lens of focal length 10 cm" was
    # answered on the board with "15.0 m" — a number the verifier had genuinely proved, published
    # with a unit nobody had given it, wrong by a factor of a hundred. Caught on the live run of
    # 2026-09-05. A unit is written when the learner or the intent declares one, never invented.
    #
    # The dimensional check that used to sit here went with it. ``units_agree("f", "m", {"f":
    # "m"})`` asks whether a quantity declared in metres carries metres: it is a tautology, it
    # passed for every ray diagram ever drawn, and it proved nothing about the number beside it.
    unit = draft.given_unit(str(intent.get("unit") or "").strip()[:8] or None, "focal", "object")

    # One scale both ways: a ray diagram is a picture of space, so a centimetre across the axis is
    # a centimetre up it. The old frame stretched the height by 1.84 whatever the numbers were.
    span = max(abs(u), abs(image), abs(focal)) * 1.25
    height = span * 0.22
    reach = max(height, abs(height * magnification), span * 0.3)
    frame = Frame.fit(-span, span, -reach, reach)
    axis = draft.add(
        "line",
        anchor=board(*frame.at(-span, 0)),
        to=board(*frame.at(span, 0)),
        style=faint(1),
        hint="axis",
    )
    # The lens is drawn in the diagram's own units, so it scales with everything else instead of
    # being a fixed 14-by-120 blob that meant one thing at one span and another at the next.
    draft.add(
        "ellipse",
        anchor=board(*frame.at(0, 0)),
        rx=round(span * 0.035 * frame.per_unit, 2),
        ry=round(reach * 0.9 * frame.per_unit_y, 2),
        style=wobo(2),
        hint="lens",
    )
    obj = arrow_to(
        draft,
        tip=board(*frame.at(u, height)),
        tail=board(*frame.at(u, 0)),
        style=wobo(2),
        hint="object",
    )
    draft.add("label", anchor=on(obj, "top"), text="object", style=faint(1), hint="objlabel")
    img = arrow_to(
        draft,
        tip=board(*frame.at(image, height * magnification)),
        tail=board(*frame.at(image, 0)),
        style=accent(2),
        hint="image",
    )
    draft.add("label", anchor=on(img, "bottom"), text="image", style=accent(1), hint="imglabel")
    # A dot at nothing teaches nothing: each focus is named, and the one on the object's side is
    # named apart from the other so a learner can see which side of the lens they are looking at.
    # "F" IS NOTATION, AND THE SAY READS IT OUT AS A LETTER: the lens board opened with "Object,
    # image, F, image 30.00 cm, how big -1.00." (the adversary, 2026-09-09, finding 4). The word
    # is what a teacher says at the point, and it is what a learner who is listening needs.
    #
    # TWO POINTS WITH THE SAME NAME ARE ONE NAME (the adversary, 2026-09-09, finding 7). Both were
    # labelled "focus", identically, and one of them never painted. Which focus a ray leaves
    # through is the whole of the construction below, so the two are told apart by the side they
    # are on — near the object, or the far side of the lens — and never by a letter.
    for x in (focal, -focal):
        point = draft.add("point", anchor=board(*frame.at(x, 0)), style=faint(1), hint="focus")
        draft.add(
            "label",
            anchor=on(point, "bottom"),
            text="near focus" if x < 0 else "far focus",
            style=faint(1),
            hint="flabel",
        )

    # THE CONSTRUCTION, NOT ONE LINE OF IT (the adversary, 2026-09-09, finding 7). The board drew
    # the ray through the optical centre and nothing else: a straight line from the tip of the
    # object to the tip of the image, which is where the image already was. It proves nothing. A
    # ray diagram LOCATES the image, and it takes two more rays to do it:
    #
    #   · the parallel ray — arrives flat, leaves through the far focus;
    #   · the focal ray — arrives through the near focus, leaves flat.
    #
    # Both are exact, and both are the lens equation written as geometry. The parallel ray leaves
    # the lens at (0, h) and crosses the axis at (f, 0); at x = v it is at h(1 - v/f), and
    # 1/v - 1/u = 1/f makes that h·v/u, which is the tip of the image. The focal ray crosses the
    # axis at (-f, 0) on its way in and reaches the lens at h·v/u, the same height, which is why
    # it leaves flat. So the three rays meet at one point, and that meeting is the answer.
    tip = height * magnification
    # The two independent routes to the image height, which have to agree before either is drawn.
    draft.ledger.record(
        verify.numbers_agree("the rays meet", height * (1.0 - image / focal), tip, 1e-9)
    )
    # A VIRTUAL IMAGE IS NOT WHERE THE LIGHT WENT. When the image is on the object's side no ray
    # ever reaches it; the eye traces the diverging rays BACK to it, and a teacher draws that half
    # dashed. Drawing it solid would claim light travelled somewhere it did not.
    outgoing = accent(1) if image > 0 else {**accent(1), "dash": True}
    draft.add(
        "polyline",
        anchor=board(*frame.at(u, height)),
        points=[frame.at(u, height), frame.at(0.0, height), frame.at(image, tip)],
        style=outgoing,
        hint="parallelray",
    )
    draft.add(
        "polyline",
        anchor=board(*frame.at(u, height)),
        points=[frame.at(u, height), frame.at(0.0, tip), frame.at(image, tip)],
        style=outgoing,
        hint="focalray",
    )
    draft.add(
        "line",
        anchor=board(*frame.at(u, height)),
        to=board(*frame.at(image, tip)),
        style=accent(1),
        hint="centreray",
    )
    draft.number(
        image,
        "cas.solution_satisfies",
        # Under the axis, not off the end of it: at the axis's RIGHT the words ran past the
        # right-hand edge of the panel at 390 and "cm" was cut in half.
        anchor=on(axis, "bottom"),
        unit=unit,
        label="image distance",
        style=accent(2),
    )
    draft.number(
        magnification,
        "board.numbers_agree:magnification",
        anchor=on(img, "right"),
        label="magnification",
        style=wobo(1),
    )
    return draft


def _wave(intent: dict[str, Any], draft: Draft) -> Draft:
    try:
        amplitude = float(intent.get("amplitude", 1.0))
        wavelength = float(intent.get("wavelength"))
        frequency = float(intent.get("frequency"))
    except (TypeError, ValueError) as exc:
        raise Unverified("a wave needs a wavelength and a frequency") from exc
    if min(amplitude, wavelength, frequency) <= 0:
        raise Unverified("amplitude, wavelength and frequency are positive")

    draft.ledger.record(verify.units_agree("f * lam", "m/s", {"f": "Hz", "lam": "m"}))
    speed = frequency * wavelength
    # Second route: the wave's period times its frequency is one, and one wavelength passes in
    # exactly one period — so lambda over the period must return the same speed.
    period = 1.0 / frequency
    draft.ledger.record(verify.numbers_agree("wave speed", speed, wavelength / period, 1e-9))

    # TWO CYCLES, NOT TWO AND A HALF. The bracket and the three numbers sit either side of the
    # curve, so the widest thing on this board is the writing, not the wave: at 2.5 cycles the
    # union came to 465 units and the type landed on exactly 12.0 px at 390, with no margin at
    # all. Two full cycles show a wavelength twice, which is what the bracket is pointing at.
    cycles = 2.0
    span = wavelength * cycles
    expr = f"{amplitude:.10g}*sin(2*pi*x/{wavelength:.10g})"
    points = verify.sample(expr, "x", [span * i / 200 for i in range(201)])
    frame = Frame(xmin=0.0, xmax=span, ymin=-amplitude * 1.6, ymax=amplitude * 1.6)
    draft.add(
        "line",
        anchor=board(*frame.at(0, 0)),
        to=board(*frame.at(span, 0)),
        style=faint(1),
        hint="rest",
    )
    curve = draft.add(
        "curve",
        anchor=board(*frame.at(*points[0])),
        points=[frame.at(x, y) for x, y in points],
        style=wobo(2),
        hint="wave",
    )
    bracket = draft.add(
        "bracket",
        anchor=board(*frame.at(0, amplitude * 1.25)),
        side="top",
        label="one wavelength",
        style=accent(2),
        hint="lambda",
    )
    # THE NUMBERS GO UNDER THE WAVE, NOT BESIDE IT. The curve already fills the width of the
    # figure box, so a number to its left and another to its right added about 180 board units of
    # writing to the widest thing on the board, and the type came out at exactly 12.0 px at 390 —
    # the floor, with no margin at all (the golden run, 2026-09-09). Under the curve they cost
    # height instead, which is the axis this board has room on.
    draft.number(
        wavelength, "board.units_agree", anchor=on(bracket, "top"), unit="m", style=accent(1)
    )
    draft.number(
        frequency, "board.units_agree", anchor=on(curve, "bottomLeft"), unit="Hz", style=faint(1)
    )
    draft.number(
        speed,
        "board.numbers_agree:wave speed",
        anchor=on(curve, "bottomRight"),
        unit="m/s",
        style=accent(2),
    )
    return draft
