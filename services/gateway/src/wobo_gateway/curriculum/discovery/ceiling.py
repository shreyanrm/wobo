"""What a discovery may spend, and the switch that stops it. Four dials, all on ``ops.settings``.

**The owner, in docs/BOARD-COLD-START.md §5:** *"A budget per board and per day, on the console
with an alert, so a bad day cannot become a bill"*, and *"a refusal is remembered, so a board whose
document cannot be read is not re-fetched on every learner who picks it"*.

Before this, one discovery was metered as one GENERATION against a system subject
(``worker.SYSTEM_SUBJECT``) — a count of runs, not an amount of money — and the only thing that
could stop the worker once it was on was a redeploy. A board with a slow host, a big compilation
and a redraw costs several times what a board with a three-page pdf costs, so counting runs is not
counting money, and the first live run measured exactly that spread: 0.0146 USD for Tamil Nadu
(refused at the fetch), 0.0296 for Maharashtra (200 pages, a redraw and two second readings).

Four dials, read live off ``ops.settings`` through :mod:`wobo_gateway.dials`, so every one of them
moves without a deploy and every move leaves a row in ``ops.settings_audit``:

=================================  ==========================================================
``discovery.running``              the hard stop. False and nothing runs, now, everywhere.
``discovery.board.max_usd``        what one board may cost in a day, across all its subjects
``discovery.daily.max_usd``        what every discovery together may cost in a day
``discovery.refusal.retry_days``   how long a refusal is remembered before it may cost again
=================================  ==========================================================

The generation meter stays where it is. This is a second, narrower guard in money, and the
platform's own spend ceiling (:mod:`wobo_gateway.spend`) is a third above both.

**What is durable, said plainly, because for a while it was not.** The refused ROW is durable: a
refusal lives in the job store with its day on it, and :func:`retry_refused_after_days` is what
stops a learner reloading a page from paying for the same refusal twice. The day's tally, every
board's total and the resting list used to live ONLY in the module globals below — per process,
exactly like the generation meters (``docs/OPERATIONS.md`` §9.2: "the claim is safe across
replicas, the meters are not"). Every one of those guards therefore started the day again at zero
on a redeploy, on a crash loop, and separately in each replica, while the money went on being
real: the prewarm's fourteen rungs are about 0.48 USD per readable board per pass, so a process
that came back every few minutes could have spent the day's ceiling many times over and every
tally would have read almost nothing.

So the day is READ BACK (:func:`recover`) from the rows that already carry it —
``curriculum.discovery_jobs``, one row per (board, class, subject), with ``result.cost_usd`` on
every run the worker ends and ``result.reason`` on every refusal — on the first question asked
after a start and once a minute after that. Money is keyed by :func:`run_key` so a run is never
counted twice, and a board's refusals are raised to what its rows show and never lowered. What
this does NOT survive is a process that dies mid-run, before its row is written: that run's money
is not on any row, and nothing can put it there from here. The one replica in ``railway.json`` is
still the arrangement this is written for; two replicas now converge within a minute rather than
each holding a private ceiling.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger("wobo.gateway.curriculum.discovery.ceiling")

# --- the keys ---------------------------------------------------------------------------------
RUNNING_KEY = "discovery.running"
BOARD_KEY = "discovery.board.max_usd"
DAY_KEY = "discovery.daily.max_usd"
RETRY_KEY = "discovery.refusal.retry_days"

#: One discovery costs about 0.02 to 0.03 USD on the floor rung (the first live run, three state
#: boards). A board is many subjects and many classes, and a board whose document needs a redraw
#: costs more, so the default lets a board be read a dozen or so times in a day and no more.
DEFAULT_BOARD_USD = 0.50
#: docs/OPERATIONS.md §9.2 budgeted the worker at about 1.60 USD a day when it counted runs. This
#: is the same order in money, with room for the prewarm pass over the big state boards.
DEFAULT_DAILY_USD = 5.00
#: ``job.RETRY_REFUSED_AFTER_DAYS`` was a constant. It is a dial now, and this is its old value.
DEFAULT_RETRY_DAYS = 7

#: How many times a board may refuse FOR A REASON ABOUT THE BOARD before it is left alone. Three,
#: because one is a bad afternoon and two is a coincidence.
REFUSALS_BEFORE_REST = 3

#: The refusals that are facts about the BOARD'S HOST rather than about one subject. Deliberately
#: narrow. A reading we could not trust (``checks_failed``) says nothing about the board's other
#: subjects. Finding no candidate (``not_found``) is about that subject's document, not the site.
#: Our own search provider being down (``search_unavailable``) is about us. A door that will not
#: open, a name that will not resolve and a certificate we cannot verify are about the board, and
#: they will be just as true for the next subject and the next learner.
BOARD_LEVEL_REASONS = frozenset(
    {
        "not_fetchable",
        "unreachable",
        "timeout",
        "dns",
        "tls_untrusted",
        "tls_failed",
        "robots_disallowed",
        "http_error",
    }
)


# --- the dials --------------------------------------------------------------------------------
def _dial(key: str) -> Any:
    from wobo_gateway import dials

    try:
        return dials.values().get(key)
    except Exception as exc:  # noqa: BLE001 — a store that will not answer never stops a run
        logger.warning("discovery ceiling: could not read %s (%s)", key, exc)
        return None


def _positive(key: str, default: float) -> float:
    held = _dial(key)
    if isinstance(held, int | float) and not isinstance(held, bool) and held > 0:
        return float(held)
    return default


def running() -> bool:
    """The hard stop. Anything but an explicit ``false`` is on, so a missing dial never stops it."""
    return _dial(RUNNING_KEY) is not False


def board_ceiling_usd() -> float:
    return _positive(BOARD_KEY, DEFAULT_BOARD_USD)


def daily_ceiling_usd() -> float:
    return _positive(DAY_KEY, DEFAULT_DAILY_USD)


def retry_refused_after_days() -> int:
    held = _dial(RETRY_KEY)
    if isinstance(held, int | float) and not isinstance(held, bool) and held > 0:
        return int(held)
    return DEFAULT_RETRY_DAYS


# --- the day ----------------------------------------------------------------------------------
@dataclass(frozen=True)
class Spend:
    """What discovery has cost today, by board. What the console shows and the alert reads."""

    day: str
    total_usd: float
    runs: int
    by_board: dict[str, float] = field(default_factory=dict)
    resting: dict[str, str] = field(default_factory=dict)

    @property
    def fraction(self) -> float:
        ceiling = daily_ceiling_usd()
        return (self.total_usd / ceiling) if ceiling > 0 else 0.0

    def as_dict(self) -> dict[str, Any]:
        return {
            "day": self.day,
            "total_usd": round(self.total_usd, 6),
            "daily_ceiling_usd": daily_ceiling_usd(),
            "board_ceiling_usd": board_ceiling_usd(),
            "fraction": round(self.fraction, 4),
            "runs": self.runs,
            "by_board": {board: round(usd, 6) for board, usd in sorted(self.by_board.items())},
            "resting": dict(sorted(self.resting.items())),
        }


_lock = threading.Lock()
_day: str = ""
#: Every run of the day, keyed by :func:`run_key` — what the durable row will be keyed by too, so
#: reading the day back cannot count the same discovery twice. The value is (board, usd).
_spent: dict[str, tuple[str, float]] = {}
_refusals: dict[str, list[tuple[str, str]]] = {}
#: Boards the owner has woken today. The recovery does not put them back to sleep.
_woken: set[str] = set()
_anon: int = 0
#: The recovery's own clock: when the day was last read back, and how long until it may be read
#: again. ``0.0`` and ``0.0`` mean "never read", which is due at once.
_read_at: float = 0.0
_read_wait: float = 0.0


def _board(framework_id: str | None) -> str:
    return (framework_id or "unknown").strip().lower()


def _norm(text: str | None) -> str:
    return " ".join((text or "").strip().lower().split())


def run_key(framework_id: str | None, level: str | None, subject: str | None) -> str:
    """What ONE discovery is, to the money: a board, a class and a subject, normalised.

    The in-process meter and the durable row have to agree on this, or a day read back after a
    restart counts a run this process already counted. It is deliberately NOT
    ``job.discovery_key``, which carries the academic year as well: the job ROW does not store a
    year, and a key the rows cannot produce is a key the recovery cannot match.
    """
    return "|".join((_board(framework_id), _norm(level), _norm(subject)))


def key_for(request: Any) -> str:
    """:func:`run_key` for a :class:`~...extract.SyllabusRequest`, which is what a run holds."""
    return run_key(
        getattr(request, "framework_id", None),
        getattr(request, "level", None),
        getattr(request, "subject", None),
    )


def _amount(value: Any) -> float:
    if isinstance(value, int | float) and not isinstance(value, bool):
        return max(0.0, float(value))
    return 0.0


def _today(day: str | None = None) -> str:
    return day or datetime.now(UTC).strftime("%Y-%m-%d")


def _roll_locked(day: str) -> None:
    """A new UTC day is a new ceiling and a fresh rest for every board."""
    global _day, _spent, _refusals, _woken, _read_at, _read_wait
    if day != _day:
        _day = day
        _spent = {}
        _refusals = {}
        _woken = set()
        # The new day has its own rows, and they are read back on the first question asked of it.
        _read_at, _read_wait = 0.0, 0.0


def _totals_locked() -> tuple[float, dict[str, float], int]:
    by_board: dict[str, float] = {}
    total = 0.0
    for board, usd in _spent.values():
        by_board[board] = by_board.get(board, 0.0) + usd
        total += usd
    return total, by_board, len(_spent)


def reset() -> None:
    """Test seam, and the owner's "start the day again" when they raise a ceiling.

    It forgets what this PROCESS holds, not what the rows hold: the next question reads the day
    back off the durable rows, which is the whole point of :func:`recover`.
    """
    global _day, _spent, _refusals, _woken, _anon, _read_at, _read_wait
    with _lock:
        _day, _spent, _refusals, _woken, _anon = "", {}, {}, set(), 0
        _read_at, _read_wait = 0.0, 0.0


def state(day: str | None = None) -> Spend:
    today = _today(day)
    recover(day=today)
    with _lock:
        _roll_locked(today)
        total, by_board, runs = _totals_locked()
        return Spend(
            day=_day,
            total_usd=total,
            runs=runs,
            by_board=by_board,
            resting={
                board: reasons[-1][0]
                for board, reasons in _refusals.items()
                if len(reasons) >= REFUSALS_BEFORE_REST
            },
        )


def record(
    framework_id: str | None, usd: float, *, key: str | None = None, day: str | None = None
) -> None:
    """One discovery's actual cost, against its board and against the day.

    ``key`` is :func:`run_key` for the run — what the durable row will carry — so that the same
    discovery read back off the rows after a restart is recognised rather than added again. A
    caller with no key (a test, a run with no subject) gets one of its own that matches nothing.
    """
    global _anon
    board = _board(framework_id)
    amount = _amount(usd)
    with _lock:
        _roll_locked(_today(day))
        if key is None:
            _anon += 1
            key = f"run:{_anon}"
        held = _spent.get(key)
        _spent[key] = (board, amount if held is None else max(held[1], amount))
        day_total, by_board, runs = _totals_locked()
        board_total = by_board.get(board, 0.0)
    # One line per discovery, so the day's money is readable in ``railway logs`` without a console
    # panel. Nothing in it is a learner's: a board id, an amount, a count.
    logger.info(
        "discovery.spent",
        extra={
            "fields": {
                "board": board,
                "usd": round(float(usd), 6),
                "board_today_usd": round(board_total, 6),
                "board_ceiling_usd": board_ceiling_usd(),
                "day_today_usd": round(day_total, 6),
                "day_ceiling_usd": daily_ceiling_usd(),
                "runs_today": runs,
            }
        },
    )


# --- the verdicts -----------------------------------------------------------------------------
def verdict(framework_id: str | None) -> str | None:
    """May a discovery for this board start? ``None`` is yes; anything else is a refusal reason.

    Asked before a job is claimed and before a learner is metered, so a discovery that cannot run
    costs nothing at all — not a generation, not a search, not a fetch.
    """
    if not running():
        return "discovery_stopped"
    resting_reason = resting(framework_id)
    if resting_reason:
        return "board_resting"
    board = (framework_id or "unknown").strip().lower()
    now = state()
    if now.total_usd >= daily_ceiling_usd():
        return "day_budget_spent"
    if now.by_board.get(board, 0.0) >= board_ceiling_usd():
        return "board_budget_spent"
    return None


def would_exceed(framework_id: str | None, usd_so_far: float) -> str | None:
    """Asked at every stage of a run in flight: has this one already cost too much to go on?"""
    board = (framework_id or "unknown").strip().lower()
    now = state()
    if now.by_board.get(board, 0.0) + usd_so_far >= board_ceiling_usd():
        return "board_budget_spent"
    if now.total_usd + usd_so_far >= daily_ceiling_usd():
        return "day_budget_spent"
    return None


# --- what a run cost --------------------------------------------------------------------------
@dataclass
class Run:
    """One discovery's money, measured off the platform's own ledger while it runs."""

    framework_id: str | None
    started_usd: float = 0.0
    spent_usd: float = 0.0
    #: What this run is, to the money and to the row it will become (:func:`run_key`).
    key: str | None = None

    def so_far(self) -> float:
        from wobo_gateway import spend

        return max(0.0, spend.spent_usd() - self.started_usd)

    def exceeded(self) -> str | None:
        return would_exceed(self.framework_id, self.so_far())


@contextmanager
def meter(
    framework_id: str | None, *, level: str | None = None, subject: str | None = None
) -> Iterator[Run]:
    """Measure one discovery against the platform's spend ledger and bill it to its board.

    The ledger is the one place every model call is priced (``telemetry.record_cost`` feeds it),
    so the difference across a run is what the run cost, whichever tier or provider answered.

    **It over-attributes, and that is the safe direction.** The ledger is the whole platform's, so
    a learner's turn that is answered while a discovery is running lands inside this difference
    and is billed to the board. The consequence is that a board can reach its ceiling sooner than
    it truly did, never later, so the guard errs towards refusing. Measuring only discovery's own
    calls would need a per-capability ledger, which ``spend.py`` does not keep; if it grows one,
    this is the seam to change and nothing else.

    ``level`` and ``subject`` are not decoration: with them the run is recorded under the key its
    durable row will carry, so a process that dies and comes back does not pay for this discovery
    twice in the same day's tally.
    """
    from wobo_gateway import spend

    key = run_key(framework_id, level, subject) if (level or subject) else None
    run = Run(framework_id=framework_id, started_usd=spend.spent_usd(), key=key)
    try:
        yield run
    finally:
        run.spent_usd = run.so_far()
        record(framework_id, run.spent_usd, key=run.key)


# --- a refusal is remembered ------------------------------------------------------------------
def remember_refusal(framework_id: str | None, reason: str, *, at: str | None = None) -> None:
    """Write down that this board refused, and why. Only the board-level reasons rest a board."""
    if reason not in BOARD_LEVEL_REASONS:
        return
    board = _board(framework_id)
    with _lock:
        _roll_locked(_today())
        _refusals.setdefault(board, []).append((reason, at or datetime.now(UTC).isoformat()))


def resting(framework_id: str | None) -> str | None:
    """The reason this board is being left alone, or ``None``.

    A board rests after :data:`REFUSALS_BEFORE_REST` refusals about the board itself, and wakes
    on its own at the next UTC day or when the owner asks (:func:`wake`). This is what stops the
    tenth learner who picks Tamil Nadu from paying for the tenth failed handshake.
    """
    board = _board(framework_id)
    recover()
    with _lock:
        _roll_locked(_today())
        reasons = _refusals.get(board) or []
    return reasons[-1][0] if len(reasons) >= REFUSALS_BEFORE_REST else None


def wake(framework_id: str | None) -> None:
    """The owner's "try it again now", from the console: forget this board's refusals.

    For the rest of the day, too: the refusals are also written on the board's own rows, and a
    wake that the next read of those rows undid would be a button that did nothing.
    """
    board = _board(framework_id)
    with _lock:
        _roll_locked(_today())
        _refusals.pop(board, None)
        _woken.add(board)


# --- what a restart must not forget -------------------------------------------------------------
#: How many rows the recovery reads, and it asks for the day's FINISHED ones rather than a page
#: of everything. The day's ceiling is 5.00 USD and the cheapest run measured — a board refused at
#: the fetch — was 0.0089, so 562 runs is the most a day can physically hold; 800 is that with
#: room to spare, and one page of one query.
RECOVERY_LIMIT = 800
#: How often the day is read back while the process is up. It is not only about restarts: two
#: replicas each holding their own tally is the same hole, and a minute is the longest either may
#: be blind to what the other spent.
RECOVERY_INTERVAL_S = 60.0
#: And how soon after a store that would not answer. Short, because until the day is read back
#: the guard is holding nothing, and never zero, because a store that is down must not be asked
#: once per verdict.
RECOVERY_RETRY_S = 15.0

#: The states a row has to be in before its money is real. A queued job has spent nothing yet.
_FINISHED = frozenset({"stored", "refused", "failed"})


@dataclass(frozen=True)
class Row:
    """One finished discovery as its own durable row remembers it.

    ``usd`` is the row's ``result.cost_usd``: ``None`` when nothing on that run could be priced,
    which is a run that happened and an amount nobody knows — counted here as a run and as no
    money, exactly as the console's desk counts it.
    """

    framework_id: str | None
    level: str | None = None
    subject: str | None = None
    usd: float | None = None
    reason: str | None = None


def _rows_from_jobs(day: str) -> list[Row]:
    """The durable memory: ``curriculum.discovery_jobs``, the rows the console already reads.

    Not a table of its own. The worker writes ``result.cost_usd`` onto every row it ends — for a
    stored run and for a refused one — and ``result.reason`` says why a refusal happened, so the
    day's money and the day's closed doors are already written down where a person can see them.
    """
    from wobo_gateway.curriculum.store import get_store

    rows: list[Row] = []
    # Narrowed at the source, not here: the day's FINISHED rows only. A page of the newest rows
    # of every state would let a morning's queue push the morning's spending off the end of it,
    # and a day read back short is a day that can be spent twice.
    found = get_store().recent_jobs(limit=RECOVERY_LIMIT, since=day, states=sorted(_FINISHED))
    for job in found:
        if str(getattr(job.state, "value", job.state)) not in _FINISHED:
            continue
        # ``>=``, not ``startswith``: the store has already bounded this by the day as a
        # TIMESTAMP, and a string prefix would quietly drop every row of it if a deployment ever
        # rendered stamps at an offset other than UTC. Over-inclusive is the safe direction here;
        # dropping the day's spending is not.
        if str(job.updated_at or job.created_at or "") < day:
            continue
        result = job.result or {}
        cost = result.get("cost_usd")
        reason = result.get("reason")
        rows.append(
            Row(
                framework_id=job.framework_id,
                level=job.level,
                subject=job.subject,
                usd=None if cost is None else _amount(cost),
                reason=str(reason) if reason else None,
            )
        )
    return rows


#: Where the day is read back from. A module attribute so a test can hand it rows without a
#: store, the way ``dials.values`` is handed values without an ``ops.settings``.
durable_rows: Any = _rows_from_jobs


def _merge_locked(rows: Sequence[Row]) -> None:
    """Put the rows beside what this process holds. Never twice, never below what we know.

    Money is keyed by :func:`run_key`, so a run this process has already counted is recognised
    when its row lands rather than added again, and a run another replica paid for is added.
    Refusals are counted rather than keyed: three refusals of one subject are three closed doors
    in this process, and the row can only remember the last of them, so the recovery raises a
    board's count to what the rows show and never lowers it.
    """
    for row in rows:
        key = run_key(row.framework_id, row.level, row.subject)
        usd = _amount(row.usd)
        held = _spent.get(key)
        _spent[key] = (_board(row.framework_id), usd if held is None else max(held[1], usd))
    shut: dict[str, list[tuple[str, str]]] = {}
    for row in rows:
        if row.reason in BOARD_LEVEL_REASONS:
            shut.setdefault(_board(row.framework_id), []).append(
                (str(row.reason), datetime.now(UTC).isoformat())
            )
    for board, refusals in shut.items():
        if board in _woken:
            continue  # the owner has already said "try it again now" about this one today
        if len(refusals) > len(_refusals.get(board) or []):
            _refusals[board] = refusals


def recover(*, day: str | None = None, force: bool = False) -> bool:
    """Read the day back off the durable rows. Returns whether the rows were actually read.

    **This is what makes the ceiling a ceiling.** Everything above lives in module globals, so
    before this a redeploy, a crash loop or a second replica each started the day again at zero
    while the money kept being real — bounded per process, unbounded across restarts. The rows
    are per (board, class, subject) and carry what each run cost, so the day can be rebuilt from
    them, and is: on the first question asked after a start, and every
    :data:`RECOVERY_INTERVAL_S` after that, which is also what lets two replicas see each other.

    A store that will not answer never stops a discovery. It logs, it backs off, and the guard
    goes on holding whatever this process knows — the pre-existing behaviour, not a worse one.
    """
    global _read_at, _read_wait
    today = _today(day)
    now = time.monotonic()
    with _lock:
        _roll_locked(today)
        if not force and _read_wait > 0.0 and (now - _read_at) < _read_wait:
            return False
        # Claimed before the query, so a hundred questions in one tick are not a hundred queries.
        _read_at, _read_wait = now, RECOVERY_RETRY_S
    try:
        rows = list(durable_rows(today) or ())
    except Exception as exc:  # noqa: BLE001 — a store that will not answer never stops a run
        logger.warning("discovery ceiling: could not read the day back (%s)", exc)
        return False
    with _lock:
        _roll_locked(today)
        _merge_locked(rows)
        _read_at, _read_wait = time.monotonic(), RECOVERY_INTERVAL_S
    return True


__all__ = [
    "BOARD_KEY",
    "BOARD_LEVEL_REASONS",
    "DAY_KEY",
    "DEFAULT_BOARD_USD",
    "DEFAULT_DAILY_USD",
    "DEFAULT_RETRY_DAYS",
    "RECOVERY_INTERVAL_S",
    "RECOVERY_LIMIT",
    "RECOVERY_RETRY_S",
    "REFUSALS_BEFORE_REST",
    "RETRY_KEY",
    "RUNNING_KEY",
    "Row",
    "Run",
    "Spend",
    "board_ceiling_usd",
    "daily_ceiling_usd",
    "durable_rows",
    "key_for",
    "meter",
    "record",
    "recover",
    "remember_refusal",
    "reset",
    "resting",
    "retry_refused_after_days",
    "run_key",
    "running",
    "state",
    "verdict",
    "wake",
    "would_exceed",
]
