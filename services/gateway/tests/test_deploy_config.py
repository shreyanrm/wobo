"""Deploy-config regression tests.

The gateway degrades QUIETLY when its runtime content is missing: `plexus.store` falls back
to pure concept-id derivation and `plexus.factcheck` no-ops the correctness gate. That is the
right runtime behaviour and the wrong thing to discover in production — the image simply did
not ship the files, and nothing failed loudly. These tests pin the packaging decisions instead,
so the next edit to a Dockerfile or an ignore file cannot silently switch the gate back off.

Pure text assertions over committed config — no docker, no network.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]

# The two files the gateway reads at runtime, and the env var each module honours to find it.
RUNTIME_CONTENT = (
    ("content/catalogs/concepts.json", "PLEXUS_CONCEPTS_PATH"),
    ("content/factbase/facts.v1.jsonl", "FACTBASE_DIR"),
)


@pytest.fixture(scope="module")
def dockerfile() -> str:
    return (REPO / "services/gateway/Dockerfile").read_text(encoding="utf-8")


@pytest.mark.parametrize(("rel", "env_var"), RUNTIME_CONTENT)
def test_runtime_content_exists_in_repo(rel: str, env_var: str) -> None:
    assert (REPO / rel).is_file(), f"{rel} is gone — the {env_var} path points at nothing"


@pytest.mark.parametrize(("rel", "env_var"), RUNTIME_CONTENT)
def test_dockerfile_ships_runtime_content(dockerfile: str, rel: str, env_var: str) -> None:
    """COPY the file into the image AND point the module's env override at it.

    The package is installed non-editable, so `Path(__file__).parents[...]` discovery lands
    inside /app/.venv rather than /app — the env overrides are what make discovery explicit.
    """
    assert re.search(rf"^COPY .*{re.escape(rel)}", dockerfile, re.M), (
        f"Dockerfile no longer COPYs {rel} into the image"
    )
    assert f"{env_var}=/app/content/" in dockerfile, (
        f"Dockerfile no longer sets {env_var} at the copied path"
    )


@pytest.mark.parametrize("ignore_file", (".dockerignore", ".railwayignore"))
def test_ignore_files_keep_runtime_content_in_the_build_context(ignore_file: str) -> None:
    """content/cache (runtime-written) stays out; the two content dirs must stay in."""
    lines = [
        ln.strip()
        for ln in (REPO / ignore_file).read_text(encoding="utf-8").splitlines()
        if ln.strip() and not ln.strip().startswith("#")
    ]
    assert "content/cache" in lines, f"{ignore_file} stopped excluding the runtime cache"
    for banned in ("content/catalogs", "content/factbase", "content"):
        assert banned not in lines, (
            f"{ignore_file} excludes {banned!r} — the gateway image would ship without the "
            "concept registry / fact base and both gates would silently no-op"
        )


#: The first aiohttp that carries no known advisory. 3.14.1 shipped with three — PYSEC-2026-3545
#: (fixed in 3.14.3), PYSEC-2026-3546 and PYSEC-2026-3547 (fixed in 3.14.2) — and it is a RUNTIME
#: dependency of the live voice relay, not a build tool. Raise this when the next one lands.
AIOHTTP_FLOOR = (3, 14, 3)


def _version(raw: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", raw)[:3])


def test_aiohttp_is_a_declared_gateway_dependency() -> None:
    """voice.py imports aiohttp directly; it must not depend on litellm's transitive copy."""
    voice = (REPO / "services/gateway/src/wobo_gateway/voice.py").read_text(encoding="utf-8")
    assert "import aiohttp" in voice
    pyproject = (REPO / "services/gateway/pyproject.toml").read_text(encoding="utf-8")
    declared = re.search(r'^\s*"aiohttp>=([0-9.]+)"', pyproject, re.M)
    assert declared, (
        "aiohttp is imported by voice.py but not declared in services/gateway/pyproject.toml"
    )
    assert _version(declared.group(1)) >= AIOHTTP_FLOOR, (
        f"the aiohttp floor is {declared.group(1)}, below {'.'.join(map(str, AIOHTTP_FLOOR))}: a "
        "floor a resolver can satisfy with a known-vulnerable release is not a floor"
    )
    lock = (REPO / "uv.lock").read_text(encoding="utf-8")
    assert f'{{ name = "aiohttp", specifier = ">={declared.group(1)}" }}' in lock, (
        "uv.lock is stale — run `uv lock`"
    )


def test_the_locked_aiohttp_is_not_a_known_vulnerable_release() -> None:
    """The floor says what we will accept; the lock says what we will actually ship."""
    lock = (REPO / "uv.lock").read_text(encoding="utf-8")
    resolved = re.search(r'name = "aiohttp"\nversion = "([0-9.]+)"', lock)
    assert resolved, "aiohttp is not in uv.lock at all"
    assert _version(resolved.group(1)) >= AIOHTTP_FLOOR, (
        f"uv.lock pins aiohttp {resolved.group(1)}, which carries known advisories on the live "
        "voice path"
    )


def test_render_worker_python_is_in_the_lint_path() -> None:
    """It is deliberately outside the uv workspace (no pyproject) but inside ruff's reach."""
    root = (REPO / "pyproject.toml").read_text(encoding="utf-8")
    extend_exclude = re.search(r"^extend-exclude = \[(.*)\]$", root, re.M)
    assert extend_exclude, "ruff extend-exclude vanished from the root pyproject"
    assert "render-worker" not in extend_exclude.group(1), (
        "services/render-worker is excluded from ruff again — `uvx ruff check services content` "
        "would stop covering its Python files"
    )


def test_biome_linter_uses_the_current_config_key() -> None:
    """`rules.preset` is CORRECT for Biome >= 2.5 (pinned by the $schema, 2.5.1 here).

    An audit flagged `preset` as an unknown key and asked for `recommended: true`. It is the
    other way round: `biome check --diagnostic-level=info` emits a DEPRECATED diagnostic on
    `recommended` ("Use preset instead") and nothing on `preset`. Pinned so the swap is not
    made twice.
    """
    biome = json.loads((REPO / "biome.json").read_text(encoding="utf-8"))
    assert biome["$schema"].startswith("https://biomejs.dev/schemas/2.")
    rules = biome["linter"]["rules"]
    assert rules.get("preset") == "recommended"
    assert "recommended" not in rules, "deprecated in Biome >= 2.5 — use `preset`"


def test_vercel_env_script_is_committed_and_credential_free() -> None:
    """DEPLOY.md §1 points at this script; a committed key would be a public-repo credential."""
    script = REPO / "scripts/set-vercel-env.sh"
    assert script.is_file()
    body = script.read_text(encoding="utf-8")
    assert not re.search(r"eyJ[A-Za-z0-9_-]{20,}", body), "a JWT literal is committed in the script"
    assert "VITE_GATEWAY_URL" in body, "the script no longer writes VITE_GATEWAY_URL"
    gitignore = (REPO / ".gitignore").read_text(encoding="utf-8")
    assert "!scripts/set-vercel-env.sh" in gitignore, "the script fell back under scripts/*-env.sh"
    assert "scripts/set-vercel-env.sh" in (REPO / "DEPLOY.md").read_text(encoding="utf-8")


# Where a catalog file can legitimately be read from. Kept as globs rather than a list of
# individual files so that deleting a consumer — as Wave 6 deleted the client's `frame.ts` —
# fails the inventory row rather than the test itself.
CATALOG_READERS = (
    "apps/web-pwa/src/**/*.ts",
    "apps/web-pwa/src/**/*.tsx",
    "packages/*/src/**/*.ts",
    "services/*/src/**/*.py",
    "content/**/*.py",
)


def _catalog_reader_text() -> str:
    parts: list[str] = []
    for pattern in CATALOG_READERS:
        for path in sorted(REPO.glob(pattern)):
            parts.append(path.read_text(encoding="utf-8", errors="ignore"))
    return "\n".join(parts)


def test_every_catalog_file_is_wired_or_inventoried() -> None:
    """content/catalogs holds ~2.4 MB of board data. Each file is either loaded by code or
    listed as a deliberate unwired input in content/catalogs/README.md — never neither."""
    readme = (REPO / "content/catalogs/README.md").read_text(encoding="utf-8")
    code = _catalog_reader_text()
    orphans = [
        p.name
        for p in sorted((REPO / "content/catalogs").glob("*.json"))
        if p.name not in code and p.name not in readme
    ]
    assert not orphans, (
        f"{orphans} are referenced by neither code nor content/catalogs/README.md — wire them, "
        "delete them, or give them an inventory row"
    )


def test_the_catalog_inventory_names_no_deleted_reader() -> None:
    """CURRICULUM.md §10 deletes the client's static catalog and frame system. A row that still
    points at `frame.ts` reads as wired when the file it names is gone — the exact rot the
    inventory exists to prevent."""
    readme = (REPO / "content/catalogs/README.md").read_text(encoding="utf-8")
    for target in sorted(set(re.findall(r"`(apps/[^`]+?\.tsx?)`", readme))):
        assert (REPO / target).is_file(), (
            f"content/catalogs/README.md names a deleted reader: {target}"
        )
    for stale in ("frame.ts", "catalog.ts"):
        assert stale not in readme, (
            f"content/catalogs/README.md still names {stale}, deleted in Wave 6"
        )


def test_readme_states_the_law_precedence_and_links_resolve() -> None:
    """More than one file in the repo claims authority; README.md is where the order lives."""
    readme_path = REPO / "README.md"
    readme = readme_path.read_text(encoding="utf-8")
    assert "Which document wins" in readme
    # DECISIONS.md > root law files > docs/ (history). Order of first mention encodes it.
    order = [readme.index(x) for x in ("DECISIONS.md", "CONTEXT.md", "docs/")]
    assert order == sorted(order), "the precedence order in README.md is out of sequence"
    assert "Superseded" in readme and "docs/05-BUILD-PLAN" in readme, (
        "the phase-mandating docs are no longer marked superseded"
    )
    for target in re.findall(r"]\(\./([^)#]+)\)", readme):
        assert (REPO / target).exists(), f"README.md links at a missing path: {target}"
