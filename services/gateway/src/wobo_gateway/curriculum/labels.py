"""Honest labels (docs/CURRICULUM.md §5).

The learner never sees a status word, a confidence number, or a badge. They see one plain
sentence that says exactly how well we know this syllabus:

| status      | label                                        |
|-------------|----------------------------------------------|
| verified    | Official CBSE 2026-27, verified               |
| provisional | Found on the board's site, still checking     |
| community   | Shared by another learner, not yet checked    |
| personal    | Drafted from your syllabus, check it          |

Only ``verified`` names the framework, and only because that is the claim that has to be
falsifiable — the other three are deliberately vague about the source because we are vague
about the source. Sentence case, no emoji, no exclamation marks (product copy law).

The one rule that matters: a label is DERIVED, never passed in. A caller that could hand us the
sentence could hand us "verified" for a syllabus nothing has checked.
"""

from __future__ import annotations

from wobo_gateway.curriculum.models import Framework, JobState, Status, Version, coerce_status

_FIXED: dict[Status, str] = {
    Status.PROVISIONAL: "Found on the board's site, still checking",
    Status.COMMUNITY: "Shared by another learner, not yet checked",
    Status.PERSONAL: "Drafted from your syllabus, check it",
}

# What a learner reads while a discovery job is still running, and when it ends with nothing.
# The refusal is the honest end of §4.6: we say so in one line and open the own-syllabus door.
_JOB_MESSAGES: dict[JobState, str] = {
    JobState.QUEUED: "Looking for the official syllabus now",
    JobState.SEARCHING: "Looking for the official syllabus now",
    JobState.EXTRACTING: "Reading the official document now",
    JobState.CHECKING: "Checking what I read against the source",
    JobState.STORED: "Found it, and it is ready",
    JobState.REFUSED: (
        "I could not find an official syllabus for that. Show me yours and I will build it."
    ),
    JobState.FAILED: (
        "I could not finish looking for that syllabus. Show me yours and I will build it."
    ),
}


def label(
    status: Status | str,
    *,
    framework_name: str | None = None,
    version_label: str | None = None,
) -> str:
    """The sentence for one status. Verified names what it is claiming to be verified."""
    resolved = coerce_status(status)
    fixed = _FIXED.get(resolved)
    if fixed is not None:
        return fixed
    subject = " ".join(part for part in (framework_name, version_label) if part)
    return f"Official {subject}, verified" if subject else "Official, verified"


# How much each status claims. The pair (framework, version) is labelled by the WEAKER half:
# a verified board whose 2026-27 extraction is still provisional is provisional, because the
# syllabus is the thing being read. `personal` is not on this scale — it is whose it is, not how
# well it is known — so a personal framework keeps its own label whatever its version says.
_CLAIM: dict[Status, int] = {
    Status.VERIFIED: 3,
    Status.PROVISIONAL: 2,
    Status.COMMUNITY: 1,
    Status.PERSONAL: 0,
}


def weaker(first: Status | str, second: Status | str) -> Status:
    """The status that claims less. Two claims about one syllabus resolve to the smaller one."""
    left, right = coerce_status(first), coerce_status(second)
    return left if _CLAIM[left] <= _CLAIM[right] else right


def board_label(framework: Framework) -> str:
    """The line for a board whose syllabus we hold nothing of yet.

    It used to end "no syllabus stored yet", and that sentence was true and it was a dead end: it
    told a learner in Maharashtra that the product had nothing for them, which stopped being the
    case when the cold start landed (``docs/BOARD-COLD-START.md``). Picking this board now starts
    the reading of its syllabus and starts the learner, so there is nothing to warn them about and
    the label claims only what §3 corroborated: that this board is the board it says it is. What we
    hold of its syllabus is a machine fact (``has_syllabus``), not a sentence a child reads.
    """
    if framework.status is Status.VERIFIED:
        # The site was corroborated at the framework level (§3), which is a claim we can make.
        return f"Official {framework.name}"
    return framework.name


def label_for(framework: Framework, version: Version | None = None) -> str:
    """The label a learner sees on a framework, narrowed by the version they are pinned to.

    ``version`` is not optional in spirit: it is the syllabus, and every one of §5's labels is
    about a syllabus. Without one the answer is not a weaker claim about the same thing, it is a
    different sentence — see :func:`board_label`.
    """
    if framework.status is Status.PERSONAL or framework.personal:
        return _FIXED[Status.PERSONAL]
    if version is None:
        return board_label(framework)
    return label(
        status=weaker(framework.status, version.status),
        framework_name=framework.name,
        version_label=version.label,
    )


def job_message(state: JobState | str) -> str:
    """The one line shown while (or after) a discovery job runs. Never a promise of a result."""
    from wobo_gateway.curriculum.models import coerce_job_state

    return _JOB_MESSAGES.get(coerce_job_state(state), _JOB_MESSAGES[JobState.FAILED])


def all_labels() -> dict[str, str]:
    """The four labels, for the test that asserts §5 has not drifted."""
    return {
        Status.VERIFIED.value: label(Status.VERIFIED),
        **{status.value: text for status, text in _FIXED.items()},
    }
