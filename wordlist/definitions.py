"""Short definitions for the guess list, from Open English WordNet (OEWN).

Extract: download the OEWN release pinned in config.json (URL plus SHA-256),
cached in wordlist/.cache/. Like ESDB, it is never refreshed automatically.

Transform: give each guess word up to maxPerWord definitions. A word WordNet
lists itself uses its own entry; an inflected form ("plots", "dying") is
matched to its base word ("plot", "die"). Hand-written entries in
rules/definitions.txt replace the generated ones.

Load: etl.py writes lists/definitions.json with the other lists.

Standard library only. OEWN is CC BY 4.0, so the app must credit it (see
NOTICE-OEWN).
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import BinaryIO

POS_NAMES = {"n": "noun", "v": "verb", "a": "adjective", "s": "adjective", "r": "adverb"}
# Ties on sense count go to the reading people meet first.
POS_ORDER = ["noun", "verb", "adjective", "adverb"]
# Senses whose gloss labels the word itself as a slur or an offensive term
# ("(ethnic slur) ...", "an offensive term for ...", "(offensive) ...") are
# never shown. Glosses that merely use the words ("an offensive against an
# enemy", "flashy and vulgar") are kept.
_LABEL = r"(offensive|disparaging|derogatory|vulgar|obscene|insulting)"
UNSHOWABLE = re.compile(
    rf"\bslurs?\b|\b{_LABEL}(\s+and\s+\w+)?(\s+slang)?\s+(terms?|names?|words?)\b"
    rf"|^\((\w+\s+)?{_LABEL}\b", re.I)

# One definition: part of speech, text, and the base word when the entry
# belongs to a base word rather than the word itself.
Entry = dict  # {"p": str, "d": str, "l"?: str}


@dataclass
class WordNet:
    # lemma -> part of speech -> definitions, in WordNet's sense order
    senses: dict[str, dict[str, list[str]]] = field(
        default_factory=lambda: defaultdict(lambda: defaultdict(list)))
    # irregular form -> {(base word, part of speech)}, e.g. geese -> goose
    irregular: dict[str, set[tuple[str, str]]] = field(
        default_factory=lambda: defaultdict(set))

    def sense_count(self, lemma: str) -> int:
        return sum(len(d) for d in self.senses.get(lemma, {}).values())


# --- Extract -----------------------------------------------------------------


def ensure_source(url: str, sha256: str, cache_dir: Path) -> Path:
    """Download the pinned OEWN release once and check its hash."""
    path = cache_dir / url.rsplit("/", 1)[-1]
    if not path.exists():
        cache_dir.mkdir(parents=True, exist_ok=True)
        print(f"Downloading {url} ...")
        tmp = path.with_suffix(path.suffix + ".tmp")
        with urllib.request.urlopen(url, timeout=120) as resp, open(tmp, "wb") as out:
            out.write(resp.read())
        tmp.rename(path)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != sha256:
        raise SystemExit(
            f"{path.name} has SHA-256 {digest}, but config.json pins {sha256}. "
            "Delete the file to download it again, or update the pin on purpose.")
    return path


def parse(source: BinaryIO) -> WordNet:
    """Read an OEWN WN-LMF XML stream. Keeps lowercase single-word lemmas only,
    which drops proper nouns and phrases."""
    wn = WordNet()
    entry_synsets: list[tuple[str, str, str]] = []  # (lemma, pos, synset id)
    glosses: dict[str, str] = {}
    for _, el in ET.iterparse(source, events=("end",)):
        if el.tag == "LexicalEntry":
            lemma_el = el.find("Lemma")
            lemma = lemma_el.get("writtenForm", "")
            pos = POS_NAMES.get(lemma_el.get("partOfSpeech", ""))
            if pos and lemma.isascii() and lemma.isalpha() and lemma.islower():
                for sense in el.findall("Sense"):
                    entry_synsets.append((lemma, pos, sense.get("synset")))
                for form in el.findall("Form"):
                    wn.irregular[form.get("writtenForm")].add((lemma, pos))
            el.clear()
        elif el.tag == "Synset":
            gloss = el.find("Definition")
            if gloss is not None and gloss.text:
                glosses[el.get("id")] = " ".join(gloss.text.split())
            el.clear()
    for lemma, pos, synset in entry_synsets:
        gloss = glosses.get(synset)
        if gloss and not UNSHOWABLE.search(gloss):
            wn.senses[lemma][pos].append(gloss)
    return wn


def load(path: Path) -> WordNet:
    with gzip.open(path) as f:
        return parse(f)


# --- Transform ---------------------------------------------------------------


def base_candidates(word: str, wn: WordNet) -> list[tuple[str, set[str]]]:
    """Possible (base word, allowed parts of speech) for an inflected form,
    most likely first. Only candidates WordNet lists are useful."""
    out = [(lemma, {pos}) for lemma, pos in sorted(wn.irregular.get(word, ()))]
    noun_verb, verb, adj = {"noun", "verb"}, {"verb"}, {"adjective", "adverb"}
    w = word
    if w.endswith("s") and not w.endswith("ss"):
        out.append((w[:-1], noun_verb))
        if w.endswith("es"):
            out.append((w[:-2], noun_verb))
        if w.endswith("ies"):
            out.append((w[:-3] + "y", noun_verb))
    if w.endswith("ied"):
        out.append((w[:-3] + "y", verb))
    if w.endswith("ed"):
        out += [(w[:-1], verb), (w[:-2], verb)]
        if w[-3] == w[-4]:
            out.append((w[:-3], verb))  # stopped -> stop
    if w.endswith("ing"):
        out += [(w[:-3] + "e", verb), (w[:-3], verb)]
        if w[-4] == w[-5]:
            out.append((w[:-4], verb))  # running -> run
        if w.endswith("ying"):
            out.append((w[:-4] + "ie", verb))  # dying -> die
    if w.endswith("ier"):
        out.append((w[:-3] + "y", adj))
    if w.endswith("er"):
        out += [(w[:-1], adj), (w[:-2], adj)]
        if w[-3] == w[-4]:
            out.append((w[:-3], adj))  # bigger -> big
    if w.endswith("est"):
        out += [(w[:-2], adj), (w[:-3], adj)]
    return out


def entries_for(lemma: str, wn: WordNet, allowed: set[str] | None = None) -> list[Entry]:
    """The first definition for each part of speech, most senses first."""
    by_pos = wn.senses.get(lemma, {})
    ranked = sorted(
        (pos for pos in by_pos if by_pos[pos] and (allowed is None or pos in allowed)),
        key=lambda pos: (-len(by_pos[pos]), POS_ORDER.index(pos)))
    return [{"p": pos, "d": by_pos[pos][0]} for pos in ranked]


def define(word: str, wn: WordNet, limit: int) -> list[Entry]:
    own = entries_for(word, wn)
    base: list[Entry] = []
    for lemma, allowed in base_candidates(word, wn):
        found = entries_for(lemma, wn, allowed)
        if found:
            base = [dict(e, l=lemma) for e in found]
            break
    if not base:
        return own[:limit]
    lemma = base[0]["l"]
    # "-ed"/"-ing" words and irregular forms read best through their base word
    # ("dying" -> die, "geese" -> goose), as do "-s" words whose base word is
    # the more common one ("flies" -> fly). Otherwise the word's own entry
    # leads ("later" before "late", "outer" before "out").
    base_first = (word.endswith(("ed", "ing")) or word in wn.irregular
                  or (word.endswith("s") and wn.sense_count(lemma) > wn.sense_count(word)))
    if not own:
        merged = base
    elif base_first:
        merged = base[:1] + own[:1] + base[1:] + own[1:]
    else:
        merged = own + base
    return merged[:limit]


@dataclass
class Override:
    """Hand-written definitions for one word from rules/definitions.txt."""

    entries: list[Entry] = field(default_factory=list)
    base: str | None = None  # "women | = woman": define through another word
    hidden: bool = False  # "word | -": show no definition


def read_overrides(path: Path) -> dict[str, Override]:
    """Lines are `word | part of speech | definition`, `word | = base word`
    or `word | -`. Several lines for one word list its definitions in order.
    '#' starts a comment."""
    overrides: dict[str, Override] = {}
    if not path.exists():
        return overrides
    for n, raw in enumerate(path.read_text().splitlines(), 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split("|")]
        word = parts[0].lower()
        o = overrides.setdefault(word, Override())
        if len(parts) == 2 and parts[1] == "-":
            o.hidden = True
        elif len(parts) == 2 and parts[1].startswith("="):
            o.base = parts[1][1:].strip().lower()
        elif len(parts) == 3 and parts[1] in POS_ORDER and parts[2]:
            o.entries.append({"p": parts[1], "d": parts[2]})
        else:
            raise ValueError(
                f"{path.name}:{n}: expected `word | part of speech | definition`, "
                f"`word | = base word` or `word | -`, got: {raw.strip()}")
    return overrides


def build(words: list[str], wn: WordNet, overrides: dict[str, Override],
          limit: int) -> dict[str, list[Entry]]:
    """Definitions for each word that has any, keyed and sorted by word."""
    out: dict[str, list[Entry]] = {}
    for word in words:
        o = overrides.get(word)
        if o and o.hidden:
            continue
        if o and o.entries:
            entries = o.entries[:limit]
        elif o and o.base:
            base_override = overrides.get(o.base)
            base_entries = (base_override.entries if base_override and base_override.entries
                            else entries_for(o.base, wn))
            entries = [dict(e, l=o.base) for e in base_entries[:limit]]
        else:
            entries = define(word, wn, limit)
        if entries:
            out[word] = entries
    return out


def check_overrides(overrides: dict[str, Override], guess: set[str]) -> list[str]:
    problems = []
    for word, o in sorted(overrides.items()):
        if word not in guess:
            problems.append(f"definitions.txt: {word!r} is not on the guess list")
        if sum([o.hidden, bool(o.entries), o.base is not None]) > 1:
            problems.append(f"definitions.txt: {word!r} mixes `-`, `=` and definitions")
    return problems


# --- Load --------------------------------------------------------------------


def dumps(definitions: dict[str, list[Entry]]) -> str:
    """One word per line, so a change to the file diffs cleanly."""
    lines = [f"{json.dumps(w)}:{json.dumps(e, ensure_ascii=False, separators=(',', ':'))}"
             for w, e in sorted(definitions.items())]
    return "{\n" + ",\n".join(lines) + "\n}\n"
