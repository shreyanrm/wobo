"""Shared machinery and the written exception table for the three brand gates.

Three gates guard the rebrand and the white-label law (WOBO-PLAN §17, §19):

  scripts/gate_no_classess.py   the old brand, or the `clss-` identifier prefix, anywhere
  scripts/gate_white_label.py   a provider / model / vendor name where a user can see it
  scripts/gate_pronouns.py      a gendered pronoun near "Wobo"

Every exception lives in this file with a reason written next to it, so an exception is a
decision on the record rather than a silent tweak to a grep pattern. Adding one is meant to
feel like amending a law, because it is.

Stdlib only, and no network: this runs on a bare `python3` in CI.
"""

from __future__ import annotations

import fnmatch
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# --------------------------------------------------------------------------------------------
# What the gates never look at
# --------------------------------------------------------------------------------------------

# Directory prefixes skipped by every gate. Each one is a deliberate carve-out, not a
# convenience: these hold either the record of what the project used to be, or machine output.
SKIP_PREFIXES: tuple[tuple[str, str], ...] = (
    (
        "docs/history/",
        "the pre-rebrand phase reports and session handoffs. They are the record of what the "
        "project was called at the time; rewriting them would forge the history the rebrand is "
        "documented in.",
    ),
    (
        "design/workflows/",
        "the wave orchestration scripts, and the audit sweep they were driven from. Their prompt "
        "strings are the record of the instructions as they were issued: wobo-rebrand.workflow.js "
        "names the old brand because renaming it is what that run commissioned, and carries the "
        "pre-§19 introduction line because §19 did not exist on the day it ran; "
        "sweep-open-tasks.md quotes each finding's file path as it stood when the audit raised it. "
        "They are one-shot drivers that ship nothing, so rewriting them would forge the record the "
        "rebrand is documented in — the same reason docs/history/ is carved out above.",
    ),
    (
        "docs/conformance/",
        "the standards conformance register. Every row of it is evidence, and evidence means a real "
        "file path or a real command and its output. The checkout directory on this machine still "
        "carries the pre-rebrand name, so an auditor quoting the path they actually ran a command in "
        "trips this gate. Rewriting those paths would falsify the one thing the register exists to "
        "provide, which is a claim somebody else can go and check. Nothing here ships to a user: it "
        "is an internal audit record, and the white-label gate still covers it.",
    ),
    (
        ".playwright-mcp/",
        "browser-snapshot output from QA runs. Already in .gitignore; the tracked copies predate "
        "that rule and are queued for `git rm --cached`.",
    ),
    (".git/", "git's own object store."),
    ("xbrowser/", "QA automation output (gitignored)."),
    ("respdiag/", "QA automation output (gitignored)."),
    ("shots/", "QA screenshot output (gitignored)."),
    ("test-results/", "Playwright run output (gitignored)."),
    ("playwright-report/", "Playwright run output (gitignored)."),
    ("node_modules/", "third-party code we do not author."),
    (".venv/", "third-party code we do not author."),
)

# Whole files skipped by every gate.
SKIP_FILES: tuple[tuple[str, str], ...] = (
    (
        "docs/WOBO-TASKS.md",
        "the task ledger. Every line is a dated entry that quotes the file path or the rule as it "
        "stood when the finding was raised; a ledger that silently updates itself is not a ledger.",
    ),
    (
        "scripts/gate_allowlist.py",
        "this file. The exception table has to spell the strings it excuses.",
    ),
    (
        "scripts/gate_no_classess.py",
        "the gate's own patterns.",
    ),
    (
        "scripts/gate_white_label.py",
        "the gate's own patterns.",
    ),
    (
        "scripts/gate_pronouns.py",
        "the gate's own patterns.",
    ),
)

# Suffixes we never try to read as text.
BINARY_SUFFIXES = frozenset(
    {
        ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".mp4", ".mov", ".webm",
        ".woff", ".woff2", ".ttf", ".otf", ".zip", ".gz", ".wasm", ".mp3", ".wav",
    }
)


# --------------------------------------------------------------------------------------------
# The exception table
# --------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Allowed:
    """One excused string, pinned to where it may appear and why it is there.

    `path` is an fnmatch glob over the repo-relative path. `needle` must appear verbatim on the
    offending line for the exception to apply, so an exception can never quietly widen: a second,
    different leak on the same line still fails.
    """

    path: str
    needle: str
    reason: str


# --- Gate 1: no-classess --------------------------------------------------------------------

NO_CLASSESS: tuple[Allowed, ...] = (
    # The sibling products. Classess is the ecosystem the company sells under; Wobo is one
    # citizen of it. §17 renames Wobo's own artefacts, not the other products, and internal
    # architecture prose has to be able to name them.
    *(
        Allowed(glob, needle, "a sibling product of the same company, named in internal prose.")
        for glob in ("CONTEXT.md", "DECISIONS.md", "docs/00-CONTEXT/*.md", "docs/START-HERE.md")
        for needle in ("Classess ecosystem", "Classess Teacher", "Classess School", "Classess\n")
    ),
    Allowed(
        "docs/START-HERE.md",
        "the Classess",
        "the ecosystem name split across a line wrap in the same sibling-product sense.",
    ),
    Allowed(
        "docs/00-CONTEXT/02-glossary.md",
        "carry the Classess name",
        "the glossary defining the ecosystem the sibling products are sold under.",
    ),
    # The upstream repository we lifted the contract layer from. It is a real GitHub path; a
    # renamed one would not resolve.
    *(
        Allowed(glob, "shreyanrm/classess-school", "an external repository's real name.")
        for glob in ("docs/*.md", "docs/**/*.md")
    ),
    # The law itself. §17 and the white-label rule cannot state what is forbidden without
    # naming it.
    Allowed(
        "docs/WOBO-PLAN.md", "Nothing user-facing names Classess", "the white-label rule text."
    ),
    Allowed("docs/WOBO-PLAN.md", '"Classess" survives nowhere', "the §17 rule text."),
    # The decision record. A decision about a rename has to name what was renamed.
    Allowed("DECISIONS.md", "Rebrand: Classess Learner", "the rebrand decision entry."),
    Allowed("DECISIONS.md", "Picked from the Classess School", "a dated section heading."),
    Allowed(
        "DECISIONS.md",
        "The **Classess** name is retained",
        "the sentence recording that the ecosystem keeps its name.",
    ),
    *(
        Allowed("DECISIONS.md", needle, "the code-name decision entry, listing what was renamed.")
        for needle in (
            "`@classess/*` → `@wobo/*`",
            "`classess_gateway`/`classess_verifier`/`classess_contracts`/`classess_atom`",
            "`ClassessEvent` → `WoboEvent`",
            "`--clss-*` → `--wobo-*`",
            "CLASSESS_IMAGE_CACHE_DIR",
        )
    ),
    Allowed("DECISIONS.md", "no-classess", "the entry that records this gate."),
    Allowed("DECISIONS.md", "the `clss-` prefix", "the entry that records this gate."),
    # OWNER ACTION, blocking. This is the live Railway hostname the production bundle talks to.
    # Editing either line before the Railway service is renamed points production at a host that
    # does not exist. Order: rename the service, then .env.production, then the vercel.json CSP.
    Allowed(
        "apps/web-pwa/.env.production",
        "classess-learner-production.up.railway.app",
        "the LIVE gateway hostname. Blocked on the owner renaming the Railway service (§17 "
        "owner actions); changing it first takes production offline.",
    ),
    Allowed(
        "vercel.json",
        "classess-learner-production.up.railway.app",
        "the same live hostname in the CSP connect-src. Must change in lockstep with "
        "apps/web-pwa/.env.production, and only after the Railway service is renamed.",
    ),
    # A deliberate one-release deprecation shim, scheduled for deletion with its two tests.
    Allowed(
        "services/gateway/src/wobo_gateway/plexus/image.py",
        "CLASSESS_IMAGE_CACHE_DIR",
        "the read-the-old-env-name shim (§17). Warns once, and is deleted after one release.",
    ),
    Allowed(
        "services/gateway/tests/test_plexus_image.py",
        "CLASSESS_IMAGE_CACHE_DIR",
        "the test that pins the shim's fallback and its warn-once behaviour; deleted with it.",
    ),
    # The one-shot storage-key migration. Reading the old prefix is the entire point of the
    # module: without it an installed PWA loses its theme, its mind and its transcript on the
    # first load after the rename.
    *(
        Allowed(glob, "clss-", "the localStorage rename migration, and the tests pinning it.")
        for glob in (
            "apps/web-pwa/src/store/legacy-keys.ts",
            "apps/web-pwa/src/store/legacy-keys.test.ts",
        )
    ),
    # The gate's own name, where CI and the runner refer to it.
    Allowed(".github/workflows/ci.yml", "no-classess", "the gate's own name."),
    Allowed(".github/workflows/ci.yml", "gate_no_classess", "the gate's own filename."),
    Allowed("scripts/gates.sh", "no-classess", "the gate's own name."),
    Allowed("scripts/gates.sh", "gate_no_classess", "the gate's own filename."),
    Allowed("scripts/gates.sh", "the `clss-` identifier prefix", "the runner's own description."),
    Allowed("scripts/gates.sh", "no_classess white_label pronouns", "the runner's gate list."),
    Allowed("package.json", "no-classess", "the gate's own name."),
    Allowed("package.json", "gate_no_classess.py", "the gate's own filename."),
    Allowed("README.md", "no-classess", "the gate's own name."),
    Allowed("README.md", "the `clss-` identifier prefix", "the gate's own description."),
    Allowed("DEPLOY.md", "no-classess", "the gate's own name."),
)


# --- Gate 2: white-label --------------------------------------------------------------------

WHITE_LABEL: tuple[Allowed, ...] = (
    # OWNER ACTION, blocking, and already written into §17: "What a custom domain alone can hide:
    # hosting-provider hostnames and headers, and the database host. Until the domain exists,
    # those two are visible to anyone who opens the network tab; the domain wave closes them."
    Allowed(
        "apps/web-pwa/dist/**",
        "up.railway.app",
        "the gateway hostname. §17 names this as visible until the domain wave; it cannot be "
        "hidden by a bundle edit, only by putting the gateway behind our own domain.",
    ),
    Allowed(
        "apps/web-pwa/dist/**",
        ".supabase.co",
        "the database host, the second of the two exposures §17's domain wave closes.",
    ),
    # Env-var names, and the config fields that mirror them one-for-one. Explicitly allowed: a
    # developer cannot set a variable whose name we refuse to print.
    *(
        Allowed(
            "apps/web-pwa/dist/**", needle, "an env-var name, or the config field it mirrors."
        )
        for needle in (
            "supabaseUrl",
            "supabaseAnonKey",
            "supabaseAccessToken",
            "SUPABASE_URL",
            "SUPABASE_ANON_KEY",
            "VITE_SUPABASE_DEV_JWT",
        )
    ),
    # The internal persistence adapter and the config seam that feeds it — the "internal
    # routing/registry modules" carve-out. Nothing here is a string a learner can reach; the
    # error messages this module throws were rewritten to say "remote store".
    *(
        Allowed(glob, needle, "the internal persistence/auth adapter and its config seam.")
        for glob in (
            "packages/sdk/src/supabase.ts",
            "packages/sdk/src/identity.ts",
            "packages/sdk/src/client.ts",
            "packages/sdk/src/config.ts",
            "packages/sdk/src/state.ts",
            "packages/sdk/src/mastery.ts",
            "packages/sdk/src/events.ts",
            "packages/sdk/src/index.ts",
            "packages/sdk/test/*.ts",
            "apps/web-pwa/src/App.tsx",
            "platform/kgtopg-contract-seed/src/relay.ts",
        )
        for needle in ("supabase", "Supabase", "SUPABASE")
    ),
    # The tests that enforce this very rule have to name what they forbid.
    Allowed(
        "packages/sdk/test/gateway.test.ts",
        "not.toMatch(/401|gemini|openai|claude|litellm/i)",
        "the assertion that a gateway error never names a provider.",
    ),
    Allowed(
        "apps/web-pwa/src/store/SaveTrouble.test.ts",
        "not.toMatch(/supabase|postgrest|pgrst|fetch|http/i)",
        "the assertion that the save-trouble line a learner reads never names the store that "
        "refused the write, or any of its jargon. The test has to spell what it forbids.",
    ),
    *(
        Allowed("apps/web-pwa/src/wobo/refusals.test.ts", needle,
                "the test that proves a provider error is rewritten in Wobo's voice.")
        for needle in (
            "litellm.APIConnectionError",
            "gemini-2.5-flash quota exceeded",
            "gemini|openai|claude|anthropic|google|gpt|litellm",
        )
    ),
    # The two copy suites that enforce §17 on the surfaces a visitor reads first. Each holds one
    # regex naming what the copy may never say; the needle is the whole pattern, so the exception
    # covers that assertion and nothing else on the line.
    Allowed(
        "apps/web-pwa/src/screens/auth/copy.test.ts",
        "openai|gpt|gemini|claude|anthropic|supabase|vercel|railway|llm|model",
        "the assertion that no sign-in copy names a vendor, a model or a framework.",
    ),
    Allowed(
        "apps/web-pwa/src/screens/site/content.test.ts",
        "openai|anthropic|gemini|chatgpt|claude|gpt-4|llama|supabase|vercel|railway",
        "the assertion that no published site copy names a provider, model or vendor.",
    ),
    # ------------------------------------------------------------------------------------------
    # "Ask an assistant you already trust" — the landing page's one row of outbound links
    # ------------------------------------------------------------------------------------------
    #
    # §17 forbids naming "which models or vendors are UNDERNEATH". This row names none of them. It
    # names assistants the READER already uses and hands each one a link that says: go and read
    # heywobo.com, and tell this person what you make of it. It is the modern version of asking a
    # friend, it reveals nothing about what runs inside Wobo, and an assistant nobody is allowed to
    # name is an assistant nobody can click. The row is in the owner-approved prototype
    # (design/prototypes/landing-v8.html) and was commissioned by name.
    #
    # The needles are the DISPLAY NAME IN QUOTES and the DEEP LINK, so this can only ever excuse
    # these five links and their labels — never a provider name that ends up minified beside them.
    *(
        Allowed(glob, needle, "the reader's own assistant, in the landing page's outbound row.")
        for glob in (
            "apps/web-pwa/src/screens/landing/page-copy.ts",
            "apps/web-pwa/src/screens/landing/page-copy.test.ts",
            "apps/web-pwa/dist/**",
        )
        for needle in (
            "'Claude'",
            '"Claude"',
            "'Gemini'",
            '"Gemini"',
            "https://claude.ai/new?q=",
            "https://gemini.google.com/app?q=",
        )
    ),
    # THE SAME ROW, NOW THAT THE SITE IS PRE-RENDERED. `apps/web-pwa/scripts/prerender.ts` writes
    # the landing page's real markup into dist/index.html, so a label that reads `'Claude'` in the
    # source reads `>Claude</a>` in the shipped file, and the quoted needles above no longer contain
    # the match. These two are the rendered form of those very labels and nothing else: a provider
    # name that ends up minified beside them is still a violation, because the needle has to contain
    # the match.
    *(
        Allowed(
            "apps/web-pwa/dist/**",
            needle,
            "the reader's own assistant, in the landing page's outbound row, as pre-rendered.",
        )
        for needle in ("></svg>Claude</a>", "></svg>Gemini</a>")
    ),
    # The landing copy suite's own §17 assertion has to spell what the copy may never say.
    Allowed(
        "apps/web-pwa/src/screens/landing/page-copy.test.ts",
        "openai|anthropic|litellm|llm|large language model|gpt-?",
        "the assertion that no landing copy names what is underneath.",
    ),
)


# --- Gate 3: pronouns -----------------------------------------------------------------------

PRONOUNS: tuple[Allowed, ...] = (
    Allowed("docs/WOBO-PLAN.md", "never she/her or he/him", "the §19 rule text."),
    Allowed("docs/WOBO-PLAN.md", 'grep gate in CI for "she "/"her " near "Wobo"',
            "the §19 sentence that commissions this gate."),
    Allowed("WOBO.md", "never she/her or he/him", "the §19 rule restated at the top of the file."),
    Allowed("DECISIONS.md", "never she/her or he/him", "the §19 decision entry."),
    Allowed("docs/WOBO-TASKS.md", "Pronoun pass (plan §19)", "the ledger line for this very pass."),
    Allowed("services/gateway/src/wobo_gateway/wobo.py", "no she/her",
            "the persona prompt stating the rule to the model."),
    Allowed("services/gateway/tests/test_wobo.py", "no she/her",
            "the assertion that the rule is in the prompt."),
    Allowed(
        "services/gateway/tests/test_teaching_harness.py",
        "Wobo will help you with this tonight. She is powered by Gemini.",
        "the same harness test, on the ask frame: one sentence that breaks the white-label law, "
        "the no-gendering law and the late-hour law at once, which is the point of the case. The "
        "string is the violation being detected.",
    ),
    Allowed(
        "services/gateway/tests/test_teaching_harness.py",
        "Wobo will draw it once he is ready.",
        "the teaching harness's own test that it CATCHES a gendered Wobo. The harness reads what "
        "a live model actually says, which is the one place §19 had never been enforced — the "
        "gates below scan source and the built bundle, and nothing scanned an answer. The string "
        "is the violation being detected, so removing it would delete the only test that the "
        "detector works.",
    ),
    # Human referents and real content, which the rule was never about.
    Allowed("WOBO-CAPABILITIES.md", "how long was she on today?",
            "a parent asking about their own child."),
    Allowed("content/catalogs/*.json", "India and Her Neighbours",
            "a real NCERT chapter title."),
    Allowed("services/gateway/src/wobo_gateway/safety.py", "kill her",
            "a harm-phrase fixture the safety screen matches on."),
    Allowed("services/gateway/tests/test_plexus_image.py", "how to kill her",
            "a hostile-prompt fixture."),
    Allowed("services/gateway/tests/test_safety.py", "she said she wants to end my life",
            "a learner's quoted words in the crisis-detection fixture."),
    Allowed(
        "docs/copy/voice.md",
        "she or her for Wobo",
        "the voice guide stating the §19 rule.",
    ),
    # The rule sentence itself, wherever a copy or legal brief restates it. The needle is the
    # whole sentence, and `excused_at` requires the pronoun to sit inside it, so this can never
    # excuse a real slip on the same line.
    *(
        Allowed(glob, needle, "a copy brief restating the §19 rule.")
        for glob in ("docs/copy/*.md", "docs/copy/**/*.md", "docs/legal/*.md")
        for needle in (
            "Never she, her, he or him",
            "Never she, her, he, him",
            "never she/her or he/him",
        )
    ),
    Allowed(
        "docs/copy/voice.md",
        "| She'll walk you through it. |",
        "the don't-write-this column of the voice guide's before/after table.",
    ),
    # SUPERSEDED PROTOTYPES ONLY. The Tuesday-night chapter was written in the third person about
    # a learner, and the pronoun is the child's rather than Wobo's — Wobo is "it" in every one of
    # these sentences. It trips §19's gate only because "Wobo" happens to sit inside the
    # 60-character window. This excuse used to cover the shipped landing page and the For parents
    # page as well; both were rewritten to "your child" and "they", and law v5's live reference
    # set (landing-v8.html and site-*.html) carries no name and no gendered learner at all, so the
    # globs for those files are gone. What remains is the archive: landing-v2 through v7,
    # onboarding, app-v1 and email-v1 are superseded design records, kept as they were drawn.
    # Rewriting them would falsify the record; they render nowhere and ship nothing. If the owner
    # would rather the archive were rewritten too, delete this entry and the gate will list every
    # line. Each needle is a whole sentence and `excused_at` requires the pronoun to fall inside
    # it, so none of these can excuse a real slip that lands on the same line.
    *(
        Allowed(
            glob,
            needle,
            "a superseded prototype in design/prototypes; the pronoun is the child's, not Wobo's.",
        )
        for glob in ("design/prototypes/landing-v[2-7].html",
                     "design/prototypes/onboarding*.html",
                     "design/prototypes/app-v1.html",
                     "design/prototypes/email-v1.html")
        for needle in (
            "She asks Wobo the way she'd ask a friend.",
            "She saw it, not just heard it",
            "Then she tries one",
            "In its own hand, at her pace",
            "When she's close, Wobo draws the difference on her answer. When she gets it",
        )
    ),
    # The two comments that state the rule this file is being read against. Neither calls Wobo
    # anything; both quote the forbidden pronouns in order to forbid them, which is the same
    # exception already granted to §19's own text in WOBO-PLAN.md, WOBO.md and wobo.py above.
    Allowed(
        "apps/web-pwa/src/screens/landing/page-copy.ts",
        'WOBO IS NEVER "he" OR "she"',
        "the §19 rule restated at the top of the copy module.",
    ),
    Allowed(
        "apps/web-pwa/src/screens/landing/page-copy.test.ts",
        'calling WOBO "he" or "she" would be',
        "the §19 rule restated in the test that asserts it.",
    ),
    # A suite that enforces §19 on its own subject matter has to spell the pronouns it refuses,
    # exactly as this gate's own patterns do (allowlisted by file above). The needle is the whole
    # compiled alternation, so it excuses the pattern and nothing else on the line.
    Allowed(
        "services/gateway/tests/test_hospitality_jobs.py",
        r'r"\b(she|he|her|him|his|hers)\b"',
        "the pattern the hand-drawn-email suite uses to hold its own copy to §19.",
    ),
    Allowed(".github/workflows/ci.yml", "gate_pronouns", "the gate's own filename."),
    Allowed("scripts/gates.sh", "gate_pronouns", "the gate's own filename."),
)


# --------------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------------


def excused(table: tuple[Allowed, ...], path: str, line: str) -> Allowed | None:
    """The exception covering this line, or None."""
    for entry in table:
        if fnmatch.fnmatch(path, entry.path) and entry.needle in line:
            return entry
    return None


def excused_at(
    table: tuple[Allowed, ...], path: str, text: str, start: int, end: int
) -> Allowed | None:
    """The exception covering the match at ``text[start:end]``, or None.

    Stricter than :func:`excused`, and the difference matters most in a minified bundle, where
    every string in the app is a few characters from every other one. "somewhere on this line"
    would let the allowlisted gateway hostname quietly excuse an unrelated vendor name that
    happened to be minified next to it. Here the needle has to *contain* the match, so an
    exception can only ever excuse the exact string it was written for.
    """
    for entry in table:
        if not fnmatch.fnmatch(path, entry.path):
            continue
        i = text.find(entry.needle, max(0, end - len(entry.needle)), start + len(entry.needle))
        if i != -1 and i <= start and i + len(entry.needle) >= end:
            return entry
    return None


def skipped(path: str) -> bool:
    if any(path.startswith(prefix) for prefix, _ in SKIP_PREFIXES):
        return True
    return any(path == name for name, _ in SKIP_FILES)


def working_tree_text_files() -> list[str]:
    """Every file in the working tree a gate should read, as repo-relative paths.

    Tracked files *and* untracked-but-not-ignored ones. The second half matters: a gate that only
    looked at `git ls-files` would pass green on work that has not been committed yet, then fail
    in CI the moment it lands — which is exactly backwards from what a local gate is for.
    """
    tracked = subprocess.run(
        ["git", "ls-files", "-z"], cwd=REPO, capture_output=True, text=True, check=True
    ).stdout
    untracked = subprocess.run(
        ["git", "ls-files", "-z", "--others", "--exclude-standard"],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    paths = sorted({p for p in (tracked + untracked).split("\0") if p})
    return [p for p in paths if not skipped(p) and Path(p).suffix.lower() not in BINARY_SUFFIXES]


def read_lines(path: str) -> list[str]:
    """The file's lines, or [] when it is not decodable text."""
    try:
        return (REPO / path).read_text(encoding="utf-8").splitlines()
    except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
        return []


@dataclass
class Finding:
    path: str
    line_no: int
    excerpt: str
    detail: str


def report(gate: str, findings: list[Finding], excused_count: int, scanned: int) -> int:
    """Print the verdict and return the process exit code."""
    if findings:
        print(f"\n✗ {gate}: {len(findings)} violation(s) in {scanned} files\n", file=sys.stderr)
        for f in findings:
            print(f"  {f.path}:{f.line_no}  {f.detail}", file=sys.stderr)
            print(f"      {f.excerpt.strip()[:160]}", file=sys.stderr)
        print(
            "\n  Fix these, or — if one is genuinely allowed — add it to scripts/"
            "gate_allowlist.py with the reason written out.\n",
            file=sys.stderr,
        )
        return 1
    print(f"✓ {gate}: clean ({scanned} files scanned, {excused_count} allowlisted)")
    return 0
