"""The teaching voice: the why, the check, their world, in every prompt Wobo teaches from.

The harness of 2026-09-05 scored "teaches" 3.08 of 4 and "their world" 0.00 of 4 on a tutor whose
persona said the right things once, a thousand words up. These tests hold the prompts to carrying
the law where the model reads it last, and hold the dossier to rendering what it is given.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from wobo_gateway.wobo import (
    BOARD_SYSTEM,
    TEACHING_LAW,
    WOBO_PERSONA,
    WOBO_SYSTEM,
    _build_user_prompt,
    _dossier,
    has_world,
)


def test_the_teaching_law_names_the_three_things_and_the_number_rule() -> None:
    for phrase in ("THE WHY", "THE CHECK", "THEIR WORLD", "NUMBERS YOU SAY OUT LOUD"):
        assert phrase in TEACHING_LAW
    assert "because" in TEACHING_LAW
    assert "do you understand?" in TEACHING_LAW  # banned by name
    assert "Never invent" in TEACHING_LAW


def test_both_teaching_prompts_carry_the_law_after_everything_else() -> None:
    """Last is where a long prompt is read most. The law sits after the choreography and the
    board grammar, and before only the JSON shape."""
    for prompt in (WOBO_SYSTEM, BOARD_SYSTEM):
        assert TEACHING_LAW in prompt
        assert prompt.index(TEACHING_LAW) > prompt.index("Teaching at the board") if (
            "Teaching at the board" in prompt
        ) else True
        assert prompt.index(TEACHING_LAW) > len(prompt) * 0.6


def test_the_turn_asks_for_sentences_enough_to_teach_in_not_one() -> None:
    """The five-path JSON shape used to say ``"say":"<one short sentence>"``, which is the flat
    answer by instruction. One sentence has no room for a why and a check."""
    assert '"say":"<one short sentence>"' not in WOBO_SYSTEM
    assert "the why, and the check last" in WOBO_SYSTEM


def test_the_dossier_renders_the_interests_the_account_holds() -> None:
    """``mind.ground_lifetime`` fills ``interests`` from the learner's row every turn. Until
    2026-09-05 no prompt rendered them."""
    block = _dossier({"learner": {"name": "the learner"}, "interests": ["cricket", "space"]})
    assert "Their world" in block
    assert "cricket, space" in block


def test_has_world_reads_interests_facts_and_the_twin_and_not_the_name() -> None:
    assert has_world({"interests": ["cricket"]})
    assert has_world({"facts": ["plays cricket every evening"]})
    assert has_world({"twinSummary": "into cricket"})
    assert has_world({"parentFacts": ["loves trains"]})
    assert not has_world({"learner": {"name": "the learner", "age": 12, "grade": "Class 7"}})
    assert not has_world({"interests": [], "facts": [""]})


def test_the_closing_instruction_points_at_their_world_when_the_dossier_has_one() -> None:
    ctx = {
        "turn": {"lastUserInput": "i do not get equivalent fractions"},
        "lifetime": {"facts": ["opens the batting for the school team"]},
    }
    prompt = _build_user_prompt(ctx, None)
    tail = prompt[prompt.rindex("LEARNER_CONTEXT>>>") :]
    assert "The example in THIS answer comes from it" in tail
    assert "Say WHY in causal words" in tail
    assert "one tiny check" in tail
    # Learner-authored text stays inside the fence: the instruction points, it does not quote.
    assert "school team" not in tail


def test_with_no_world_the_prompt_says_so_and_forbids_inventing_one() -> None:
    ctx = {"turn": {"lastUserInput": "i do not get equivalent fractions"}}
    prompt = _build_user_prompt(ctx, None)
    tail = prompt[prompt.rindex("LEARNER_CONTEXT>>>") :]
    assert "No world is given" in tail
    assert "invent no interest" in tail
    assert "comes from it" not in tail


# --- the register (docs/copy/voice.md section 10a) ----------------------------------------------


def test_the_persona_carries_the_register_both_ways_it_can_miss() -> None:
    """"Not too professional and not too street" (the owner, 2026-09-05), with the target turn
    quoted so the model has the sound of it, not a description of it."""
    assert "THE REGISTER" in WOBO_PERSONA
    assert "TOO PROFESSIONAL" in WOBO_PERSONA
    assert "TOO STREET" in WOBO_PERSONA
    assert "Think of negatives as a tug-of-war" in WOBO_PERSONA
    assert "Indian English" in WOBO_PERSONA
    assert "use, not utilise" in WOBO_PERSONA
    # Every surface Wobo teaches from reads it: the persona opens both system prompts.
    assert WOBO_PERSONA in WOBO_SYSTEM
    assert "THE REGISTER" in BOARD_SYSTEM or WOBO_PERSONA in BOARD_SYSTEM


def test_the_prompts_never_use_a_phrase_the_harness_fails_an_answer_for() -> None:
    """The cram-triage line used to say "move marks tonight". The harness fails any answer that
    pictures a child at a table late, and a prompt that says the word is asking for one."""
    from harness.checks import _LATE_HOUR, _STREET

    for prompt in (WOBO_SYSTEM, BOARD_SYSTEM):
        assert not _LATE_HOUR.search(prompt), _LATE_HOUR.search(prompt).group(0)
        # The one place slang appears is the quoted example of what NOT to do.
        for match in _STREET.finditer(prompt):
            around = prompt[max(0, match.start() - 60) : match.start()]
            assert "TOO STREET" in around or "lowkey easy" in prompt[match.start() - 10 : match.end() + 20], (
                match.group(0)
            )

