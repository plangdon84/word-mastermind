#!/usr/bin/env python3
"""Build the Word Mastermind secret, guess and ban lists from ESDB (SCOWL),
and the guess words' definitions from Open English WordNet (definitions.py).

Extract: fetch the upstream ESDB repo at the commit pinned in config.json and
build its SQLite database (cached in wordlist/.cache/). Upstream is never
refreshed automatically: moving to a newer ESDB means editing the pinned
commit on purpose.

Transform: apply the rules in config.json and the hand-maintained files in
wordlist/rules/ to produce the lists.

Load: write wordlist/lists/ (including definitions.json), diff against the
previous load, write a change log to wordlist/logs/ and purge logs older than
logRetentionDays.

Standard library only. Run from anywhere: python3 wordlist/etl.py
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sqlite3
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

import definitions

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.json"
RULES_DIR = ROOT / "rules"
LISTS_DIR = ROOT / "lists"
LOGS_DIR = ROOT / "logs"
CACHE_DIR = ROOT / ".cache"

LIST_NAMES = ("secret", "guess", "banned")
LOG_NAME_FORMAT = "%Y-%m-%d_%H%M%SZ"


# --- Extract -----------------------------------------------------------------


@dataclass(frozen=True)
class Row:
    """One row of ESDB's scowl_ view (one word form in one sense)."""

    word: str
    size: int
    pos: str
    pos_category: str
    category: str
    usage_note: str
    spelling: str
    variant_level: int
    tag: str
    region: str = ""
    # ESDB annotation on a derived form: '' (none), '~' inapplicable (e.g.
    # the plural of a mass noun), '!' infrequent, '-' uncommon, '@' archaic,
    # '*' usage dependent.
    annotation: str = ""


def run(cmd: list[str], cwd: Path) -> None:
    subprocess.run(cmd, cwd=cwd, check=True)


def ensure_db(repo: str, commit: str) -> Path:
    """Check out the pinned commit and build scowl.db, reusing the cache."""
    checkout = CACHE_DIR / f"esdb-{commit[:12]}"
    db = checkout / "scowl.db"
    if db.exists():
        return db
    checkout.mkdir(parents=True, exist_ok=True)
    if not (checkout / ".git").exists():
        run(["git", "init", "--quiet"], checkout)
        run(["git", "remote", "add", "origin", repo], checkout)
    run(["git", "fetch", "--quiet", "--depth", "1", "origin", commit], checkout)
    run(["git", "checkout", "--quiet", "FETCH_HEAD"], checkout)
    print(f"Building ESDB database at {commit[:12]} (about a minute)...")
    tmp = checkout / "scowl.db.tmp"
    tmp.unlink(missing_ok=True)
    run([sys.executable, "combine.py", "create-db", tmp.name], checkout)
    tmp.rename(db)
    return db


def latest_upstream_commit(repo: str) -> str | None:
    """Upstream HEAD, for reporting only. Never used to refresh."""
    try:
        out = subprocess.run(
            ["git", "ls-remote", repo, "HEAD"],
            capture_output=True, text=True, timeout=30, check=True,
        ).stdout
        return out.split()[0] if out else None
    except (subprocess.SubprocessError, OSError):
        return None


def extract_rows(db: Path, length: int) -> list[Row]:
    """Every lowercase a-z word of the given length. Lowercase-only drops
    proper nouns, which ESDB stores capitalised as separate entries.

    Reads scowl_ (the view behind the documented scowl_v0) because only it
    carries entry_rank, ESDB's annotation on derived forms. Safe because the
    upstream commit is pinned."""
    pattern = re.compile(f"[a-z]{{{length}}}")
    conn = sqlite3.connect(db)
    try:
        cur = conn.execute(
            "select word, size, pos, pos_category, category, usage_note,"
            " spelling, variant_level, tag, region, coalesce(entry_rank, '')"
            " from scowl_ where length(word) = ?",
            (length,),
        )
        rows = [Row(*r) for r in cur if pattern.fullmatch(r[0])]
    finally:
        conn.close()
    return rows


# --- Transform ---------------------------------------------------------------


def read_word_file(path: Path) -> set[str]:
    """One word per line; '#' starts a comment; case-insensitive."""
    if not path.exists():
        return set()
    words = set()
    for line in path.read_text().splitlines():
        word = line.split("#", 1)[0].strip().lower()
        if word:
            words.add(word)
    return words


@dataclass
class Rules:
    ban: set[str] = field(default_factory=set)
    secret_include: set[str] = field(default_factory=set)
    secret_exclude: set[str] = field(default_factory=set)
    guess_include: set[str] = field(default_factory=set)

    @classmethod
    def load(cls, rules_dir: Path) -> "Rules":
        return cls(
            ban=read_word_file(rules_dir / "ban.txt"),
            secret_include=read_word_file(rules_dir / "secret-include.txt"),
            secret_exclude=read_word_file(rules_dir / "secret-exclude.txt"),
            guess_include=read_word_file(rules_dir / "guess-include.txt"),
        )


@dataclass
class Candidate:
    """A word's fate, with the reason it missed each list, for review."""

    word: str
    status: str  # secret | guess | banned | rejected
    reason: str
    min_size: int
    poses: str
    spellings: str
    usage_notes: str
    tags: str
    annotations: str


@dataclass
class Result:
    secret: list[str]
    guess: list[str]
    banned: list[str]
    candidates: list[Candidate]


def has_repeated_letters(word: str) -> bool:
    return len(set(word)) != len(word)


def check_rules(rules: Rules, length: int) -> list[str]:
    """Problems in the hand-maintained files that must be fixed first."""
    problems = []
    pattern = re.compile(f"[a-z]{{{length}}}")
    for name, words in (
        ("ban", rules.ban),
        ("secret-include", rules.secret_include),
        ("secret-exclude", rules.secret_exclude),
        ("guess-include", rules.guess_include),
    ):
        for w in sorted(words):
            if not pattern.fullmatch(w):
                problems.append(f"{name}.txt: '{w}' is not {length} letters a-z")
    for w in sorted(rules.secret_include & rules.ban):
        problems.append(f"'{w}' is in both secret-include.txt and ban.txt")
    for w in sorted(rules.guess_include & rules.ban):
        problems.append(f"'{w}' is in both guess-include.txt and ban.txt")
    for w in sorted(rules.secret_include & rules.secret_exclude):
        problems.append(f"'{w}' is in both secret-include.txt and secret-exclude.txt")
    for w in sorted(rules.secret_include):
        if has_repeated_letters(w):
            problems.append(f"secret-include.txt: '{w}' repeats a letter")
    return problems


def transform(rows: list[Row], config: dict, rules: Rules) -> Result:
    sec, gue, exc = config["secret"], config["guess"], config["exclude"]

    def usable(r: Row) -> bool:
        return (
            r.category not in exc["categories"]
            and r.pos_category not in exc["posCategories"]
            and r.pos not in exc["poses"]
        )

    def guess_ok(r: Row, check_size: bool = True) -> bool:
        return (
            usable(r)
            and r.spelling in gue["spellings"]
            and r.region in gue["regions"]
            and r.variant_level <= gue["maxVariantLevel"]
            and (not check_size or r.size <= gue["maxSize"])
        )

    def secret_form_ok(r: Row) -> bool:
        """A base form, or an allowed inflection (plural, -s verb, past
        tense, -ing, comparative, superlative) that ESDB doesn't annotate as
        inapplicable, infrequent, uncommon or archaic."""
        return r.pos in sec["basePoses"] or (
            r.pos in sec["inflectedPoses"]
            and r.annotation not in sec["excludeFormAnnotations"]
        )

    def secret_ok(r: Row, check_size: bool = True, check_pos: bool = True) -> bool:
        return (
            usable(r)
            and r.spelling in sec["spellings"]
            and r.region in sec["regions"]
            and r.variant_level <= sec["maxVariantLevel"]
            and (not check_pos or secret_form_ok(r))
            and (not check_size or r.size <= sec["maxSize"])
        )

    by_word: dict[str, list[Row]] = {}
    for r in rows:
        by_word.setdefault(r.word, []).append(r)

    # An explicit include overrides an upstream usage note (not ban.txt).
    flagged = {
        w for w, rs in by_word.items()
        if any(r.usage_note in exc["usageNotes"] for r in rs)
    } - rules.secret_include - rules.guess_include
    banned = rules.ban | flagged

    secret, guess, candidates = set(), set(), {}
    for word, rs in by_word.items():
        if word in banned:
            status = "banned"
            reason = "ban.txt" if word in rules.ban else "upstream usage note"
        elif word in rules.secret_include:
            status, reason = "secret", "secret-include.txt"
        elif any(secret_ok(r) for r in rs) and not has_repeated_letters(word) \
                and word not in rules.secret_exclude:
            status, reason = "secret", ""
        elif any(guess_ok(r) for r in rs):
            status, reason = "guess", not_secret_reason(word, rs, rules, sec, secret_ok)
        else:
            status, reason = "rejected", not_guess_reason(rs, gue, guess_ok)

        if status == "secret":
            secret.add(word)
            guess.add(word)
        elif status == "guess":
            guess.add(word)

        candidates[word] = Candidate(
            word=word,
            status=status,
            reason=reason,
            min_size=min(r.size for r in rs),
            poses=",".join(sorted({r.pos for r in rs})),
            spellings=",".join(sorted({r.spelling for r in rs})),
            usage_notes=",".join(sorted({r.usage_note for r in rs} - {""})),
            tags=",".join(sorted({r.tag for r in rs} - {""})),
            annotations=",".join(sorted({f"{r.pos}{r.annotation}" for r in rs if r.annotation})),
        )

    # Hand-added words that ESDB doesn't have at all.
    for word in sorted(rules.secret_include | rules.guess_include):
        if word in candidates and candidates[word].status in ("secret", "guess"):
            continue
        is_secret = word in rules.secret_include
        (secret if is_secret else guess).add(word)
        guess.add(word)
        candidates[word] = Candidate(
            word=word,
            status="secret" if is_secret else "guess",
            reason="secret-include.txt" if is_secret else "guess-include.txt",
            min_size=candidates[word].min_size if word in candidates else 0,
            poses="", spellings="", usage_notes="", tags="", annotations="",
        )

    return Result(
        secret=sorted(secret),
        guess=sorted(guess),
        banned=sorted(banned),
        candidates=[candidates[w] for w in sorted(candidates)],
    )


def not_secret_reason(word, rs, rules, sec, secret_ok) -> str:
    if has_repeated_letters(word):
        return "repeated letters"
    if word in rules.secret_exclude:
        return "secret-exclude.txt"
    if not any(secret_ok(r, check_size=False, check_pos=False) for r in rs):
        return "spelling, variant or region not allowed for secrets"
    forms = [r for r in rs if secret_ok(r, check_size=False)]
    if not forms:
        inflected = [r for r in rs if r.pos in sec["inflectedPoses"]]
        if inflected and all(r.annotation in sec["excludeFormAnnotations"] for r in inflected):
            return "inflected form annotated upstream as unnatural"
        return "inflected form not allowed for secrets"
    return f"size {min(r.size for r in forms)} > {sec['maxSize']}"


def not_guess_reason(rs, gue, guess_ok) -> str:
    sized = [r for r in rs if guess_ok(r, check_size=False)]
    if sized:
        return f"size {min(r.size for r in sized)} > {gue['maxSize']}"
    return "excluded spelling, variant, region, category or part of speech"


# --- Load --------------------------------------------------------------------


def read_list(path: Path) -> list[str] | None:
    if not path.exists():
        return None
    return [w for w in path.read_text().splitlines() if w]


def write_list(path: Path, words: list[str]) -> None:
    path.write_text("".join(f"{w}\n" for w in words))


def write_candidates(path: Path, candidates: list[Candidate]) -> None:
    cols = ["word", "status", "reason", "min_size", "poses",
            "spellings", "usage_notes", "tags", "annotations"]
    lines = ["\t".join(cols)]
    for c in candidates:
        lines.append("\t".join(str(getattr(c, k)) for k in cols))
    path.write_text("\n".join(lines) + "\n")


def diff(old: list[str] | None, new: list[str]) -> tuple[list[str], list[str]]:
    if old is None:
        return [], []
    o, n = set(old), set(new)
    return sorted(n - o), sorted(o - n)


def definitions_summary(defs: dict[str, list[dict]], result: Result,
                        changed: bool) -> list[str]:
    missing = [w for w in result.secret if w not in defs]
    lines = [
        f"- Definitions: {len(defs)} of {len(result.guess)} guess words, "
        f"{len(result.secret) - len(missing)} of {len(result.secret)} secret words"
        + ("" if changed else " (unchanged)"),
    ]
    if missing:
        lines.append("- Secret words with no definition: " + ", ".join(missing))
    return lines


def format_log(now: dt.datetime, config: dict, result: Result,
               previous: dict[str, list[str] | None],
               latest_upstream: str | None,
               definition_lines: list[str] = ()) -> str:
    pinned = config["upstream"]["commit"]
    lines = [
        f"# Word list load {now.strftime('%Y-%m-%d %H:%M:%S')} UTC",
        "",
        f"- Upstream: {config['upstream']['repo']} @ `{pinned[:12]}` (pinned)",
    ]
    if latest_upstream and latest_upstream != pinned:
        lines.append(
            f"- Note: upstream HEAD is now `{latest_upstream[:12]}`. "
            "Not applied; bump the pinned commit to take it."
        )
    lines += definition_lines
    lines += ["", "| List | Words | Added | Removed |", "|---|---|---|---|"]
    changes = {}
    for name in LIST_NAMES:
        new = getattr(result, name)
        added, removed = diff(previous[name], new)
        changes[name] = (added, removed)
        if previous[name] is None:
            lines.append(f"| {name} | {len(new)} | initial load | |")
        else:
            lines.append(f"| {name} | {len(new)} | {len(added)} | {len(removed)} |")
    for name in LIST_NAMES:
        added, removed = changes[name]
        if added or removed:
            lines += ["", f"## {name}"]
            if added:
                lines += ["", f"Added ({len(added)}): " + ", ".join(added)]
            if removed:
                lines += ["", f"Removed ({len(removed)}): " + ", ".join(removed)]
    return "\n".join(lines) + "\n"


def purge_logs(logs_dir: Path, now: dt.datetime, retention_days: int) -> list[Path]:
    """Delete logs older than the retention period. Uses the timestamp in the
    file name, not mtime, because a git checkout resets mtimes."""
    cutoff = now - dt.timedelta(days=retention_days)
    purged = []
    for path in sorted(logs_dir.glob("*.md")):
        try:
            stamp = dt.datetime.strptime(path.stem, LOG_NAME_FORMAT)
        except ValueError:
            continue
        if stamp.replace(tzinfo=dt.timezone.utc) < cutoff:
            path.unlink()
            purged.append(path)
    return purged


# --- Main --------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--db", type=Path,
                        help="use this scowl.db instead of fetching the pinned commit")
    parser.add_argument("--wordnet", type=Path,
                        help="use this OEWN .xml.gz instead of downloading the pinned release")
    parser.add_argument("--dry-run", action="store_true",
                        help="report changes without writing anything")
    parser.add_argument("--no-upstream-check", action="store_true",
                        help="skip checking whether upstream has newer commits")
    args = parser.parse_args(argv)

    config = json.loads(CONFIG_PATH.read_text())
    length = config["wordLength"]
    rules = Rules.load(RULES_DIR)
    problems = check_rules(rules, length)
    if problems:
        print("Fix these rule-file problems first:", *problems, sep="\n  ", file=sys.stderr)
        return 1

    db = args.db or ensure_db(config["upstream"]["repo"], config["upstream"]["commit"])
    result = transform(extract_rows(db, length), config, rules)

    defs_config = config["definitions"]
    try:
        overrides = definitions.read_overrides(RULES_DIR / "definitions.txt")
    except ValueError as e:
        print(f"Fix this rule-file problem first:\n  {e}", file=sys.stderr)
        return 1
    problems = definitions.check_overrides(overrides, set(result.guess))
    if problems:
        print("Fix these rule-file problems first:", *problems, sep="\n  ", file=sys.stderr)
        return 1
    wordnet = definitions.load(args.wordnet or definitions.ensure_source(
        defs_config["url"], defs_config["sha256"], CACHE_DIR))
    defs = definitions.build(result.guess, wordnet, overrides, defs_config["maxPerWord"])
    defs_text = definitions.dumps(defs)
    defs_path = LISTS_DIR / "definitions.json"
    defs_changed = not defs_path.exists() or defs_path.read_text() != defs_text

    previous = {n: read_list(LISTS_DIR / f"{n}.txt") for n in LIST_NAMES}
    changed = defs_changed or any(previous[n] != getattr(result, n) for n in LIST_NAMES)
    latest = None if args.no_upstream_check else latest_upstream_commit(config["upstream"]["repo"])
    now = dt.datetime.now(dt.timezone.utc)
    log = format_log(now, config, result, previous, latest,
                     definitions_summary(defs, result, defs_changed))
    print(log)

    if args.dry_run:
        return 0

    LISTS_DIR.mkdir(exist_ok=True)
    LOGS_DIR.mkdir(exist_ok=True)
    for name in LIST_NAMES:
        write_list(LISTS_DIR / f"{name}.txt", getattr(result, name))
    write_candidates(LISTS_DIR / "candidates.tsv", result.candidates)
    defs_path.write_text(defs_text)
    manifest = {
        "upstream": config["upstream"],
        "definitionsSource": {k: defs_config[k] for k in ("source", "url", "sha256")},
        "counts": {**{n: len(getattr(result, n)) for n in LIST_NAMES},
                   "definitions": len(defs)},
    }
    (LISTS_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    # A log only when something changed, so scheduled runs with no change
    # don't pile up empty logs.
    if changed:
        log_path = LOGS_DIR / f"{now.strftime(LOG_NAME_FORMAT)}.md"
        log_path.write_text(log)
        print(f"Wrote {log_path.relative_to(ROOT.parent)}")
    else:
        print("No list changes; no log written.")
    for path in purge_logs(LOGS_DIR, now, config["logRetentionDays"]):
        print(f"Purged {path.relative_to(ROOT.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
