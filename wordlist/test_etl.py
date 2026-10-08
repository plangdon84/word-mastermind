"""Tests for etl.py. Run: python3 -m unittest discover wordlist"""

import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

import etl

CONFIG = json.loads((Path(__file__).parent / "config.json").read_text())


def row(word, size=35, pos="n0", spelling="_", variant_level=0,
        usage_note="", category="", pos_category="", tag="", region="",
        annotation=""):
    return etl.Row(word, size, pos, pos_category, category, usage_note,
                   spelling, variant_level, tag, region, annotation)


def build(rows, rules=None):
    return etl.transform(rows, CONFIG, rules or etl.Rules())


class TransformTest(unittest.TestCase):
    def test_common_base_word_is_secret_and_guess(self):
        r = build([row("crane")])
        self.assertEqual(r.secret, ["crane"])
        self.assertEqual(r.guess, ["crane"])

    def test_repeated_letters_are_guess_only(self):
        r = build([row("bunny")])
        self.assertEqual(r.secret, [])
        self.assertEqual(r.guess, ["bunny"])
        self.assertEqual(r.candidates[0].reason, "repeated letters")

    def test_natural_plurals_and_s_forms_are_secret(self):
        r = build([row("caves", pos="ms"), row("germs", pos="ns"),
                   row("knows", pos="vs")])
        self.assertEqual(r.secret, ["caves", "germs", "knows"])

    def test_annotated_plural_is_guess_only(self):
        # ESDB marks plurals of mass nouns '~' (inapplicable).
        r = build([row("infos", 35, "ns", annotation="~")])
        self.assertEqual((r.secret, r.guess), ([], ["infos"]))
        self.assertEqual(r.candidates[0].reason,
                         "inflected form annotated upstream as unnatural")

    def test_uncommon_plural_is_guess_only(self):
        r = build([row("germs", 50, "ns")])
        self.assertEqual((r.secret, r.guess), ([], ["germs"]))
        self.assertEqual(r.candidates[0].reason, "size 50 > 35")

    def test_past_tense_and_ing_forms_are_secret(self):
        r = build([row("liked", pos="vd"), row("taken", pos="vn"),
                   row("using", pos="vg")])
        self.assertEqual(r.secret, ["liked", "taken", "using"])

    def test_comparatives_and_superlatives_are_secret(self):
        r = build([row("wider", pos="a1"), row("safer", pos="aj1"),
                   row("least", pos="aj2")])
        self.assertEqual(r.secret, ["least", "safer", "wider"])

    def test_other_inflection_is_guess_only(self):
        r = build([row("wiers", pos="nss")])
        self.assertEqual((r.secret, r.guess), ([], ["wiers"]))
        self.assertEqual(r.candidates[0].reason,
                         "inflected form not allowed for secrets")

    def test_disallowed_form_does_not_lend_its_size(self):
        # A common but disallowed form (plural of a plural) doesn't make the
        # word a secret when its allowed form is only size 80.
        r = build([row("wiers", 35, "nss"), row("wiers", 80, "n0")])
        self.assertEqual(r.secret, [])
        self.assertEqual(r.candidates[0].reason, "size 80 > 35")

    def test_size_limits(self):
        r = build([row("nacre", 50), row("ulpan", 80), row("zzxyq", 85)])
        self.assertEqual(r.secret, [])
        self.assertEqual(r.guess, ["nacre", "ulpan"])
        self.assertEqual(r.candidates[2].status, "rejected")

    def test_british_spelling_is_guess_only(self):
        r = build([row("fibre", spelling="B")])
        self.assertEqual((r.secret, r.guess), ([], ["fibre"]))

    def test_regions(self):
        r = build([row("bonza", region="AU"), row("tonka", region="GB")])
        self.assertEqual((r.secret, r.guess), ([], ["tonka"]))

    def test_excluded_categories_and_poses(self):
        r = build([row("xviii", pos="x", pos_category="nonword"),
                   row("grepd", category="hacker"),
                   row("multi", pos="pre", pos_category="nonword")])
        self.assertEqual((r.secret, r.guess), ([], []))

    def test_usage_note_bans(self):
        r = build([row("fucks", 40, "ns", usage_note="vulgar-1")])
        self.assertEqual((r.guess, r.banned), ([], ["fucks"]))

    def test_rule_files(self):
        rules = etl.Rules(ban={"whore"}, secret_exclude={"penis"},
                          secret_include={"cabin", "blimp"},
                          guess_include={"zzzzz"})
        r = build([row("whore"), row("penis"), row("cabin", 60),
                   row("blimp", 90)], rules)
        self.assertEqual(r.secret, ["blimp", "cabin"])
        self.assertEqual(r.guess, ["blimp", "cabin", "penis", "zzzzz"])
        self.assertEqual(r.banned, ["whore"])

    def test_include_overrides_usage_note(self):
        rules = etl.Rules(guess_include={"craps"})
        r = build([row("craps", 40, "ns", usage_note="vulgar-3")], rules)
        self.assertEqual((r.guess, r.banned), (["craps"], []))

    def test_check_rules(self):
        rules = etl.Rules(ban={"whore", "toolong"}, secret_include={"whore", "bunny"})
        problems = etl.check_rules(rules, 5)
        self.assertEqual(len(problems), 3)


class LoadTest(unittest.TestCase):
    def test_diff(self):
        self.assertEqual(etl.diff(None, ["a"]), ([], []))
        self.assertEqual(etl.diff(["a", "b"], ["b", "c"]), (["c"], ["a"]))

    def test_purge_logs_by_name(self):
        now = dt.datetime(2026, 9, 27, tzinfo=dt.timezone.utc)
        with tempfile.TemporaryDirectory() as d:
            logs = Path(d)
            old = logs / "2025-09-26_120000Z.md"
            recent = logs / "2025-09-28_120000Z.md"
            other = logs / "README.md"
            for p in (old, recent, other):
                p.write_text("x")
            purged = etl.purge_logs(logs, now, 365)
            self.assertEqual(purged, [old])
            self.assertTrue(recent.exists() and other.exists())


if __name__ == "__main__":
    unittest.main()
