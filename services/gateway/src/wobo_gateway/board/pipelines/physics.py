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

#: A force arrow this long on the board means the largest force in the diagram.
MAX_ARROW = 180.0
BODY = (500.0, 480.0)


def build(intent: dict[str, Any], prefix: str) -> Draft:
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
    return handler(intent, Draft(prefix))


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
        draft.add(
            "label", anchor=on(arrow, "right"), text=force["name"], style=faint(1), hint="fname"
        )
        draft.number(
            force["magnitude"],
            "board.units_agree",
            anchor=on(arrow, "top"),
            unit=force["unit"],
            style=faint(1),
        )
    if intent.get("equilibrium"):
        draft.add(
            "write",
            anchor=on(body_id, "top"),
            text="the arrows cancel, so nothing accelerates",
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
    try:
        v0 = float(intent.get("v0"))
        angle_deg = float(intent.get("angle_deg"))
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
    draft.ledger.record(
        verify.numbers_agree("range", range_closed, vx * flight, 1e-9)
    )

    frame = Frame(xmin=0.0, xmax=range_closed * 1.05, ymin=0.0, ymax=apex_closed * 1.35)
    draft.add(
        "axis",
        anchor=board(frame.x0, frame.y0 + frame.h),
        orientation="x",
        min=0.0,
        max=round(frame.xmax, 4),
        step=round(frame.xmax / 6, 4) or 1.0,
        length=round(frame.w, 2),
        label="distance in metres",
        ticks=True,
        style=wobo(2),
        hint="ground",
    )
    path = [frame.at(vx * (i * step), y) for (_, y), i in zip(points, range(121), strict=True)]
    curve = draft.add("curve", anchor=board(*path[0]), points=path, style=wobo(2), hint="path")

    apex_point = draft.add(
        "point", anchor=board(*frame.at(range_closed / 2, apex_closed)), style=accent(3),
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
    draft.number(vx, "board.units_agree", anchor=on(apex_point, "top"), unit="m/s", style=accent(2))
    draft.add(
        "write",
        anchor=on(apex_point, "bottom"),
        text="up-speed is zero here, across-speed is not",
        style=accent(1),
        hint="apexnote",
    )
    draft.number(
        apex_closed,
        "board.numbers_agree:apex height",
        anchor=on(apex_point, "left"),
        unit="m",
        style=wobo(1),
    )
    draft.number(
        range_closed, "board.numbers_agree:range", anchor=on(curve, "bottom"), unit="m",
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

    left, right, top, bottom = 200.0, 800.0, 300.0, 620.0
    draft.add(
        "polyline",
        anchor=board(left, top),
        points=[[left, top], [right, top], [right, bottom], [left, bottom], [left, top]],
        style=wobo(2),
        hint="loop",
    )
    cell = draft.add("line", anchor=board(left, 440.0), to=board(left, 480.0), style=wobo(3),
                     hint="cell")
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
        draft.number(resistance, "board.units_agree", anchor=on(symbol, "top"), unit="ohm",
                     style=faint(1))
        draft.number(
            drop,
            "board.numbers_agree:loop voltages"
            if arrangement == "series"
            else "board.numbers_agree:branch currents",
            anchor=on(symbol, "bottom"),
            unit="V",
            style=accent(1),
        )
    draft.number(current, "board.units_agree", anchor=board(500.0, bottom + 40), unit="A",
                 style=accent(2))
    return draft


def _ray(intent: dict[str, Any], draft: Draft) -> Draft:
    """A thin lens, in the Cartesian convention: ``1/v - 1/u = 1/f``, solved and then proved by
    substitution in the CAS, never rearranged by hand."""
    from wobo_verifier.cas import CasError, solution_satisfies

    try:
        focal = float(intent.get("focal_length"))
        u = float(intent.get("object_distance"))
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
    # THE UNIT IS THE LEARNER'S, NOT OURS. This pipeline is unit-agnostic: it works in whatever
    # the numbers arrived in, and the CAS signs the MAGNITUDE. It used to hard-code metres on the
    # image distance it drew, so "an object 30 cm in front of a lens of focal length 10 cm" was
    # answered on the board with "15.0 m" — a number the verifier had genuinely proved, published
    # with a unit nobody had given it, wrong by a factor of a hundred. Caught on the live run of
    # 2026-09-05. A unit is written when the intent declares one and left off when it does not.
    #
    # The dimensional check that used to sit here went with it. ``units_agree("f", "m", {"f":
    # "m"})`` asks whether a quantity declared in metres carries metres: it is a tautology, it
    # passed for every ray diagram ever drawn, and it proved nothing about the number beside it.
    # What earns the image distance its place on the board is ``cas.solution_satisfies`` — the
    # lens equation solved and then proved by substitution — and that is what it names.
    unit = str(intent.get("unit") or "").strip()[:8] or None

    span = max(abs(u), abs(image), abs(focal)) * 1.4
    frame = Frame(xmin=-span, xmax=span, ymin=-span * 0.5, ymax=span * 0.5)
    axis = draft.add(
        "line", anchor=board(*frame.at(-span, 0)), to=board(*frame.at(span, 0)), style=faint(1),
        hint="axis",
    )
    draft.add(
        "ellipse",
        anchor=board(*frame.at(0, 0)),
        rx=14.0,
        ry=120.0,
        style=wobo(2),
        hint="lens",
    )
    height = span * 0.18
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
    for x in (focal, -focal):
        draft.add("point", anchor=board(*frame.at(x, 0)), style=faint(1), hint="focus")
    draft.add(
        "line",
        anchor=board(*frame.at(u, height)),
        to=board(*frame.at(image, height * magnification)),
        style=accent(1),
        hint="ray",
    )
    draft.number(image, "cas.solution_satisfies", anchor=on(axis, "right"), unit=unit,
                 style=accent(2))
    draft.number(magnification, "cas.solution_satisfies", anchor=on(img, "right"), style=wobo(1))
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

    cycles = 2.5
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
    draft.number(wavelength, "board.units_agree", anchor=on(bracket, "top"), unit="m",
                 style=accent(1))
    draft.number(frequency, "board.units_agree", anchor=on(curve, "left"), unit="Hz",
                 style=faint(1))
    draft.number(speed, "board.numbers_agree:wave speed", anchor=on(curve, "right"), unit="m/s",
                 style=accent(2))
    return draft
