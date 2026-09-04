"""The migration directory is a SEQUENCE, and a gap in it is a migration nobody can account for.

On 2026-09-04 the directory ran 0001..0015, then 0017, then 0018. There is no 0016 anywhere in the
repository and none in any branch's history: `git log --all --diff-filter=A -- '.../0016*'` returns
nothing. So either a migration was written and lost, or a number was skipped by hand — and from the
directory alone nobody can tell which. That ambiguity is the whole problem, because the only way
anyone knows what has been applied to the project is by reading these names.

The live project on the same day had EIGHT of them applied, ending at 0012, while three separate
waves had already shipped features against 0015, 0017 and 0018. That check cannot live in this file
(no Postgres runs here and no test may reach the production project), so it lives in
`docs/OPERATIONS.md` §"Migrations not yet applied" as a dated, reproducible list. What CAN be
checked here is that the sequence itself is honest.
"""

from __future__ import annotations

import re
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra/supabase/migrations"
NAME = re.compile(r"^(\d{4})_[a-z0-9_]+\.sql$")


def _numbers() -> list[int]:
    out = []
    for path in sorted(MIGRATIONS.glob("*.sql")):
        match = NAME.match(path.name)
        assert match, f"a migration must be NNNN_snake_case.sql: {path.name}"
        out.append(int(match.group(1)))
    return out


def test_there_are_migrations_to_check() -> None:
    assert len(_numbers()) > 10


def test_the_sequence_has_no_gap() -> None:
    """A missing number is a migration that was written and lost, or one skipped by hand, and
    from the directory nobody can tell which."""
    numbers = _numbers()
    missing = [n for n in range(numbers[0], numbers[-1] + 1) if n not in numbers]
    assert not missing, (
        f"missing migration numbers: {missing}. Either restore the file or rename the ones after "
        f"it, so the directory is a sequence somebody can reason about."
    )


def test_no_number_is_used_twice() -> None:
    numbers = _numbers()
    assert len(numbers) == len(set(numbers)), "two migrations share a number"
