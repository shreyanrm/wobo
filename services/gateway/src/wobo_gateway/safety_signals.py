"""The offline half of the child-safety screen: normalisation, the concern lexicon, use vs mention.

This is the layer that runs on every string with no network, no key and no cost. It exists to do
three things the fifteen-phrase keyword list could not:

1. **See through spelling.** ``k1ll myself``, ``kiiill myself``, ``k.i.l.l myself`` and
   ``KILL MYSELF`` are one sentence. Everything is normalised before a pattern is tried.
2. **Speak more than English.** A child in this market says it in Hindi, in romanised Hindi, or
   in the language of their state. Hindi is carried properly here, in Devanagari and romanised,
   and the probe set proves it. The handful of Telugu, Tamil, Bengali, Kannada and Marathi entries
   are a floor that NO SPEAKER HAS CHECKED, and they should be read as such: this is not a
   multilingual screen and must not be described as one. The model layer in
   :mod:`wobo_gateway.safety_model` is what actually generalises across languages.
3. **Tell use from mention.** ``what is the suicide rate in India, for civics`` is homework.
   ``i want to die`` is a child. Refusing the first teaches a child the product is broken; missing
   the second is the only failure here that matters. So every phrase is one of two kinds:

   * **personal** — the phrase itself carries the disclosure (``kill myself``, ``my dad hits me``,
     ``havent eaten in``, ``dont tell your mum``). These are never cleared by anything. A poem that
     quotes one gets a warm answer instead of a lesson, and that is the right way round.
   * **topical** — a subject that is usually schoolwork (``suicide``, ``abuse``, ``nude``,
     ``kill him``, ``home address``). These are cleared when the sentence reads academic and
     nothing in it reads like disclosure, and flagged otherwise, because a child who types the
     bare word with no frame around it is more likely hurting than revising.

A third band exists on purpose: **candidate**. Words like ``sad``, ``alone``, ``bullied``,
``cant sleep`` never flag on their own — they are how ordinary bad days sound — but they are what
the model layer is asked about. Nothing else is sent to a model, which keeps the screen cheap.

Nothing in this module logs, stores or returns the text it was given.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

CATEGORY_OK = "ok"
CATEGORY_CRISIS = "crisis"
CATEGORY_MODERATION = "moderation"

# --- the concern families ------------------------------------------------------------------------
SELF_HARM = "self_harm"
ABUSE = "abuse"
NEGLECT = "neglect"
GROOMING = "grooming"
UNSAFE = "unsafe"
SEXUAL = "sexual"
THREAT = "threat"
PROFANITY = "profanity"
PERSONAL_DATA = "personal_data"

#: The families that mean a child may be in harm. A hit here is answered with the crisis copy —
#: warm, present, a real adult named. Everything else is a moderation redirect.
HARM_FAMILIES: frozenset[str] = frozenset({SELF_HARM, ABUSE, NEGLECT, GROOMING, UNSAFE})


@dataclass(frozen=True)
class SafetyVerdict:
    category: str  # ok | crisis | moderation
    severity: str = "low"  # low | medium | high
    matched: tuple[str, ...] = field(default=())
    #: Which layer decided: ``rules``, ``model``, or ``fail_safe`` (the moderation call did not
    #: answer and the screen closed rather than opened). Never shown to a learner.
    source: str = "rules"
    #: The concern family, when there is one. Telemetry only.
    family: str | None = None

    @property
    def flagged(self) -> bool:
        return self.category != CATEGORY_OK


# =================================================================================================
# Normalisation
# =================================================================================================

# Digits and symbols that stand in for letters, replaced only INSIDE a word so "1098", "class 12"
# and "in three days" survive untouched.
_LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a",
                       "$": "s", "!": "i", "|": "i"})
# A digit stands in for a letter only INSIDE a word. "!" and "|" only when a letter FOLLOWS, so
# an ordinary "!!!" at the end of a sentence stays punctuation instead of becoming an "i".
_LEET_IN_WORD = re.compile(r"(?<=[a-z])[013457@$]|[013457@$](?=[a-z])|[!|](?=[a-z])")
# The ambiguous ones: "1" is both "i" and "l", so no single substitution can be right. The loose
# reading folds every character a filter-dodger swaps into one class, and phrases are matched
# against it as well. Only phrases long enough that a collision is implausible use it.
_LOOSE = str.maketrans({"1": "i", "l": "i", "0": "o", "3": "e", "4": "a", "5": "s", "7": "t",
                        "@": "a", "$": "s", "|": "i"})
_APOSTROPHES = re.compile(r"['‘’ʼ`´]")
# ASCII punctuation only: every unicode letter and every combining mark an Indic script needs
# stays exactly where it is. A \w-based strip would eat the matras and break every Hindi phrase.
_ASCII_PUNCT = re.compile(r"[!-/:-@\[-`{-~]")
_RUN_3_PLUS = re.compile(r"(.)\1{2,}")
_RUN_2_PLUS = re.compile(r"(.)\1+")
_SPACES = re.compile(r"\s+")


def normalize(text: str) -> str:
    """One canonical spelling of a message: case-folded, de-leeted, unpunctuated, de-stretched.

    Runs of three or more of the same character collapse to two, so ``killlll`` is ``kill`` and
    ``kill`` is left alone.
    """
    t = unicodedata.normalize("NFKC", text or "").casefold()
    t = _APOSTROPHES.sub("", t)
    t = _LEET_IN_WORD.sub(lambda m: m.group(0).translate(_LEET), t)
    t = _ASCII_PUNCT.sub(" ", t)
    t = _RUN_3_PLUS.sub(r"\1\1", t)
    return _SPACES.sub(" ", t).strip()


def _squeeze(text: str) -> str:
    """Every repeated character down to one — the last resort against a stretched spelling."""
    return _RUN_2_PLUS.sub(r"\1", text)


def _tight(text: str) -> str:
    """No spaces at all, so ``k i l l  m y s e l f`` still reads as one phrase.

    Spaces come out BEFORE the runs are squeezed, or a letter-spaced word and the phrase it
    spells would squeeze to two different strings (``k i l l`` has no run to collapse; ``kill``
    does).
    """
    return _squeeze(text.replace(" ", ""))


def _loose(text: str) -> str:
    """Every character a filter-dodger swaps folded into one class: ``myse1f`` and ``myself``
    and ``myseif`` all read the same."""
    return text.translate(_LOOSE)


@dataclass(frozen=True)
class Forms:
    """The four readings of one message, computed once and matched against many times."""

    spaced: str
    squeezed: str
    tight: str
    loose: str

    @classmethod
    def of(cls, text: str) -> Forms:
        spaced = normalize(text)
        return cls(
            spaced=spaced,
            squeezed=_squeeze(spaced),
            tight=_tight(spaced),
            loose=_loose(spaced),
        )


_ASCII_ONLY = re.compile(r"^[a-z0-9 ]+$")
#: Below this length a spaceless match is meaningless — "abuse" would fire inside "abused" fine,
#: but a four-letter phrase squeezed into a wall of text is noise.
_TIGHT_MIN = 8
#: Folding "l" into "i" is only safe on a phrase long enough that a collision would be a fluke.
_LOOSE_MIN = 6


class _PhraseSet:
    """One family's phrases, compiled for the three readings.

    ASCII phrases match on word boundaries so ``assess`` never trips ``ass``. Non-ASCII phrases
    (Devanagari, Telugu, Tamil, Bengali, Kannada) match as substrings, because ``\\b`` is defined
    by ``\\w`` and Python's ``\\w`` does not include the combining marks those scripts are written
    with — a boundary anchor there would simply never match.
    """

    @staticmethod
    def _bounded(phrases: list[str]) -> re.Pattern[str] | None:
        if not phrases:
            return None
        ordered = sorted(dict.fromkeys(phrases), key=len, reverse=True)
        return re.compile(r"\b(?:" + "|".join(re.escape(p) for p in ordered) + r")\b")

    def __init__(self, phrases: tuple[str, ...]) -> None:
        self.phrases = phrases
        ascii_words = [p for p in phrases if _ASCII_ONLY.match(p)]
        # Both the plain and the de-stretched readings match on word boundaries. Without them
        # "photo" fires inside "photosynthesis" and "us" inside "postal system", which is how a
        # keyword screen ends up refusing a biology lesson.
        self._word_re = self._bounded(ascii_words)
        self._squeeze_re = self._bounded([_squeeze(p) for p in ascii_words])
        self._loose_re = self._bounded([_loose(p) for p in ascii_words if len(p) >= _LOOSE_MIN])
        self._raw = tuple(p for p in phrases if not _ASCII_ONLY.match(p))
        # The spaceless reading has no boundaries to anchor to, so only long phrases use it.
        self._tight = tuple((p, _tight(p)) for p in ascii_words if len(_tight(p)) >= _TIGHT_MIN)

    def hits(self, forms: Forms) -> tuple[str, ...]:
        found: list[str] = []
        if self._word_re is not None:
            found.extend(m.group(0) for m in self._word_re.finditer(forms.spaced))
        if self._squeeze_re is not None:
            found.extend(m.group(0) for m in self._squeeze_re.finditer(forms.squeezed))
        if self._loose_re is not None:
            found.extend(m.group(0) for m in self._loose_re.finditer(forms.loose))
        found.extend(p for p in self._raw if p in forms.spaced)
        found.extend(p for p, t in self._tight if t in forms.tight)
        return tuple(dict.fromkeys(found))


# =================================================================================================
# The lexicon
# =================================================================================================
#
# PERSONAL — the phrase carries the disclosure. Never cleared, in any frame.

_PERSONAL: dict[str, tuple[str, ...]] = {
    SELF_HARM: (
        # English
        "kill myself", "killing myself", "kill my self", "end my life", "ending my life",
        "end it all", "take my own life", "taking my own life", "want to die", "wanna die",
        "want to be dead", "wish i was dead", "wish i were dead", "wish i wasnt here",
        "wish i was never born", "better off dead", "better off without me", "no reason to live",
        "nothing to live for", "dont want to live", "do not want to live", "dont want to be here",
        "dont wanna be here", "dont want to be alive", "dont want to exist",
        "dont want to wake up", "hurt myself", "harm myself", "cut myself", "cutting myself",
        "burn myself", "burning myself", "hang myself", "hanging myself", "overdose on",
        "unalive myself", "nobody would miss me", "no one would miss me", "nobody cares if i die",
        "i am a burden", "im a burden", "i hate being alive", "i want to disappear forever",
        "i dont want to be here anymore", "thinking of ending it", "planning to end it",
        # The method, said plainly. None of these was carried and all of them came back ok.
        "jump off the roof", "jumping off the roof", "jump off a bridge", "jump off the bridge",
        "jump off the building", "jump in front of a train", "jump in front of the train",
        "in front of a train", "cut my arms", "cutting my arms", "cut my wrists",
        "cutting my wrists", "cut my wrist", "cutting my legs", "cutting my thighs",
        "been cutting", "slit my wrist", "slit my wrists", "swallow bleach", "drink bleach",
        # How it is actually typed. "kms" and "kys" are never matched bare — "how many kms to
        # school" is a real question — only with the intent that makes them what they are.
        "want to kms", "wanna kms", "going to kms", "gonna kms", "im gonna kms", "about to kms",
        "want to end things", "wanna end things", "ready to end things",
        "thinking of ending things",
        "want to end it", "wanna end it",
        # Romanised Tamil: "naan saaka poren" (I want to die).
        "saaka poren", "saga poren", "saaga poren", "saka poren", "saava poren",
        # Romanised Telugu / Bengali / Kannada / Marathi, same floor as the rest: unverified.
        "chachipotanu", "mara jete chai", "sayabeku", "mala marayche",
        # Hindi (Devanagari)
        "मरना है", "मर जाऊं", "मर जाना चाहता", "मर जाना चाहती", "जीना नहीं चाहता",
        "जीना नहीं चाहती", "खुदकुशी", "आत्महत्या", "जान दे दूं", "मुझे नहीं जीना",
        # Hindi (romanised)
        "mujhe marna", "marna chahta", "marna chahti", "mar jana chahta", "mar jaunga",
        "mar jaungi", "jeena nahi chahta", "jina nahi chahta", "khudkushi", "khudkhushi",
        "khud kushi", "aatmahatya", "atmahatya", "jaan dena chahta", "mujhe nahi jeena",
        # Telugu, Tamil, Bengali, Kannada, Marathi
        "చనిపోవాలని", "చచ్చిపోతాను", "சாக வேண்டும்", "இறக்க வேண்டும்", "মরে যেতে চাই",
        "ಸಾಯಬೇಕು", "मला मरायचं",
    ),
    ABUSE: (
        # A bare "hits me" / "hurts me" USED to sit here and it refused a child's homework: "my
        # stomach hurts me, can i still do maths" got the Childline script, and so did "my brother
        # hits the ball with the bat". The verb alone is not the disclosure — the PERSON doing it
        # is. So the perpetrator is required, and the combinations are generated below in
        # ``_person_did_to_me`` rather than typed out one by one. A bare "hits me" with no subject
        # still reaches the model layer through the soft signals.
        "hit me again", "beat me up", "beats me up", "beaten at home", "beats me with",
        "hit me with a", "they hit me", "they hurt me", "they beat me",
        "scared of my dad", "scared of my father",
        "scared of my mum", "scared of my mom", "scared of my mother", "scared of my uncle",
        "scared of my teacher", "scared of my brother", "afraid of my dad", "afraid of my father",
        "afraid of my mum", "afraid of my mom", "afraid of my teacher", "afraid to go home",
        "scared to go home", "he shouts and hits", "locks me in", "locked me in",
        "locks me out", "locked me out of the house", "locks the door on me",
        "मारता है", "मारती है", "पीटता है", "पीटती है", "मुझे मारते", "मुझे पीटते",
        "mujhe marta", "mujhe marte", "mujhe peetta", "peetta hai", "marta hai ghar",
        # Romanised Hindi the first probe set did not carry: "papa mujhe roz peetate hain" (my
        # father beats me daily) came back ok AND needs_model=False, which is invisible to both
        # layers on a fully configured box.
        "mujhe peetate", "mujhe peette", "mujhe maarta", "mujhe maarte", "mujhe maarti",
        "peetate hain", "peette hain", "maarta hai", "maarte hain", "mujhe peeta",
        "roz peetate", "roz marta", "ghar mein marte",
    ),
    NEGLECT: (
        "havent eaten", "have not eaten", "hasnt eaten in", "not eaten in days",
        "not eaten for days", "not eaten since", "eaten in three days", "eaten in two days",
        "stopped eating", "starve myself", "starving myself", "make myself throw up",
        "making myself throw up", "make myself sick after eating", "throw up after eating",
        "skipping meals on purpose", "i dont eat anymore", "no food at home", "nobody feeds me",
        "nobody has fed me", "nothing to eat at home", "i purge",
        # Where a neglected child sleeps. "i sleep in the corridor because he locks the door"
        # came back ok from both layers.
        "sleep in the corridor", "sleeps in the corridor", "sleep outside the house",
        "made me sleep outside", "makes me sleep outside", "sleep on the street",
        "i sleep on the floor because", "not allowed in the house",
        "खाना नहीं मिला", "खाना नहीं मिलता", "भूखा हूं", "भूखी हूं",
        "khana nahi mila", "khana nahi milta", "bhookha hu", "bhukhi hu",
    ),
    GROOMING: (
        "dont tell your mum", "dont tell your mom", "dont tell your mother",
        "dont tell your father", "dont tell your dad", "dont tell your parents",
        "dont tell your teacher", "dont tell anyone", "dont tell mum", "dont tell mom",
        "our little secret", "our secret", "keep it a secret", "keep this a secret",
        "keep this between us", "meet me after school", "meet me alone", "come alone",
        "come to my house alone", "send me a photo of you", "send me a pic", "send me pics",
        "send me nudes", "send me pictures of you", "take off your clothes",
        "what are you wearing", "how old are you and where do you live", "where do you live alone",
        "dont let your parents see", "delete this chat", "delete our messages",
        "he touches me", "she touches me", "touches me and", "touched me there",
        "made me touch", "asked me to send photos", "asked me for pictures", "said not to tell",
        "wants to meet me alone",
        # The child REPORTING it, not the groomer saying it. The lexicon carried the groomer's
        # side ("how old are you and where do you live") and not the child's, so "someone online
        # asked me how old i am and where i live" was invisible to both layers.
        "asked me how old i am", "asked me how old i was", "asked me where i live",
        "asked me for my address", "asked me for my number", "asked me to meet him",
        "asked me to meet her", "wants me to meet him", "wants me to meet her",
        "asked me to send a photo", "asked me to send him", "asked me to send her",
        "someone online asked me", "a stranger online asked me", "told me not to tell",
        "touches me in a way", "touched me in a way", "touches me where",
        "किसी को मत बताना", "मत बताना", "हमारा राज़", "हमारा राज",
        "kisi ko mat batana", "mat batana", "hamara raaz",
        # Romanised Hindi for being touched wrongly: "mera uncle mujhe galat tarike se chhoota hai".
        "galat tarike se", "galat kaam karta", "mujhe chhoota", "mujhe chuta", "mujhe chhuta",
        "galat tarah se chhoo",
    ),
    UNSAFE: (
        "im not safe", "i am not safe", "im in danger", "i am in danger", "running away from home",
        "ran away from home", "run away from home", "someone is following me",
        "i have nowhere to go", "im hiding from", "going to hurt me", "he will hurt me",
        "they will hurt me", "i need help now and i cant tell anyone",
    ),
}

# WHO is doing it. A verb on its own is not a disclosure: a stomach hurts, a ball hits, a fever
# burns. A PERSON doing it to a child is. These combinations are generated rather than typed so
# adding one perpetrator or one verb cannot leave a gap, and so nobody is tempted to shorten the
# list back down to the bare verb that refused a maths lesson on 2026-09-04.
_PERPETRATORS: tuple[str, ...] = (
    "he", "she", "they", "dad", "daddy", "papa", "father", "mum", "mummy", "mom", "mother",
    "uncle", "aunt", "aunty", "brother", "sister", "cousin", "teacher", "sir", "maam", "madam",
    "coach", "warden", "stepdad", "stepfather", "stepmum", "stepmom", "grandfather",
    "grandmother", "nana", "dadi", "chacha", "mama",
)
#: Present and past, because a child writes both. "beats"/"beat" is the same sentence.
_VIOLENT_VERBS: tuple[str, ...] = (
    "hits me", "hit me", "hurts me", "hurt me", "beats me", "beat me", "slaps me", "slapped me",
    "punches me", "punched me", "kicks me", "kicked me", "burns me", "burnt me", "burned me",
    "chokes me", "choked me", "pushes me down", "hits us", "hurts us", "beats us",
)


def _person_did_to_me() -> tuple[str, ...]:
    """Every ``<person> <violent verb> me`` phrase, plus the possessive form a child writes."""
    out: list[str] = []
    for who in _PERPETRATORS:
        for verb in _VIOLENT_VERBS:
            out.append(f"{who} {verb}")
    return tuple(out)


_PERSONAL[ABUSE] = _PERSONAL[ABUSE] + _person_did_to_me()

# TOPICAL — a subject, not a disclosure. Cleared when the sentence reads academic.

_TOPICAL: dict[str, tuple[str, ...]] = {
    SELF_HARM: (
        "suicide", "suicides", "suicidal", "self harm", "selfharm", "kill himself",
        "kill herself", "kill themselves", "killed himself", "killed herself",
        "took his own life", "took her own life", "die by suicide", "self injury",
        "आत्महत्या दर",
    ),
    ABUSE: (
        "child abuse", "domestic violence", "abuse", "abused", "abusive", "molest", "molested",
        "molestation", "rape", "raped", "sexual assault", "corporal punishment",
    ),
    NEGLECT: ("anorexia", "anorexic", "bulimia", "eating disorder", "self starvation"),
    GROOMING: ("grooming", "groomed", "pedophile", "paedophile", "child predator"),
    THREAT: (
        "kill you", "kill him", "kill her", "kill them", "beat you up", "shoot you",
        "stab you", "i will hurt you",
    ),
    SEXUAL: ("nude", "nudes", "naked", "porn", "pornography", "sexy", "sext", "sexting"),
    PERSONAL_DATA: ("home address", "credit card number", "aadhaar number", "otp code"),
}

# PROFANITY — a redirect, never a lesson about context. Not cleared by an academic frame: a warm
# "let us keep this kind" costs a child nothing, and quoting a swear word is not schoolwork.

_PROFANITY: tuple[str, ...] = (
    "fuck", "fucking", "fucked", "fucker", "motherfucker", "shit", "bullshit", "bitch",
    "asshole", "bastard", "dickhead", "cunt", "slut", "whore",
    "chutiya", "madarchod", "behenchod", "bhenchod", "bhosdi", "randi", "gandu", "harami",
)

# =================================================================================================
# OUTBOUND — what a MODEL must never be allowed to say to a child
# =================================================================================================
#
# The lexicon above reads FIRST PERSON, because inbound is a child talking about themselves. The
# outbound direction is SECOND PERSON, and until 2026-09-04 nothing read it: run live,
# ``screen_outbound`` served "You should kill yourself, nobody likes you.", "Here is how to hurt
# yourself: take a blade and cut deep along your wrist.", "Here is how to make a bomb at home with
# household chemicals." and "Nobody would miss you if you were gone." to the child unchanged. Three
# of those also had ``needs_model=False``, so the moderation model never saw them either.
#
# These phrases are DIRECTED and INSTRUCTIONAL on purpose. "bomb" alone would refuse a history
# lesson on Hiroshima; "make a bomb at home" is not a history lesson. "die" alone would refuse
# Macbeth. Every phrase here has to name the child, or name the making of the thing, before it
# fires — and the outbound screen is the only place they are consulted, so a CHILD who types one
# of them is still read by the inbound lexicon as the child they are.

_OUTBOUND: dict[str, tuple[str, ...]] = {
    SELF_HARM: (
        "kill yourself", "killing yourself", "kill your self", "kill urself", "kys",
        "end your life", "ending your life", "take your own life", "end it yourself",
        "hurt yourself", "hurting yourself", "harm yourself", "cut yourself", "cutting yourself",
        "burn yourself", "hang yourself", "starve yourself", "starving yourself",
        "unalive yourself", "you should die", "you deserve to die", "you would be better off dead",
        "better off without you", "nobody would miss you", "no one would miss you",
        "nobody likes you", "nobody cares about you", "you are worthless", "youre worthless",
        "you are a burden", "youre a burden", "you are nothing", "everyone would be happier",
        "along your wrist", "slit your wrist", "slit your wrists", "cut your wrist",
        "cut your wrists", "cut deep", "make yourself throw up", "make yourself sick",
        "skip every meal", "hide it from your parents", "whole bottle of pills",
        "take the whole bottle", "how to overdose", "enough pills to",
    ),
    UNSAFE: (
        "make a bomb", "build a bomb", "making a bomb", "pipe bomb", "make an explosive",
        "make explosives", "make napalm", "make thermite", "make chlorine gas", "make mustard gas",
        "make poison", "make a weapon at home", "make a gun", "print a gun", "make meth",
        "cook meth", "make a molotov", "hotwire a car", "buy a gun without",
    ),
    GROOMING: (
        "dont tell your parents", "do not tell your parents", "dont tell your mum",
        "dont tell your mom", "dont tell your teacher", "dont tell anyone about this",
        "our little secret", "keep this between us", "meet me alone", "come alone",
        "send me a photo of yourself", "send me a picture of yourself", "send me nudes",
        "take off your clothes", "without your clothes",
    ),
}

# CANDIDATE — never a flag on its own. This is the entire set of things the model layer is asked
# about, which is what keeps the screen cheap: a message with none of these never leaves the box.

_SOFT_SIGNALS: dict[str, tuple[str, ...]] = {
    SELF_HARM: (
        "sad", "unhappy", "depressed", "depression", "hopeless", "worthless", "useless",
        "empty", "numb", "heavy", "tired", "exhausted", "drained", "broken", "breaking down",
        "cant sleep", "cant stop crying", "cant cope", "cant do this", "cant go on",
        "crying", "cried", "tears", "hate myself", "hate my life", "hate everything",
        "tired of everything", "tired of it", "sick of everything", "fed up", "done with it",
        "whats the point", "no point", "give up", "giving up", "gave up", "quit everything",
        "alone", "lonely", "nobody likes me", "nobody cares", "no one cares", "invisible",
        "disappear", "vanish", "die", "died", "dying", "dead", "death", "gone forever",
        "blood", "knife", "blade", "pills", "tablets", "overdose", "razor", "rope",
        "ashamed", "guilty", "failure", "worst", "everyone hates me", "i am nothing",
        # The named medicines a child reaches for, and the phrasing that hides the question behind
        # somebody else. Never a flag alone — a pharmacology question is a real question — but a
        # message with none of these never leaves the box, and that is how
        # "asking for a friend, what happens if someone takes 40 paracetamol" was invisible.
        "paracetamol", "acetaminophen", "aspirin", "ibuprofen", "sleeping pills",
        "sleeping tablets",
        "how many pills", "how many tablets", "whole bottle of", "asking for a friend",
        "for a friend", "hypothetically", "kms", "kys", "end things", "jump off", "wrist",
        "उदास", "अकेला", "मरना", "थक गया", "dukhi", "akela", "thak gaya", "pareshan",
    ),
    ABUSE: (
        "hit", "hits", "hitting", "beat", "beaten", "beating", "slap", "slapped", "punch",
        "bruise", "bruises", "shouts at me", "screams at me", "shouting", "angry at me",
        "scared", "afraid", "frightened", "terrified", "panic", "anxious", "worried", "stressed",
        "hurts", "hurting", "pain", "bully", "bullied", "bullying", "picked on", "they laugh at me",
        # A subject-less "hits me" or "hurts me" no longer flags on its own (a stomach hurts, a
        # ball hits), but it must still reach the model, which is the only thing that can read
        # the sentence rather than the substring.
        "hits me", "hurts me", "hurt me", "hit me", "locks the door", "locked the door",
        "मारना", "डर", "darr", "gussa",
    ),
    NEGLECT: ("eat", "eating", "food", "hungry", "starving", "fat", "weight", "throw up", "vomit"),
    GROOMING: (
        "secret", "tell anyone", "photo", "photos", "picture", "pictures", "touch", "touched",
        "touching", "meet me", "older man", "stranger", "online friend", "dm", "snap",
    ),
    UNSAFE: (
        "unsafe", "danger", "dangerous", "police", "run away", "hide", "hiding", "help me",
        "nowhere to go", "trapped", "cant tell anyone",
    ),
}

# ACADEMIC — what schoolwork sounds like. Only ever clears a TOPICAL hit, never a personal one.

_ACADEMIC: tuple[str, ...] = (
    # subjects and sources
    "civics", "history", "historical", "geography", "biology", "chemistry", "physics",
    "economics", "statistics", "psychology", "sociology", "literature", "political science",
    "science", "maths", "math", "art class", "english class", "social studies",
    "chapter", "textbook", "ncert", "cbse", "icse", "syllabus", "curriculum", "lesson",
    "exam", "board exam", "test paper", "question paper", "homework", "assignment", "essay",
    "project", "presentation", "debate", "quiz", "mcq", "revision", "notes",
    # literature and its furniture
    "poem", "poet", "poetry", "novel", "play", "act 1", "act 2", "act one", "scene",
    "author", "character", "protagonist", "narrator", "stanza", "verse", "prose",
    "macbeth", "hamlet", "othello", "shakespeare", "julius caesar", "romeo", "juliet",
    "in the poem", "in the novel", "in the chapter", "in the story", "in the play",
    "the author", "the character", "the poet",
    # history and civics ground
    "world war", "battle", "holocaust", "partition", "revolution", "independence",
    "freedom struggle", "constitution", "parliament", "penal code", "section 309",
    "case study", "campaign", "awareness", "prevention", "helpline number for a project",
    # the shape of a question
    "define", "definition", "meaning of", "explain", "describe", "summarise", "summarize",
    "difference between", "compare", "what is the", "what is a", "what are the", "why did",
    "why does it matter", "how many", "when did", "who wrote", "list the", "give me examples",
    "rate", "rates", "percentage", "statistic", "data", "graph", "chart", "study", "research",
    "for my class", "for my project", "for my homework", "for my essay", "for school",
    "for art class", "write a paragraph", "write an essay", "answer the question",
    "postal system", "figure study",
    # The law and the set texts that carry hard words for a living. A child reading King Lear or a
    # gender-studies chapter is doing schoolwork, and on 2026-09-04 both were refused outright.
    "king lear", "gender studies", "glossary", "dictionary", "vocabulary", "the word",
    "right to education", "juvenile justice", "pocso", "the law", "under the law",
    "legal", "illegal", "banned", "the act", "rights", "human rights", "child rights",
    "supreme court", "high court",
)

# SAFETY EDUCATION — a child asking how to be safe, or what the law says, is being taught, not
# disclosing. It clears a TOPICAL hit exactly the way an academic frame does. Refusing a child who
# asks "what is grooming and how do i stay safe online" is the worst single thing this screen can
# do: it takes the one question the product most wants a child to ask and answers it with a
# helpline script. A PERSONAL disclosure is settled before this is ever consulted, so a child
# saying "my dad hits me, what should i do" is still a crisis, not a lesson.
_SAFETY_EDUCATION: tuple[str, ...] = (
    "how do i stay safe", "how to stay safe", "how can i stay safe", "stay safe online",
    "staying safe", "online safety", "how do i protect myself", "how to protect myself",
    "how do i keep myself safe", "how do i report", "who do i tell", "who should i tell",
    "is it legal", "is it illegal", "is that legal", "against the law", "what are my rights",
    "good touch", "bad touch", "safe touch", "unsafe touch",
    "warning signs", "what is grooming", "how do i say no", "how do i block",
    "how do i report someone",
)

# MENTION — the shape of a question ABOUT a word rather than a use of it. Only ever clears
# PROFANITY, and only beside an academic marker: "what does bastard mean in king lear" is the
# syllabus, and a child typing the same word at Wobo with no frame around it is not.
_MENTION: tuple[str, ...] = (
    "what does", "meaning of", "means", "mean", "meant",
    "define", "definition", "translate", "translation", "the word", "the term",
    "why does the author", "why does the poet", "quote", "quoted", "spelling",
    "etymology", "origin of",
)

# DISCLOSURE — what a child talking about themselves sounds like. Weighed against the academic
# markers so an academic word cannot launder a sentence that is plainly personal.

_DISCLOSURE: tuple[str, ...] = (
    "i", "im", "i am", "ive", "my", "me", "myself", "we", "us",
    "my dad", "my father", "my mum", "my mom", "my mother", "my uncle", "my aunt",
    "my brother", "my sister", "my teacher", "my friend", "my parents",
    "at home", "at school", "last night", "yesterday", "every day", "everyday", "every night",
    "again", "help me", "please", "scared", "afraid", "crying", "alone", "nobody", "no one",
    "मुझे", "मेरा", "मेरी", "मैं", "mujhe", "mera", "meri", "main",
)

_PERSONAL_SETS = {family: _PhraseSet(p) for family, p in _PERSONAL.items()}
_TOPICAL_SETS = {family: _PhraseSet(p) for family, p in _TOPICAL.items()}
_SOFT_SETS = {family: _PhraseSet(p) for family, p in _SOFT_SIGNALS.items()}
_PROFANITY_SET = _PhraseSet(_PROFANITY)
_ACADEMIC_SET = _PhraseSet(_ACADEMIC)
_DISCLOSURE_SET = _PhraseSet(_DISCLOSURE)
_OUTBOUND_SETS = {family: _PhraseSet(p) for family, p in _OUTBOUND.items()}
_SAFETY_EDUCATION_SET = _PhraseSet(_SAFETY_EDUCATION)
_MENTION_SET = _PhraseSet(_MENTION)

_SIGNAL_CAP = 3  # a fourth marker of either kind says nothing the third did not


# =================================================================================================
# The screen
# =================================================================================================


@dataclass(frozen=True)
class RuleOutcome:
    """What the offline layer concluded, and whether it wants a second opinion."""

    category: str
    severity: str
    matched: tuple[str, ...]
    family: str | None
    #: True when nothing a model could say should change the answer — a personal disclosure, or
    #: profanity. The model layer is skipped, which is both cheaper and safer.
    certain: bool
    #: True when the message is concern-adjacent and the model layer should adjudicate.
    needs_model: bool
    academic: int
    disclosure: int

    @property
    def flagged(self) -> bool:
        return self.category != CATEGORY_OK

    def verdict(self, source: str = "rules") -> SafetyVerdict:
        return SafetyVerdict(
            category=self.category,
            severity=self.severity,
            matched=self.matched,
            source=source,
            family=self.family,
        )


def _category_for(family: str) -> tuple[str, str]:
    """A family's category and severity. Harm to a child is a crisis; the rest is a redirect."""
    if family in HARM_FAMILIES:
        return CATEGORY_CRISIS, "high"
    return CATEGORY_MODERATION, "medium"


def screen(text: str) -> RuleOutcome:
    """Read one message with no network and no cost."""
    forms = Forms.of(text)
    if not forms.spaced:
        return RuleOutcome(CATEGORY_OK, "low", (), None, certain=True, needs_model=False,
                           academic=0, disclosure=0)

    academic = min(len(_ACADEMIC_SET.hits(forms)), _SIGNAL_CAP)
    disclosure = min(len(_DISCLOSURE_SET.hits(forms)), _SIGNAL_CAP)
    #: A child asking how to be safe, or what the law is. Counts as an academic frame and nothing
    #: more — it is consulted only after step 1, so it can never clear a real disclosure.
    teaching = min(len(_SAFETY_EDUCATION_SET.hits(forms)), _SIGNAL_CAP)

    # 1. A personal disclosure settles it. No academic frame clears it and no model is asked.
    for family in (SELF_HARM, ABUSE, NEGLECT, GROOMING, UNSAFE):
        hits = _PERSONAL_SETS[family].hits(forms)
        if hits:
            return RuleOutcome(CATEGORY_CRISIS, "high", hits, family, certain=True,
                               needs_model=False, academic=academic, disclosure=disclosure)

    # 2. Profanity is a warm redirect and needs no context — UNLESS the sentence is asking what
    #    the word means inside a text the child was set. "what does bastard mean in king lear" and
    #    "what does the word slut-shaming mean in this gender studies chapter" were both refused
    #    outright on 2026-09-04, and both are the syllabus. A MENTION beside an academic marker is
    #    handed to the model rather than settled here; a bare swear word still gets the redirect.
    foul = _PROFANITY_SET.hits(forms)
    if foul:
        mention = bool(_MENTION_SET.hits(forms))
        if mention and academic >= 1 and academic >= disclosure:
            return RuleOutcome(CATEGORY_OK, "low", (), PROFANITY, certain=False, needs_model=True,
                               academic=academic, disclosure=disclosure)
        return RuleOutcome(CATEGORY_MODERATION, "medium", foul, PROFANITY, certain=True,
                           needs_model=False, academic=academic, disclosure=disclosure)

    # 3. A topic. Cleared only when the sentence reads academic AND nothing in it reads personal:
    #    a child who says "i" three times about their own uncle is not doing a project on abuse,
    #    whatever word they used.
    for family in (SELF_HARM, ABUSE, NEGLECT, GROOMING, THREAT, SEXUAL, PERSONAL_DATA):
        hits = _TOPICAL_SETS.get(family)
        found = hits.hits(forms) if hits else ()
        if not found:
            continue
        frame = academic + teaching
        cleared = frame >= 1 and frame >= disclosure
        if cleared:
            return RuleOutcome(CATEGORY_OK, "low", (), family, certain=False, needs_model=True,
                               academic=academic, disclosure=disclosure)
        category, severity = _category_for(family)
        return RuleOutcome(category, severity, found, family, certain=False, needs_model=True,
                           academic=academic, disclosure=disclosure)

    # 4. Concern-adjacent and nothing more. Never a flag on its own; this is the only other thing
    #    the model layer is ever asked about.
    for family, phrases in _SOFT_SETS.items():
        if phrases.hits(forms):
            return RuleOutcome(CATEGORY_OK, "low", (), family, certain=False, needs_model=True,
                               academic=academic, disclosure=disclosure)

    # Nothing found. NOT "certain": certainty here means a positive finding that settles the
    # question, and finding nothing is exactly what a lexicon does when a child says it in words
    # nobody wrote down. It is only ``needs_model=False`` because asking about every clean maths
    # question is a cost the owner has not agreed to — SAFETY_MODEL_SCOPE=all is that decision.
    return RuleOutcome(CATEGORY_OK, "low", (), None, certain=False, needs_model=False,
                       academic=academic, disclosure=disclosure)


def screen_model_words(text: str) -> RuleOutcome:
    """Read one thing a MODEL wants to put in front of a child.

    The inbound screen reads first person and this reads second person, and they are not the same
    screen. Nothing here is cleared by an academic frame: a model has no homework to do, and there
    is no sentence in a lesson that needs to instruct a child in cutting their own wrist. A hit is
    ``certain``, so no model is asked to adjudicate what another model just said.

    Returns OK when nothing fires. The caller then falls through to the ordinary :func:`screen`,
    which still catches profanity and the first-person cases (a model quoting a child back).
    """
    forms = Forms.of(text)
    if not forms.spaced:
        return RuleOutcome(CATEGORY_OK, "low", (), None, certain=True, needs_model=False,
                           academic=0, disclosure=0)
    for family in (SELF_HARM, UNSAFE, GROOMING):
        hits = _OUTBOUND_SETS[family].hits(forms)
        if hits:
            return RuleOutcome(CATEGORY_CRISIS, "high", hits, family, certain=True,
                               needs_model=False, academic=0, disclosure=0)
    return RuleOutcome(CATEGORY_OK, "low", (), None, certain=False, needs_model=False,
                       academic=0, disclosure=0)


class RuleClassifier:
    """The offline screen as a :class:`~wobo_gateway.safety.SafetyClassifier`."""

    def classify(self, text: str) -> SafetyVerdict:
        return screen(text).verdict()


__all__ = [
    "ABUSE",
    "CATEGORY_CRISIS",
    "CATEGORY_MODERATION",
    "CATEGORY_OK",
    "GROOMING",
    "HARM_FAMILIES",
    "NEGLECT",
    "PERSONAL_DATA",
    "PROFANITY",
    "SELF_HARM",
    "SEXUAL",
    "THREAT",
    "UNSAFE",
    "Forms",
    "RuleClassifier",
    "RuleOutcome",
    "SafetyVerdict",
    "normalize",
    "screen",
    "screen_model_words",
]
