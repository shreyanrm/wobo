"""The console's panels, which ARE its capabilities, and the map from a route to the one it needs.

THE OWNER'S RULING (docs/CONSOLE-ROLES-AND-BOARD.md §2): *"the rest of the new users that get added
by me, I should be able to assign their roles and what all visible to them."*

So the law says three things this module is the whole answer to:

  * **The capabilities are the console's own panels**, "so 'what they can see' and 'what they can
    do' are one list, not two". One vocabulary, defined here once, read by the guard, by the
    register screen and by the rail the console draws.
  * **Each is read and act separately**, "because seeing a learner's day is a different thing from
    acting on it". Hence two capabilities per panel and never one.
  * **A panel a person cannot read is not greyed out, it is not there, and its route refuses them
    with the same message a stranger gets**, so nothing leaks by way of a URL somebody remembers.
    That last clause is why this module maps PATHS and not only screens: a rail that hides a desk
    while the endpoint behind it still answers is a hidden desk, not a closed one.

WHY THE MAP IS BY PATH AND NOT A DECORATOR ON EACH ROUTE. Two reasons, and the second is the one
that matters. The first is that the desks live in eight modules owned by different waves, and a
rule that has to be re-typed in eight places is a rule that will be missed in the ninth. The
second: ``capability_for`` returns ``None`` for anything it does not recognise, the guard refuses
on ``None``, and ``test_console_roles.py`` walks every mounted admin route and fails if one is
unclassified. A desk added tomorrow is therefore either named here or refused to everybody. There
is no third outcome in which it quietly answers to any seat that can open the console.

THE ELEVENTH PANEL. The law names ten by name: the learner desk, the support queues, the syllabus
and observer desk, the models desk, the money and allowance desk, the growth desk, the mail desk,
the content and judge queues, the board-change queue, and the admin register. The console also
carries a health desk (``GET /v1/admin/health``, the provider snapshot) and will carry alerts, and
those are not any of the ten. Filing them under a panel they are not would be a worse answer than
naming them, so ``platform`` is the eleventh and is written down here and in the law file rather
than smuggled in.

THIS LAYER DOES NOT REPLACE THE FIVE PERMISSIONS in ``admin_auth.PERMISSIONS``. A request must pass
BOTH: the coarse permission the route declares (``console.read``, ``support.act``, ``admin.manage``
…, which is also what demands a step-up before anything that writes) AND the panel capability for
its path. Role defaults are set so that nothing changes for anybody until an owner actually grants
or revokes something; the fine layer only ever narrows what a role starts with, or widens it one
named panel at a time.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

#: Every admin path starts here. Kept as a literal rather than imported from ``admin_auth`` because
#: that module imports this one, and a cycle between the door and its map helps nobody.
ADMIN_PREFIX = "/v1/admin"

VIEWER = "viewer"
OPERATOR = "operator"
OWNER = "owner"


@dataclass(frozen=True)
class Panel:
    """One desk in the console: what it is called, what it answers, and what it costs to see.

    ``routes`` are paths relative to ``/v1/admin``. A rule matches a path exactly or as a prefix
    ending at a segment boundary, so ``/admins`` covers ``/admins/{id}/suspend`` without also
    catching an unrelated ``/adminsomething``.
    """

    id: str
    name: str
    question: str
    routes: tuple[str, ...]

    @property
    def read(self) -> str:
        return f"panel.{self.id}.read"

    @property
    def act(self) -> str:
        return f"panel.{self.id}.act"


#: The panels, in the order the console's rail draws them: the money first because it is the
#: owner's, the queues next because they are what an operator works, the register last.
PANELS: tuple[Panel, ...] = (
    Panel(
        id="money",
        name="Money and allowance",
        question="What has been spent, on what, against the day's ceiling and the allowance?",
        routes=("/usage", "/economics", "/billing", "/allowance", "/promo"),
    ),
    Panel(
        id="models",
        name="Models",
        question="Which model answers what, at what price, and what a change would cost.",
        routes=("/models",),
    ),
    Panel(
        id="learner",
        name="The learner desk",
        question="One named learner's day: their plan, their meter, their case.",
        # The one read on the support desk that names a PERSON. It belongs to the learner panel
        # rather than to the queue it is pressed from, because identifying somebody is the seat
        # that has to answer for what it did with the answer.
        routes=("/reports/who", "/learners"),
    ),
    Panel(
        id="support",
        name="The support queues",
        question="Flags, bugs, support messages and refund requests, and who still needs a person.",
        routes=("/desks", "/reports"),
    ),
    Panel(
        id="curriculum",
        name="Syllabus and observer",
        question="What each board actually teaches, and what the observer has found since.",
        routes=("/observer", "/curriculum", "/syllabus"),
    ),
    Panel(
        id="content",
        name="Content and the judge",
        question="What has been made, what the judge held back, and what the stores saved.",
        routes=("/stores", "/content", "/judge"),
    ),
    Panel(
        id="boards",
        name="Board changes",
        question="Who has asked to change their board, from what, and when they last changed.",
        routes=("/board-changes", "/boards"),
    ),
    Panel(
        id="growth",
        name="Growth",
        question="What has been made, where it was posted, and what came back.",
        routes=("/growth",),
    ),
    Panel(
        id="mail",
        name="Mail",
        question="What was sent, what arrived, and what a person did next.",
        # The activity desk (activity.py): who came when, and the step of the mail ladder that
        # puts them on. Counts only, so it is the mail's to read rather than the learner desk's.
        routes=("/mail", "/activity"),
    ),
    Panel(
        id="platform",
        name="Platform",
        question="Is the gateway up, are the providers answering, what has fired?",
        routes=("/health", "/alerts", "/settings"),
    ),
    Panel(
        id="register",
        name="The register",
        question="Who has access, what they hold, and the whole trail of what everybody did.",
        routes=("/admins",),
    ),
)

_BY_ID: dict[str, Panel] = {panel.id: panel for panel in PANELS}

#: Every capability that exists. Anything outside this set grants nothing, however it got written.
CAPABILITIES: frozenset[str] = frozenset(
    cap for panel in PANELS for cap in (panel.read, panel.act)
)


def panel(panel_id: str) -> Panel:
    found = _BY_ID.get(panel_id)
    if found is None:  # pragma: no cover - a typo in our own code, not an input
        raise KeyError(f"unknown console panel: {panel_id}")
    return found


# --- what each role starts with -------------------------------------------------------------------
#
# A role is a STARTING POINT and nothing more (the law's word). These sets are chosen so that the
# console behaves exactly as it did before this layer existed, for every seat that has had nothing
# granted or revoked:
#
#   viewer   — "see everything in the console, and change nothing", and identify nobody. Every
#              panel's READ except the learner desk (which names a child and the address a parent
#              typed) and the register (a viewer does not need the list of people to target).
#   operator — the viewer's reads, plus the learner desk, plus the ACT on the desks that are
#              worked rather than watched: a support case, a board change, a piece of content, a
#              syllabus correction.
#   owner    — everything, and it cannot be taken away. See :func:`effective`.
_VIEWER_READS: frozenset[str] = frozenset(
    p.read for p in PANELS if p.id not in {"learner", "register"}
)
_OPERATOR_ACTS: frozenset[str] = frozenset(
    panel(pid).act for pid in ("learner", "support", "boards", "content", "curriculum")
)

DEFAULTS: dict[str, frozenset[str]] = {
    VIEWER: _VIEWER_READS,
    OPERATOR: _VIEWER_READS | {panel("learner").read} | _OPERATOR_ACTS,
    OWNER: CAPABILITIES,
}


def defaults_for(role: str) -> frozenset[str]:
    return DEFAULTS.get(role, frozenset())


def effective(
    role: str, *, grants: Iterable[str] = (), revokes: Iterable[str] = ()
) -> frozenset[str]:
    """What this person actually holds: the role's defaults, plus grants, minus revocations.

    THE OWNER IS THE EXCEPTION, and it is deliberate rather than a shortcut. "The owner cannot be
    suspended or removed by anyone else, cannot have their role changed by anyone else": a seat
    that could be hollowed out one capability at a time would be removable in everything but name,
    and an owner who had locked themselves out of the register by mistake would need the
    break-glass to undo a typo. So a revocation against the owner is nothing, here and at the
    route (``admin_auth`` refuses to write one at all, with a reason).
    """
    if role == OWNER:
        return CAPABILITIES
    held = set(defaults_for(role))
    held.update(cap for cap in grants if cap in CAPABILITIES)
    held.difference_update(set(revokes) & CAPABILITIES)
    return frozenset(held)


# --- the map from a route to the capability it needs ----------------------------------------------
#
# The paths that are not a panel. Every one of them is about WHO IS ASKING rather than about
# anything the console holds, so gating them on a panel would mean a seat with no panels could not
# even be told that it has none.
#
#   /session, /session/reauth, /whoami   — opening, proving and closing the console session.
#   /panels                              — "what may I see?", which must answer for every seat.
#   /audit                               — your own rows. Reading the WHOLE trail needs the
#                                          register panel, and `admin_auth.read_audit` asks for it
#                                          there; being able to see what was written down about
#                                          YOU is the transparency half and belongs to every seat.
IDENTITY_PATHS: frozenset[str] = frozenset(
    {
        f"{ADMIN_PREFIX}/session",
        f"{ADMIN_PREFIX}/session/reauth",
        f"{ADMIN_PREFIX}/whoami",
        f"{ADMIN_PREFIX}/panels",
        f"{ADMIN_PREFIX}/audit",
    }
)

#: Every rule, longest first, so ``/reports/who`` is matched before ``/reports``.
_RULES: tuple[tuple[str, Panel], ...] = tuple(
    sorted(
        ((route, p) for p in PANELS for route in p.routes),
        key=lambda pair: len(pair[0]),
        reverse=True,
    )
)

#: Methods that only look. Everything else changes something and needs the panel's ACT.
_READ_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def is_identity_path(path: str) -> bool:
    return _strip(path) is not None and path in IDENTITY_PATHS


def _strip(path: str) -> str | None:
    if path == ADMIN_PREFIX:
        return "/"
    if path.startswith(f"{ADMIN_PREFIX}/"):
        return path[len(ADMIN_PREFIX) :]
    return None


def panel_for(path: str) -> Panel | None:
    """Which desk a path belongs to, or ``None`` if nobody has said. ``None`` is a refusal."""
    rest = _strip(path)
    if rest is None:
        return None
    for route, found in _RULES:
        if rest == route or rest.startswith(f"{route}/"):
            return found
    return None


def capability_for(path: str, method: str) -> str | None:
    """The one capability this request needs, or ``None`` when no panel claims the path."""
    found = panel_for(path)
    if found is None:
        return None
    return found.read if method.upper() in _READ_METHODS else found.act


def view(held: Iterable[str]) -> list[dict[str, object]]:
    """The panels this seat may READ, as the console draws them.

    Only readable panels are in the list, because a panel a person cannot read is absent and a
    console cannot grey out what it was never sent. ``act`` rides on each one so a screen can show
    a queue without showing the button that closes it.
    """
    have = set(held)
    return [
        {
            "id": p.id,
            "name": p.name,
            "question": p.question,
            "read": True,
            "act": p.act in have,
        }
        for p in PANELS
        if p.read in have
    ]


def vocabulary() -> list[dict[str, object]]:
    """Every panel and both of its capabilities. The owner's register screen, and nothing else."""
    return [
        {
            "id": p.id,
            "name": p.name,
            "question": p.question,
            "read": p.read,
            "act": p.act,
        }
        for p in PANELS
    ]


__all__ = [
    "ADMIN_PREFIX",
    "CAPABILITIES",
    "DEFAULTS",
    "IDENTITY_PATHS",
    "PANELS",
    "Panel",
    "capability_for",
    "defaults_for",
    "effective",
    "is_identity_path",
    "panel",
    "panel_for",
    "view",
    "vocabulary",
]
