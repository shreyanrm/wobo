"""File cache under ``content/cache/`` — tier 1 of the content economy.

Artifacts are keyed (concept x modality x difficulty x board x class x syllabus version x variant).

THIS HEADER USED TO SAY THE OPPOSITE, AND THE OPPOSITE WAS WRONG. Until wave 30 the key digested
only (concept x modality x difficulty), and this file argued that was deliberate: one topic, one
verified artifact, reused across every board — the cost economy of CONTENT.md, with keying to
board paths named as the SUBJECTS.md §9 anti-pattern. What the judges measured is what that
actually bought (SCORECARD §3.5 fix 6, mathematics-eng.md §1.2, biology-eng.md §1): the CBSE
class 8 key EQUALLED the ISC class 11 key, so a class 3 request was served the class 11 module
byte-for-byte in 3 ms, and a ``contentVersion`` bump to 2099.9 returned the 2026-27 artifact
forever because the request's version was inert. Reuse across a whole board and a whole school
career is not reuse, it is one lesson pretending to be twelve.

So the key now carries the coordinate that changes the CONTENT: ``board`` (an ICSE chapter is not
a CBSE chapter), ``grade`` (class 6 fractions is not class 11 quadratics), ``contentVersion`` (a
syllabus revision must miss, which is the only thing that makes a revision reach a learner), and
``variant`` (a raster ``engine.image`` diagram is not the line-art SVG — they collided, which is
why every ``image.svg`` in the lab is byte-identical to its ``diagram.svg``). Difficulty stays in
the key as before.

What is still a *mapping layer* only, and still never in the key: ``subject`` and ``chapter``.
Two boards that file one concept under different chapter names still share one artifact, and that
is where the real reuse lives — they resolve a request to a conceptId at serve time (via
``concept_id``). Board and grade are normalized before they are digested ("CBSE" == "cbse",
"8" == "Class 8"), so a spelling difference never costs a second generation. Personalization is
NEVER in the key or the record — Wobo personalizes the shared artifact at runtime. Each record
carries provenance ``{engine, model, prompt_version}``.

THE FILE IS THE FRONT; POSTGRES IS THE TRUTH (wave 47, docs/CACHES.md). Until this wave the two
sentences below this one said the file cache was "the source of truth", and in production that
meant the truth lived in ``/home/gateway/cache`` — a directory inside a Railway container's
writable layer, with no volume mounted at it in ``railway.json`` — so every artifact the platform
had ever generated was discarded on each deploy and paid for again. ``plexus/db.py`` is the
database behind this file, and the order is now:

    file front   hit   -> serve, microseconds, no network
    file front   miss  -> database (:mod:`wobo_gateway.plexus.db`)
    database     hit   -> serve, tens of milliseconds, AND re-index onto the file front
    database     miss  -> generate, then write BOTH

Nothing about the key changed. This file remains the single definition of what a key IS
(:func:`artifact_path` and :func:`cache_key` compute the same digest), and ``db.py`` never derives
one. With no database configured every seam below is exactly what it was: a file cache.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import logging
import os
import re
import tempfile
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

logger = logging.getLogger("wobo.gateway.plexus.store")

# v3: full type universe — cards may carry any rich activity (perturbation, whatIf, compare,
# conceptMap, mini-workbook, flashcards, derivation, wordProblem, podcast, arcade) alongside the
# guided-discovery spec and imageSpec; a bump regenerates pre-doctrine caches into richer courses.
# v4: CONTENT-VISUALS.md — content-visual law (filled tactile objects + mark 'fill'), bump so
# pre-doctrine hairline caches regenerate into weighted, Brilliant-bar visuals.
PROMPT_VERSION = "plexus-v4"

# Validation lifecycle. A live artifact serves immediately as PROVISIONAL (its first learner never
# waits on the judge); a post-serve validation gate promotes it to CANONICAL (best-of after a
# possible Opus escalation of a GPT-5.5 primary). Cache load prefers canonical, never blocks on
# provisional. SUPERSEDED / REJECTED never sit at the live pointer — they exist only in the
# immutable version ledger (see save_version): a provisional that a better regeneration replaced is
# SUPERSEDED; a regeneration attempt that lost best-of is REJECTED.
PROVISIONAL = "provisional"
CANONICAL = "canonical"
SUPERSEDED = "superseded"
REJECTED = "rejected"


def status(record: dict[str, Any]) -> str:
    """A record with no status is a legacy, pre-validation artifact — treat it as canonical
    (already verified and stable), never provisional (which would re-trigger validation)."""
    return record.get("status") or CANONICAL


#: Where the platform mounts a disk that outlives a deploy. Railway sets this in the container the
#: moment a volume is attached, so the cache follows the disk without anybody editing an env var —
#: and until 2026-09-10 nothing read it: the image cached to ``/home/gateway/cache``, a path in the
#: container's own writable layer, and every deploy threw away every core (USD 0.031 each), every
#: level, every design and every turn and bought them again.
MOUNT_ENV = "RAILWAY_VOLUME_MOUNT_PATH"

#: What the cache is called inside the mount. One directory, so a volume can carry other things.
MOUNT_SUBDIR = "plexus"


def volume_path() -> Path | None:
    """The attached durable disk, or None when the container has none."""
    mount = (os.getenv(MOUNT_ENV) or "").strip()
    return Path(mount) if mount else None


def cache_dir() -> Path:
    """Where the artifact cache lives, in the order that keeps a deploy from costing money.

    An explicit ``PLEXUS_CACHE_DIR`` always wins: a lab, a test and a laptop each name their own.
    Otherwise an attached volume is used when there is one, and only then the repo-relative
    development default.
    """
    override = os.getenv("PLEXUS_CACHE_DIR")
    if override:
        return Path(override)
    mount = volume_path()
    if mount is not None:
        return mount / MOUNT_SUBDIR
    # ponytail: repo-relative default works for dev/tests; deployments set PLEXUS_CACHE_DIR.
    return Path(__file__).resolve().parents[5] / "content" / "cache"


def cache_is_durable() -> bool:
    """Does what this container writes to the cache survive the next deploy?

    True only when the cache is inside the attached volume. A path in the writable layer is a
    cache that is thrown away with the container, which is a correct cache and a false economy,
    and the gateway has to be able to say which one it is running (``health.snapshot``).
    """
    mount = volume_path()
    if mount is None:
        return False
    try:
        cache_dir().resolve().relative_to(mount.resolve())
    except (ValueError, OSError):
        return False
    return True


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60] or "concept"


# --- the curriculum coordinate, and the half of it that keys ---------------------------
# SCOPE_KEYS is what rides in every engine payload; engines._scope reads this tuple.
SCOPE_KEYS = ("board", "grade", "subject", "chapter", "contentVersion")

# KEY_SCOPE_KEYS is the half of it that changes the CONTENT and therefore digests into the key
# (wave 30, SCORECARD §3.5 fixes 6 and 10). ``subject`` and ``chapter`` stay out: they are the
# mapping layer that resolves a request to a conceptId, and keeping them out is what still lets
# two boards filing one concept under different chapter names share one artifact.
# ``variant`` is not curriculum — it is the artifact variant a payload asks for (today: the raster
# ``engine.image`` diagram vs the line-art SVG), set by engines._scope via :func:`variant_of`.
KEY_SCOPE_KEYS = ("board", "grade", "contentVersion", "variant")


def variant_of(payload: dict[str, Any]) -> str:
    """The artifact variant a request asks for — a key part, not a curriculum coordinate.

    ``payload["raster"]`` selects the Nano-Banana image path in ``engines._generate_live``, which
    produces genuinely different content from the line-art SVG. It never entered the key, so both
    resolved to one file and whichever ran first (compose, always) won — the raster path was
    unreachable in practice (mathematics-eng.md §1.5)."""
    return "raster" if payload.get("raster") else ""


def _grade_key(grade: str) -> str:
    """Normalize a class so one class spelled two ways is still one artifact.

    "8", "Class 8" and "class-8" are the same eleven-year-old; digesting them separately would
    triple the miss rate and the money for content that must be identical.

    Exactly ONE integer in the string is the class. Taking the FIRST integer merged classes that
    are not the same class — "11" and "11-12" (the ordinary way senior secondary is written in
    Indian syllabus documents) resolved to one key, as did "10" and "Class 10 (2019 scheme)", so
    a class-span or scheme-specific request was silently served the class-11 artifact. That is
    over-MERGING, the very defect the scoped key exists to remove. Anything else — a span, a
    dated scheme, a named stage with no integer — falls back to its slug, which over-splits at
    worst and costs one extra generation."""
    numbers = re.findall(r"\d+", grade)
    return numbers[0] if len(numbers) == 1 else _slug(grade)


def scope_key(scope: dict[str, str] | None) -> str:
    """The key contribution of a request's scope. Empty string when a caller supplies none —
    which keeps an unscoped call (tests, ``migrate``, an internal reindex) on the bare
    concept key it has always had."""
    s = scope or {}
    parts = []
    for k in KEY_SCOPE_KEYS:
        raw = str(s.get(k) or "").strip()
        if not raw:
            parts.append("")
        else:
            parts.append(_grade_key(raw) if k == "grade" else _slug(raw))
    return "" if not any(parts) else "\x00".join(parts)


def _concepts_file() -> Path:
    override = os.getenv("PLEXUS_CONCEPTS_PATH")
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[5] / "content" / "catalogs" / "concepts.json"


@lru_cache(maxsize=1)
def _overrides() -> dict[str, str]:
    """Explicit ``board|grade|subject|chapter|topic`` -> conceptId remaps from the registry. Empty
    when the registry has none — in which case pure topic-identity derivation is authoritative.
    Overrides exist for the two hard cases: boards that NAME the same concept differently (merge
    them onto one id) and boards that reuse a generic name for DIFFERENT concepts (split them)."""
    try:
        data = json.loads(_concepts_file().read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    raw = data.get("overrides") if isinstance(data, dict) else None
    if not isinstance(raw, dict):
        return {}
    return {str(k).lower().strip(): str(v).strip() for k, v in raw.items() if v}


def _override_key(concept: str, scope: dict[str, str] | None) -> str:
    s = scope or {}
    parts = [str(s.get(k) or "") for k in ("board", "grade", "subject", "chapter")]
    return "|".join([*parts, concept]).lower().strip()


def concept_identity(concept: str, scope: dict[str, str] | None = None) -> str:
    """The FULL normalized identity of a concept — lowercased, whitespace-collapsed, untruncated.

    This, not the slug, is what the cache digest binds to. ``_slug`` cuts at 60 characters, so two
    different long topics that share a prefix produce the same slug; keying on the slug would let
    one topic's artifact be served for another (cache poisoning by collision). The slug stays as
    the human-readable half of the filename; the digest carries the real identity."""
    ov = _overrides()
    if ov:
        hit = ov.get(_override_key(concept, scope))
        if hit:
            concept = hit
    return re.sub(r"\s+", " ", concept).strip().lower()


def concept_id(concept: str, scope: dict[str, str] | None = None) -> str:
    """Resolve a (topic, curriculum scope) request to its board-agnostic concept id. An explicit
    registry override wins; otherwise the id IS the topic's normalized identity, so two boards that
    name a topic identically collapse to one id (and one cache entry)."""
    return _slug(concept_identity(concept, scope))


def _inside_cache(path: Path) -> Path:
    """Assert a computed artifact path really lands inside the cache directory.

    Every path component is slugged before it gets here, so this can only fire on a coding
    mistake — but the assertion is what makes that guarantee checkable rather than assumed
    (a traversal in ``difficulty`` or ``modality`` would otherwise write anywhere on disk)."""
    root = cache_dir().resolve()
    resolved = path.resolve()
    if not resolved.is_relative_to(root):
        raise ValueError(f"artifact path escapes the cache directory: {path}")
    return resolved


def _digest_for(
    concept: str, modality: str, difficulty: str, scope: dict[str, str] | None
) -> tuple[str, str, str, str]:
    """``(conceptId, slugged modality, slugged difficulty, digest)`` — the key, computed once.

    Factored out of :func:`artifact_path` so the file name and the database key are the SAME
    computation rather than two implementations that agree until one of them is edited.
    """
    cid = concept_id(concept, scope)
    modality = _slug(modality)
    difficulty = _slug(difficulty)
    identity = concept_identity(concept, scope)
    body = f"{identity}\x00{modality}\x00{difficulty}"
    skey = scope_key(scope)
    if skey:  # an unscoped call keeps the bare concept key it has always had
        body += f"\x00{skey}"
    return cid, modality, difficulty, hashlib.sha256(body.encode()).hexdigest()[:16]


def cache_key(
    concept: str, modality: str, difficulty: str, scope: dict[str, str] | None = None
) -> str:
    """The key a store row is filed under — the artifact's path, without the directory or suffix.

    Readable on purpose (``diagram/photosynthesis--core--1f2e…``), because it is the thing an
    operator reads on the stores desk and pastes into a query. It is one-to-one with the file
    path: the digest already carries the modality, so the leading modality is for the human.
    """
    cid, modality, difficulty, digest = _digest_for(concept, modality, difficulty, scope)
    return f"{modality}/{cid}--{difficulty}--{digest}"


def artifact_path(
    concept: str, modality: str, difficulty: str, scope: dict[str, str] | None = None
) -> Path:
    # The key is the concept PLUS the part of the request that changes what the content says:
    # board, class, syllabus version and variant (:data:`KEY_SCOPE_KEYS`). ``scope`` also still
    # resolves the conceptId (registry overrides); ``subject`` and ``chapter`` remain mapping-only.
    # modality and difficulty are slugged BEFORE they become path components: they arrive from the
    # request body, and "../../etc" is a directory traversal, not a difficulty. The scope half is
    # digested, never a path component, so a hostile board name cannot walk out of the cache dir.
    cid, modality, difficulty, digest = _digest_for(concept, modality, difficulty, scope)
    return _inside_cache(cache_dir() / modality / f"{cid}--{difficulty}--{digest}.json")


def _legacy_artifact_path(
    concept: str, modality: str, difficulty: str, scope: dict[str, str] | None = None
) -> Path:
    """Where this artifact lived before the digest bound to the full concept identity.

    Read-only: :func:`load` falls back to it and re-indexes the record onto the current key, so a
    warm cache survives the change without a bulk copy and without ever touching the old file
    (retention law). :func:`migrate` does the same sweep for an operator who wants it done eagerly.
    """
    cid = concept_id(concept, scope)
    digest = hashlib.sha256(f"{cid}\x00{modality}\x00{difficulty}".encode()).hexdigest()[:12]
    name = f"{cid}--{_slug(difficulty)}--{digest}.json"
    return _inside_cache(cache_dir() / _slug(modality) / name)


def _carry_manifests(src: Path, dst: Path) -> None:
    """Re-key a video's render manifests alongside its record.

    A baked MP4 is found through ``{stem}.*.render-manifest.json``, so a record that moves to a
    new key without its manifests silently loses the film it already has. The MP4 itself is
    named independently and lives in the same directory, so only the manifests are re-keyed."""
    for man in src.parent.glob(f"{src.stem}.*.render-manifest.json"):
        target = dst.parent / man.name.replace(src.stem, dst.stem, 1)
        if not target.exists():
            _write_atomic(target, man.read_text(encoding="utf-8"))


def _write_atomic(path: Path, text: str) -> None:
    """Write a cache file so a concurrent reader never sees a half-written record.

    A background thread (post-serve validation / promotion) rewrites the same path a reader may be
    parsing, and ``Path.write_text`` truncates in place — a reader between the truncate and the
    flush gets a torn file and a JSONDecodeError. Writing to a temp file in the SAME directory (so
    the rename cannot cross a filesystem) and ``os.replace``-ing it makes the swap atomic: a reader
    sees either the whole old record or the whole new one. The encoding is pinned to UTF-8 because
    records carry non-ASCII content and the platform default is not guaranteed to be UTF-8."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


def write_atomic(path: Path, text: str) -> None:
    """The same crash-safe write, for a cache file that is not an artifact record.

    The spoken-line cache in ``plexus/media.py`` keeps WAV audio beside the artifacts and needs
    exactly the guarantee above — a reader must never meet a half-written file. The containment
    assertion comes with it: a caller cannot write outside the cache directory through this seam
    any more than :func:`save` can.
    """
    _write_atomic(_inside_cache(path), text)


def _read(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _from_database(
    concept: str, modality: str, difficulty: str, scope: dict[str, str] | None
) -> dict[str, Any] | None:
    """The row Postgres holds for this key, re-indexed onto the file front on the way past.

    This is the seam that makes a new container warm instead of empty. It is deliberately quiet:
    an unreachable database, an unconfigured one, or a row whose body is not an artifact is a
    cache MISS and a regeneration — expensive, correct, and never an error a learner sees.
    """
    from wobo_gateway.plexus import db

    if not db.configured():
        return None
    try:
        return _read_from_database(concept, modality, difficulty, scope)
    except Exception:  # a cache read must never fail the generation that asked for it
        logger.warning("plexus: the store read for %r failed", concept, exc_info=True)
        return None


def _read_from_database(
    concept: str, modality: str, difficulty: str, scope: dict[str, str] | None
) -> dict[str, Any] | None:
    from wobo_gateway.plexus import db

    key = cache_key(concept, modality, difficulty, scope)
    row = db.read(db.LEVELS, key)
    if not isinstance(row, dict):
        db.note_miss(db.LEVELS)
        return None
    record = row.get("body")
    if not isinstance(record, dict):
        db.note_miss(db.LEVELS)
        return None
    db.note_database_hit(db.LEVELS, row.get("cost_usd"))
    db.note_serve(db.LEVELS, row.get("id"))
    # Warm the front so the SECOND read of this artifact is microseconds again. A read-only cache
    # directory still serves the record; it just pays the database on every read.
    with contextlib.suppress(OSError, TypeError, ValueError):
        _write_atomic(
            artifact_path(concept, modality, difficulty, scope),
            json.dumps(record, ensure_ascii=False, indent=1),
        )
    return record


def load(
    concept: str, modality: str, difficulty: str, scope: dict[str, str] | None = None
) -> dict[str, Any] | None:
    path = artifact_path(concept, modality, difficulty, scope)
    record = _read(path)
    if record is not None:
        from wobo_gateway.plexus import db

        db.note_front_hit(db.LEVELS)
        return record
    # The file front missed. Postgres is the truth (docs/CACHES.md §2) and it is asked BEFORE the
    # legacy fallback below, because a row in the database is scoped and a legacy file is not.
    from_db = _from_database(concept, modality, difficulty, scope)
    if from_db is not None:
        return from_db
    # The legacy file is board-, class- and version-BLIND: nothing recorded which learner it was
    # written for. Re-indexing it onto a scoped key would hand a CBSE class 8 request an artifact
    # that may have been generated for ISC class 11 — the exact defect the scoped key exists to
    # end. So the fallback serves only an unscoped call. A scoped request misses and regenerates;
    # the old file is still never touched (retention), and `migrate` still reindexes it.
    if scope_key(scope):
        return None
    legacy = _legacy_artifact_path(concept, modality, difficulty, scope)
    if legacy == path:
        return None
    record = _read(legacy)
    if record is None:
        return None
    try:  # self-heal: re-index onto the current key. The old file is never touched.
        _write_atomic(path, legacy.read_text(encoding="utf-8"))
        _carry_manifests(legacy, path)
    except OSError:
        pass  # a read-only cache dir still serves the record; it just re-reads the legacy path
    return record


def save(
    concept: str,
    modality: str,
    difficulty: str,
    record: dict[str, Any],
    scope: dict[str, str] | None = None,
) -> None:
    """Write the live pointer: the file front FIRST, then the database.

    The order matters and is not arbitrary. The file is what the very next request reads, and it
    cannot fail on a network; the database write is the one that survives the deploy. If the
    database is unreachable the artifact is still cached in this container and still served — the
    platform simply pays for it again after the next deploy, which is exactly the behaviour this
    wave replaces rather than a new failure it introduces.
    """
    path = artifact_path(concept, modality, difficulty, scope)
    _write_atomic(path, json.dumps(record, ensure_ascii=False, indent=1))
    _save_to_database(concept, modality, difficulty, record, scope)


def _save_to_database(
    concept: str,
    modality: str,
    difficulty: str,
    record: dict[str, Any],
    scope: dict[str, str] | None,
) -> None:
    """Persist the same artifact as a ``content.levels`` row. Never raises into a caller.

    A plexus artifact IS a level rendering — one concept, one board, one class, one modality — so
    it lands in that store. Cores, interaction designs, assets and generic turns are written by
    their own producers straight through :mod:`wobo_gateway.plexus.db`.
    """
    from wobo_gateway.plexus import db

    if not db.configured():
        return
    try:
        row = db.row_for_level(
            cache_key(concept, modality, difficulty, scope),
            record,
            concept_id=concept_id(concept, scope),
            scope=scope,
        )
        db.write(db.LEVELS, row)
    except Exception:  # a cache write must never take a generation down with it
        logger.warning("plexus: the store row for %r could not be written", concept, exc_info=True)


# --- immutable version ledger (owner law, 2026-07-07) ----------------------------------
# EVERY generated version of a coordinate is kept FOREVER — never deleted, never overwritten.
# The GPT-5.5 attempt, the Opus regeneration, the provisional-then-promoted, the loser of a
# best-of: each lands here as its own write-once file. save() above still writes the single live
# pointer (the cache-hit path reads it); this ledger is the audit trail + the substrate for future
# manual human edits. Cheap on disk, priceless as a record.


def versions_dir(
    concept: str, modality: str, difficulty: str, scope: dict[str, str] | None = None
) -> Path:
    """The append-only directory of every version ever produced for one coordinate."""
    base = artifact_path(concept, modality, difficulty, scope)
    return base.parent / "versions" / base.stem


def save_version(
    concept: str,
    modality: str,
    difficulty: str,
    record: dict[str, Any],
    scope: dict[str, str] | None = None,
) -> Path:
    """Append one immutable version record. Write-once: a filename that already exists is never
    clobbered (the sub-second stamp is nudged until it is free), so no version is ever lost."""
    vdir = versions_dir(concept, modality, difficulty, scope)
    vdir.mkdir(parents=True, exist_ok=True)
    prov = record.get("provenance") if isinstance(record.get("provenance"), dict) else {}
    model = _slug(str((prov or {}).get("model") or "unknown"))
    status = str(record.get("status") or CANONICAL)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%f")
    path = vdir / f"{stamp}-{status}-{model}.json"
    while path.exists():  # never overwrite a prior version — disambiguate a same-microsecond clash
        stamp += "x"
        path = vdir / f"{stamp}-{status}-{model}.json"
    _write_atomic(path, json.dumps(record, ensure_ascii=False, indent=1))
    return path


def load_versions(
    concept: str, modality: str, difficulty: str, scope: dict[str, str] | None = None
) -> list[dict[str, Any]]:
    """Every persisted version for a coordinate, oldest first (the timestamped filename sorts)."""
    vdir = versions_dir(concept, modality, difficulty, scope)
    out: list[dict[str, Any]] = []
    if not vdir.is_dir():
        return out
    for path in sorted(vdir.glob("*.json")):
        try:
            out.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    return out


# --- migration to concept keys (retention law: re-index, never delete) -----------------
# Pre-concept caches were keyed by the curriculum path (raw concept + board+grade+subject+chapter).
# migrate() re-indexes every one onto its board-agnostic conceptId key: it COPIES the record to the
# new key (if absent) and appends an alias record — the old file is never touched, so retention and
# the version ledger survive. Several old scoped variants of one concept collapse onto a single
# conceptId: the first wins the live pointer, the rest are recorded as aliases (the reuse the whole
# re-key exists to produce). Idempotent — a file already at its conceptId key is skipped.


def _alias_log() -> Path:
    return cache_dir() / "_migrations" / "aliases.jsonl"


def _logged_aliases() -> set[tuple[str, str]]:
    """The (from, to) pairs already recorded, so a re-run reports nothing new."""
    log = _alias_log()
    seen: set[tuple[str, str]] = set()
    if not log.is_file():
        return seen
    for line in log.read_text(encoding="utf-8").splitlines():
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        seen.add((str(rec.get("from")), str(rec.get("to"))))
    return seen


def migrate() -> list[dict[str, Any]]:
    """Re-index the on-disk cache onto concept keys. Returns the alias records written.

    Idempotent: a pair already in the alias log is skipped, so running this twice is a no-op
    (the source file is never touched, so it keeps mapping to the same destination forever)."""
    aliases: list[dict[str, Any]] = []
    root = cache_dir()
    if not root.is_dir():
        return aliases
    already = _logged_aliases()
    for mdir in sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith("_")):
        modality = mdir.name
        for path in sorted(mdir.glob("*.json")):
            if path.name.endswith(".render-manifest.json"):
                continue
            try:
                record = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            concept = str(record.get("concept") or "").strip()
            difficulty = str(record.get("difficulty") or "core").strip() or "core"
            if not concept or str(record.get("modality") or "") != modality:
                continue
            new_path = artifact_path(concept, modality, difficulty)  # concept identity — no scope
            if new_path == path:
                continue  # already conceptId-keyed
            if (path.name, new_path.name) in already:
                continue  # re-indexed on an earlier run
            if not new_path.exists():
                # re-index; old file untouched (retention)
                _write_atomic(new_path, path.read_text(encoding="utf-8"))
                _carry_manifests(path, new_path)  # keep a re-keyed video's baked MP4
            alias = {
                "from": path.name,
                "to": new_path.name,
                "concept": concept,
                "conceptId": concept_id(concept),
                "modality": modality,
                "difficulty": difficulty,
                "migratedAt": datetime.now(UTC).isoformat(timespec="seconds"),
            }
            aliases.append(alias)
    if aliases:
        log = _alias_log()
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open("a", encoding="utf-8") as fh:
            for alias in aliases:
                fh.write(json.dumps(alias, ensure_ascii=False) + "\n")
    return aliases


if __name__ == "__main__":  # operator entrypoint: python -m wobo_gateway.plexus.store
    written = migrate()
    print(f"migrated {len(written)} cache artifact(s) onto concept keys")
    for a in written:
        print(f"  {a['modality']}/{a['from']} -> {a['to']}  ({a['conceptId']})")


# --- the depth band: which mind is reaching for this concept -----------------------------
#
# docs/CONTENT-INTERACTION.md §5b, decided 2026-09-11. The core below was specified as keyed on
# "the concept alone", and for most of the syllabus that holds: a concept is taught in exactly one
# class, so it has exactly one core and nothing multiplies. It breaks for the concepts that RECUR.
# Fractions is taught in class 4, again in 6, again in 8. The class 11 treatment of electric
# current contains the class 7 one. A single core written to satisfy class 11 loses the class 7
# child inside its first sentence; one written for class 7 is useless at 11. There is no sentence
# that is honest at both ends, so the core is keyed on CONCEPT x DEPTH BAND.
#
# THE BAND IS READ FROM THE SYLLABUS, NEVER INVENTED AND NEVER ASKED OF A MODEL. The concept
# registry already carries the classes each concept is catalogued in (the discovery pass writes
# them), and this section groups those classes into bands. Everything here is PURE: a JSON file
# the repo ships, some integers, and no network, no model, no clock and no database. That is what
# makes it testable offline and what keeps a cache key from ever depending on a model's mood.
#
# Why bands and not classes: inside a band the difference between two classes is WHAT HAS BEEN
# COVERED, which is exactly what the level rendering already carries (board, grade, chapter,
# version). Across bands the difference is HOW A MIND REACHES FOR THE IDEA, and no amount of level
# rendering repairs that. The band boundary is where the level layer stops being able to do the
# work.

FOUNDATION = "foundation"  # classes 1 to 5
MIDDLE = "middle"  # classes 6 to 8
SENIOR = "senior"  # classes 9 to 12

#: The bands, shallowest first. The order is the key's order too, so a listing reads in the order
#: a learner meets them.
BANDS: tuple[str, ...] = (FOUNDATION, MIDDLE, SENIOR)

#: The band of a request that names no class AND whose concept the syllabus teaches in more than
#: one band. It is its OWN key space, never a default band: "nobody said which" filed as
#: "foundation" is precisely the papering-over §5b forbids, and it would hand a class 4 core to a
#: caller who never said class 4. An unscoped internal call (a reindex, a test) lands here and is
#: self-consistent — it writes and reads the same key — without ever colliding with a real band.
UNBANDED = "unbanded"

#: Every band a core key may carry.
CORE_BANDS: tuple[str, ...] = (*BANDS, UNBANDED)

#: The last class in each band, shallowest first. Classes outside 1..12 are not classes.
_BAND_CEILINGS: tuple[tuple[int, str], ...] = ((5, FOUNDATION), (8, MIDDLE), (12, SENIOR))

#: How a band is said to a model, so a core prompt can name its reader's depth without naming a
#: class (a core that knew one class would be written for that class, which is the thing a core
#: may not be).
BAND_CLASSES: dict[str, str] = {
    FOUNDATION: "classes 1 to 5",
    MIDDLE: "classes 6 to 8",
    SENIOR: "classes 9 to 12",
    UNBANDED: "no class was named",
}


def band_of_class(grade: str) -> str | None:
    """Which band ONE class sits in, or ``None`` when the string does not name exactly one band.

    Pure, and deliberately forgiving of how Indian syllabus documents write a class: "6", "Class
    6" and "class-6" are one eleven-year-old and one band. A SPAN inside a band resolves — "11-12"
    is the ordinary way senior secondary is written and both ends are senior — while a span that
    crosses a boundary ("8-9") does not, because it genuinely straddles the place where the two
    minds differ and guessing one of them is the borrow §5b forbids. A number that is not a class
    is ignored rather than read as one: "Class 10 (2019 scheme)" is senior, not senior-and-nothing.
    """
    found: list[str] = []
    for raw in re.findall(r"\d+", str(grade or "")):
        n = int(raw)
        if n < 1:
            continue
        for ceiling, band in _BAND_CEILINGS:
            if n <= ceiling:
                if band not in found:
                    found.append(band)
                break
    return found[0] if len(found) == 1 else None


@lru_cache(maxsize=1)
def _registry_classes() -> dict[str, tuple[str, ...]]:
    """``conceptId -> the classes the catalogued syllabus teaches it in``, from the registry.

    The same file the overrides come from, read once. An unreadable or malformed registry is an
    empty map and never an exception: a band that cannot be read falls back to the request's own
    class, which is worse than the syllabus and far better than a stack trace in a cache key."""
    try:
        data = json.loads(_concepts_file().read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    concepts = data.get("concepts") if isinstance(data, dict) else None
    if not isinstance(concepts, dict):
        return {}
    out: dict[str, tuple[str, ...]] = {}
    for cid, entry in concepts.items():
        if not isinstance(entry, dict):
            continue
        grades = entry.get("grades")
        if not isinstance(grades, list):
            continue
        classes = tuple(str(g).strip() for g in grades if str(g).strip())
        if classes:
            out[str(cid).strip().lower()] = classes
    return out


def forget_registry() -> None:
    """Drop the cached registry. Public because a test that points ``PLEXUS_CONCEPTS_PATH`` at a
    fixture needs it, exactly as :func:`wobo_gateway.curriculum.concepts.forget` does."""
    _registry_classes.cache_clear()
    _overrides.cache_clear()


def classes_for_concept(concept: str, scope: dict[str, str] | None = None) -> tuple[str, ...]:
    """The classes the catalogued syllabus teaches this concept in. Empty when it has never been
    catalogued — a minted concept off a board nobody has seeded yet, which is honest rather than
    a gap: the registry cannot say, so nothing here pretends it did."""
    return _registry_classes().get(concept_id(concept, scope), ())


def bands_for_concept(concept: str, scope: dict[str, str] | None = None) -> tuple[str, ...]:
    """The bands that ACTUALLY teach this concept, shallowest first.

    This is the set of cores a concept may ever have, and it is the whole cost story of §5b:
    fractions (4, 6 and 8) returns two bands, so two cores and not three and not twelve; a
    concept taught only in class 9 returns one, so one core and it costs exactly what it costs
    today. Empty when the registry has never catalogued the concept."""
    found = {band_of_class(c) for c in classes_for_concept(concept, scope)}
    return tuple(b for b in BANDS if b in found)


def band_for(
    concept: str,
    scope: dict[str, str] | None = None,
    *,
    classes: tuple[str, ...] | list[str] | None = None,
) -> str:
    """THE resolver: which band's core this request needs. Pure, offline, no model call.

    Three rules, in this order, and each one is the law's own sentence:

    1. **The syllabus teaches the concept in exactly one band** — that band, for every class that
       asks. There is no second band to be honest about, so there is no distance for the level
       layer to fail at, and "a concept taught only in class 9: one core, and it costs exactly
       what it costs today" stays true even when a class 6 stretch module or a free-text goal
       reaches for it. This is the common case: 3771 of the 3948 catalogued concepts.
    2. **Otherwise the request's own class decides, among the bands that teach it.** For a
       concept the syllabus teaches in more than one band, the distance §5b exists for is real,
       and the band the learner is actually in is the only honest answer. A band with no core yet
       gets one (:func:`load_core` misses and ``engines.core_for`` makes it); it never borrows
       the neighbour's. A class OUTSIDE every band that teaches the concept (a class 9 repair
       module reaching back for fractions, which the syllabus teaches in 4, 6 and 8) gets the
       nearest band that does teach it, the shallower one when two are equally near: "a concept
       gets one core per band that actually teaches it" is the count the law fixes, and a senior
       core for fractions would make it three. This is rule 1 again, one band at a time.
    3. **Nothing named a class and the syllabus named more than one band** — :data:`UNBANDED`,
       which is its own key space rather than a guess.
    4. **The registry has never catalogued the concept** — the request's own class, because
       nothing else can say, and :data:`UNBANDED` when there is no class either.

    ``classes`` lets a caller who knows better than the registry say so (the curriculum publisher
    holding a board's own class list for this concept). It is the same computation either way.
    """
    if classes is not None:
        seen = {band_of_class(c) for c in classes}
        taught: tuple[str, ...] = tuple(b for b in BANDS if b in seen)
    else:
        taught = bands_for_concept(concept, scope)
    if len(taught) == 1:
        return taught[0]
    asked = band_of_class(str((scope or {}).get("grade") or ""))
    if asked is None:
        return UNBANDED
    if not taught or asked in taught:
        return asked
    return nearest_taught_band(asked, taught)


def nearest_taught_band(asked: str, taught: tuple[str, ...]) -> str:
    """The band nearest to ``asked`` among ``taught``, the shallower one on a tie.

    Pure, so the rule can be read on its own: distance is counted in bands (foundation to senior
    is two), and a tie (a middle learner reaching for a concept taught in foundation and senior
    only) goes to the shallower band, because a core that under-reaches a learner is met by the
    level rendering's own class and a core that over-reaches loses them in its first sentence
    (§5b). An ``asked`` that is not a band, or an empty ``taught``, is a coding mistake."""
    if asked not in BANDS or not taught:
        raise ValueError(f"cannot place {asked!r} among {taught!r}")
    depth = {band: i for i, band in enumerate(BANDS)}
    return min(
        (b for b in BANDS if b in taught), key=lambda b: (abs(depth[b] - depth[asked]), depth[b])
    )


# --- the concept core: the second key, and the only one that is the concept alone -------
#
# THE THREE LAYERS (docs/CONTENT-INTERACTION.md §1, docs/CACHES.md §1). Everything above this
# line is the LEVEL RENDERING's key: concept x board x grade x syllabus version x variant, which
# is right for the reading, the worked example and the quiz — a CBSE class 6 child and an ISC
# class 11 student must not be handed the same words.
#
# But most of what makes a concept teachable does NOT change between boards: the idea, why it
# matters, the two commonest misconceptions and their counter-examples, the one check that proves
# understanding, the vocabulary. That is the CONCEPT CORE, made once by the strongest model,
# judged hard, and reused by every board, interaction and learner forever. Wave 31 keyed
# everything to the board and so paid twelve times for the one thing that was identical twelve
# times; this is the half of that key that comes back off.
#
# THE HALF THAT DOES NOT COME OFF IS THE DEPTH BAND (docs/CONTENT-INTERACTION.md §5b, decided
# 2026-09-11). The core is keyed on CONCEPT x BAND, never on the concept alone: for a concept
# taught in one class that is the same one core it has always been, and for a concept that RECURS
# it is one core per band that actually teaches it. See the band section above for the resolver.
#
# ``scope`` is ACCEPTED here for two jobs and digested for one. It resolves the registry override
# (two boards that NAME one concept differently collapse onto one id), which is the mapping layer;
# and its ``grade`` resolves the BAND, which is in the key. The board, the chapter and the
# syllabus version are still nowhere near it: a core made for a CBSE class 6 request is the same
# file a later ICSE class 8 request reads, because both are middle.
#
# THE PROHIBITION IS ENFORCED HERE, NOT BY CONVENTION. §5b: *"A level rendering may never be asked
# to carry a core from another band."* Two things make that so rather than say it. The band is in
# the digest, so a senior request cannot name a middle file; and :func:`load_core` refuses a
# record whose own stamped band is not the band asked for, which catches a file or a database row
# that reached the right key by any other route.

#: A core generated under an older core prompt is stale and is made again (the same law the level
#: renderings live under). Bump when the core's schema or its prompt changes what a core contains.
CORE_PROMPT_VERSION = "core-v1"

CORE_MODALITY = "core"


def _core_band(concept: str, scope: dict[str, str] | None, band: str | None) -> str:
    """The band a core call is for: the caller's, when it named one, else the resolver's.

    An explicit band that is not a band is a coding mistake, not a request, and it is refused
    rather than slugged into a key nothing will ever read again."""
    if band is None:
        return band_for(concept, scope)
    if band not in CORE_BANDS:
        raise ValueError(f"{band!r} is not a depth band; one of {CORE_BANDS} was expected")
    return band


def core_path(
    concept: str, scope: dict[str, str] | None = None, *, band: str | None = None
) -> Path:
    """Where one concept's core FOR ONE BAND lives.

    Deliberately not :func:`artifact_path`: no modality, no difficulty, no board, no syllabus
    version. Two requests that differ in every curriculum coordinate and agree on the concept and
    the band land on this one file; two that agree on everything and differ in the band cannot
    reach each other's, which is §5b's prohibition made unexpressible rather than forbidden."""
    band = _core_band(concept, scope, band)
    cid = concept_id(concept, scope)
    digest = hashlib.sha256(f"{concept_identity(concept, scope)}\x00{band}".encode()).hexdigest()[
        :16
    ]
    return _inside_cache(cache_dir() / CORE_MODALITY / f"{cid}--{band}--{digest}.json")


def _legacy_core_path(concept: str, scope: dict[str, str] | None = None) -> Path:
    """Where a core lived before the key carried the band. Read-only, and read only for a concept
    the syllabus teaches in exactly ONE band (see :func:`_core_from_legacy`)."""
    cid = concept_id(concept, scope)
    digest = hashlib.sha256(concept_identity(concept, scope).encode()).hexdigest()[:16]
    return _inside_cache(cache_dir() / CORE_MODALITY / f"{cid}--{digest}.json")


def core_is_stale(record: dict[str, Any] | None) -> bool:
    """A core made under an older core prompt no longer holds what a level render reads."""
    if not isinstance(record, dict):
        return True
    return str(record.get("promptVersion") or "") != CORE_PROMPT_VERSION


def core_is_of_band(record: dict[str, Any] | None, band: str) -> bool:
    """Does this record belong to the band that asked for it?

    The second lock on §5b's prohibition. The key already makes borrowing unexpressible through
    the front door; this refuses a record that came through any other one — a row re-keyed by
    hand, a file restored from a pre-band backup, a database seeded by an operator. A record with
    NO stamp is accepted, because the only way it can be at this path is that this band wrote it;
    a record stamped with a DIFFERENT band is a miss, and a miss makes this band's own core."""
    if not isinstance(record, dict):
        return False
    stamped = str(record.get("band") or "").strip()
    return not stamped or stamped == band


def core_key(concept: str, scope: dict[str, str] | None = None, *, band: str | None = None) -> str:
    """The key a ``content.cores`` row is filed under. Readable, and one-to-one with the file.

    ``core/fractions--middle--1f2e…``: the band is in the human half as well as the digest, so an
    operator reading the stores desk can see at a glance that fractions has two cores and why,
    and can ask the database for one band's cores with a ``LIKE``. The ``content.cores`` table
    grows no column for it — the key IS the column, exactly as the modality is for a level."""
    band = _core_band(concept, scope, band)
    cid = concept_id(concept, scope)
    digest = hashlib.sha256(f"{concept_identity(concept, scope)}\x00{band}".encode()).hexdigest()[
        :16
    ]
    return f"{CORE_MODALITY}/{cid}--{band}--{digest}"


def row_for_core(key: str, record: dict[str, Any], *, concept_id_value: str) -> dict[str, Any]:
    """A ``content.cores`` row from one core record. The columns db.FIELDS[CORES] allows, no more.

    The cost and the judge's score are lifted onto their own columns rather than left buried in
    the body, because "what did our cores cost and what did the judge think of them" is a question
    the stores desk answers with a SELECT and not by reading JSON."""
    provenance = record.get("provenance") if isinstance(record.get("provenance"), dict) else {}
    judge = (provenance or {}).get("judge")
    judge = judge if isinstance(judge, dict) else {}
    score = judge.get("score")
    cost = (provenance or {}).get("costUsd")
    return {
        "key": key,
        "concept_id": concept_id_value,
        "body": record,
        "status": str(record.get("status") or CANONICAL),
        "judge_score": float(score) if isinstance(score, (int, float)) else None,
        "judge": judge,
        "model": str((provenance or {}).get("model") or "") or None,
        "cost_usd": float(cost) if isinstance(cost, (int, float)) else None,
        "provenance": provenance,
    }


def _core_from_database(
    concept: str, scope: dict[str, str] | None, band: str
) -> dict[str, Any] | None:
    """The core from Postgres when the file front has none. Never raises into the caller."""
    from wobo_gateway.plexus import db

    if not db.configured():
        return None
    try:
        row = db.read(db.CORES, core_key(concept, scope, band=band))
    except Exception:  # a cache read must never fail the generation that asked for it
        logger.warning("plexus: the core read for %r failed", concept, exc_info=True)
        return None
    record = row.get("body") if isinstance(row, dict) else None
    if not isinstance(record, dict):
        db.note_miss(db.CORES)
        return None
    db.note_database_hit(db.CORES, row.get("cost_usd"))
    db.note_serve(db.CORES, row.get("id"))
    with contextlib.suppress(OSError, TypeError, ValueError):  # warm the front
        _write_atomic(
            core_path(concept, scope, band=band), json.dumps(record, ensure_ascii=False, indent=1)
        )
    return record


def _core_from_legacy(
    concept: str, scope: dict[str, str] | None, band: str
) -> dict[str, Any] | None:
    """A core written before the key carried the band, re-indexed onto the band it belongs to.

    ONLY for a concept the syllabus teaches in exactly ONE band, and that condition is the whole
    argument. Such a concept was only ever going to have one core, so the pre-§5b file IS that
    band's core and nothing is borrowed by reading it — and not reading it would throw away a row
    that cost real money (a mean of USD 0.030699) for no gain a learner could feel.

    A concept the syllabus teaches in TWO bands is exactly the case §5b exists for, and its old
    class-neutral core is the very thing the law calls dishonest. It is left where it is (the
    retention law keeps it; nothing here deletes), and the band's own core is made instead."""
    if band not in BANDS or len(bands_for_concept(concept, scope)) != 1:
        return None
    record = _read(_legacy_core_path(concept, scope))
    if record is None or core_is_stale(record):
        return None
    record = {**record, "band": band}
    with contextlib.suppress(OSError, TypeError, ValueError):  # the old file is never touched
        _write_atomic(
            core_path(concept, scope, band=band), json.dumps(record, ensure_ascii=False, indent=1)
        )
    return record


def load_core(
    concept: str, scope: dict[str, str] | None = None, *, band: str | None = None
) -> dict[str, Any] | None:
    """The stored core for a concept AT ITS BAND, or ``None`` on a miss or a stale prompt version.

    The file front first, then Postgres, exactly as :func:`load` does for a level — and it matters
    MORE here: a core is the most expensive row the platform owns (a mean of USD 0.030699 over the
    three cores of the headline run on 2026-09-10, against USD 0.005343 over its twelve level
    renderings) and it is reused by every board, every class in its band, every syllabus version
    and every learner forever. Losing the cores on a deploy is the single worst thing an ephemeral
    container cache could take with it, which is why the cache now follows a mounted volume.

    A MISS IS A MISS, and a miss in a band with no core makes that band's core (``engines.core_for``
    is the caller that does it). Nothing here reaches sideways into another band to answer."""
    from wobo_gateway.plexus import db

    band = _core_band(concept, scope, band)
    record = _read(core_path(concept, scope, band=band))
    if record is not None:
        db.note_front_hit(db.CORES)
    else:
        record = _core_from_database(concept, scope, band)
    if record is None:
        record = _core_from_legacy(concept, scope, band)
    if record is None or core_is_stale(record) or not core_is_of_band(record, band):
        return None
    return record


def save_core(
    concept: str,
    record: dict[str, Any],
    scope: dict[str, str] | None = None,
    *,
    band: str | None = None,
) -> None:
    """Write the live core pointer, to the front and to the truth. Crash-safe on both.

    The band is STAMPED on what is written, never on the caller's dict: the stamp is what
    :func:`core_is_of_band` reads back, and a record that travels (to the database, into a
    version, onto the console) has to be able to say which band it is for on its own."""
    band = _core_band(concept, scope, band)
    stamped = {**record, "band": band}
    _write_atomic(
        core_path(concept, scope, band=band), json.dumps(stamped, ensure_ascii=False, indent=1)
    )
    from wobo_gateway.plexus import db

    if not db.configured():
        return
    try:
        db.write(
            db.CORES,
            row_for_core(
                core_key(concept, scope, band=band),
                stamped,
                concept_id_value=concept_id(concept, scope),
            ),
        )
    except Exception:  # a cache write must never take a generation down with it
        logger.warning("plexus: the core row for %r could not be written", concept, exc_info=True)


def core_versions_dir(
    concept: str, scope: dict[str, str] | None = None, *, band: str | None = None
) -> Path:
    """One version ledger PER BAND, because one core per band is what is being retained."""
    base = core_path(concept, scope, band=band)
    return base.parent / "versions" / base.stem


def save_core_version(
    concept: str,
    record: dict[str, Any],
    scope: dict[str, str] | None = None,
    *,
    band: str | None = None,
) -> Path:
    """Append one immutable core version. The owner's retention law reaches the cores too: a core
    that a refresh supersedes is kept forever, because the learners mid-chapter are on it."""
    band = _core_band(concept, scope, band)
    record = {**record, "band": band}
    vdir = core_versions_dir(concept, scope, band=band)
    vdir.mkdir(parents=True, exist_ok=True)
    prov = record.get("provenance") if isinstance(record.get("provenance"), dict) else {}
    model = _slug(str((prov or {}).get("model") or "unknown"))
    state = str(record.get("status") or CANONICAL)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%f")
    path = vdir / f"{stamp}-{state}-{model}.json"
    while path.exists():
        stamp += "x"
        path = vdir / f"{stamp}-{state}-{model}.json"
    _write_atomic(path, json.dumps(record, ensure_ascii=False, indent=1))
    return path


def load_core_versions(
    concept: str, scope: dict[str, str] | None = None, *, band: str | None = None
) -> list[dict[str, Any]]:
    vdir = core_versions_dir(concept, scope, band=band)
    out: list[dict[str, Any]] = []
    if not vdir.is_dir():
        return out
    for path in sorted(vdir.glob("*.json")):
        try:
            out.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    return out


# --- the interaction design: the third layer's own row ----------------------------------
#
# THE LAYER THAT REACHED NOBODY (docs/CONTENT-INTERACTION.md §3, docs/CACHES.md §1). The designs
# store was named in the docs and in ``db.INTERACTIONS`` and nothing ever wrote to it or read from
# it, so the model's interaction — the wave's flagship — was made in a test and nowhere else.
#
# Keyed on CONCEPT x ROW, like a core and unlike a level: a design is a mechanic for an idea, and
# the same drag-into-bins works for a CBSE class 6 child and an ISC class 11 student. What differs
# between them is the WORDS on the pieces, and those come off the level rendering, not off this.

DESIGN_MODALITY = "design"

#: Bump when the design vocabulary or the floors change what a stored design means.
DESIGN_PROMPT_VERSION = "design-v1"


def design_path(concept: str, kind: str, scope: dict[str, str] | None = None) -> Path:
    cid = concept_id(concept, scope)
    digest = hashlib.sha256(f"{concept_identity(concept, scope)}\x00{kind}".encode()).hexdigest()
    return _inside_cache(cache_dir() / DESIGN_MODALITY / f"{cid}--{kind}--{digest[:16]}.json")


def design_key(concept: str, kind: str, scope: dict[str, str] | None = None) -> str:
    cid = concept_id(concept, scope)
    digest = hashlib.sha256(f"{concept_identity(concept, scope)}\x00{kind}".encode()).hexdigest()
    return f"{DESIGN_MODALITY}/{cid}--{kind}--{digest[:16]}"


def design_is_stale(record: dict[str, Any] | None, *, core_version: str | None = None) -> bool:
    """Stale on three signals, and never on the clock alone.

    §3: *"regeneration only on a signal (judge score, observer flag, version change)."* A design
    made under an older vocabulary cannot be rendered; a design made against an older core is
    describing an idea that has since changed; a design past its refresh window is due a second
    look. Everything else stays exactly as it was designed.
    """
    if not isinstance(record, dict):
        return True
    if str(record.get("promptVersion") or "") != DESIGN_PROMPT_VERSION:
        return True
    if core_version and str(record.get("coreVersion") or "") not in ("", str(core_version)):
        return True
    designed = str(record.get("designedAt") or "")
    days = record.get("refreshDays")
    if designed and isinstance(days, int | float):
        with contextlib.suppress(ValueError):
            age = datetime.now(UTC) - datetime.fromisoformat(designed)
            return age.days > int(days)
    return False


def row_for_design(key: str, record: dict[str, Any], *, concept_id_value: str) -> dict[str, Any]:
    """A ``content.interactions`` row from one design record. db.FIELDS[INTERACTIONS], no more."""
    provenance = record.get("provenance") if isinstance(record.get("provenance"), dict) else {}
    design = record.get("design") if isinstance(record.get("design"), dict) else {}
    judge = (provenance or {}).get("judge")
    judge = judge if isinstance(judge, dict) else {}
    score = judge.get("score")
    cost = (provenance or {}).get("costUsd")
    return {
        "key": key,
        "concept_id": concept_id_value,
        "kind": str(design.get("kind") or record.get("kind") or "") or None,
        "is_template": str(design.get("source") or "") == "floor",
        "body": record,
        "status": str(record.get("status") or CANONICAL),
        "judge_score": float(score) if isinstance(score, int | float) else None,
        "judge": judge,
        "model": str((provenance or {}).get("model") or "") or None,
        "cost_usd": float(cost) if isinstance(cost, int | float) else None,
        "provenance": provenance,
    }


def _design_from_database(
    concept: str, kind: str, scope: dict[str, str] | None
) -> dict[str, Any] | None:
    from wobo_gateway.plexus import db

    if not db.configured():
        return None
    try:
        row = db.read(db.INTERACTIONS, design_key(concept, kind, scope))
    except Exception:  # a cache read never fails the render that asked for it
        logger.warning("plexus: the design read for %r failed", concept, exc_info=True)
        return None
    record = row.get("body") if isinstance(row, dict) else None
    if not isinstance(record, dict):
        db.note_miss(db.INTERACTIONS)
        return None
    db.note_database_hit(db.INTERACTIONS, row.get("cost_usd"))
    db.note_serve(db.INTERACTIONS, row.get("id"))
    with contextlib.suppress(OSError, TypeError, ValueError):  # warm the front
        _write_atomic(
            design_path(concept, kind, scope), json.dumps(record, ensure_ascii=False, indent=1)
        )
    return record


def load_design(
    concept: str,
    kind: str,
    scope: dict[str, str] | None = None,
    *,
    core_version: str | None = None,
) -> dict[str, Any] | None:
    """The stored design record for this concept and row, or None on a miss or a stale one."""
    from wobo_gateway.plexus import db

    record = _read(design_path(concept, kind, scope))
    if record is not None:
        db.note_front_hit(db.INTERACTIONS)
    else:
        record = _design_from_database(concept, kind, scope)
    if record is None or design_is_stale(record, core_version=core_version):
        return None
    return record


def save_design(
    concept: str, kind: str, record: dict[str, Any], scope: dict[str, str] | None = None
) -> None:
    """Write the live design pointer, to the front and to the truth. Crash-safe on both."""
    _write_atomic(
        design_path(concept, kind, scope), json.dumps(record, ensure_ascii=False, indent=1)
    )
    from wobo_gateway.plexus import db

    if not db.configured():
        return
    try:
        db.write(
            db.INTERACTIONS,
            row_for_design(
                design_key(concept, kind, scope),
                record,
                concept_id_value=concept_id(concept, scope),
            ),
        )
    except Exception:  # the front already has it; the truth can be caught up by the next write
        logger.warning("plexus: the design write for %r failed", concept, exc_info=True)
