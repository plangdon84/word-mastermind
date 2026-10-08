"""Tests for definitions.py. Run: python3 -m unittest discover wordlist"""

import io
import json
import tempfile
import unittest
from pathlib import Path

import definitions as d

# A tiny WN-LMF file: entries point at synsets, synsets carry the glosses.
XML = """<?xml version="1.0" encoding="UTF-8"?>
<LexicalResource><Lexicon id="oewn">
  <LexicalEntry id="e1"><Lemma writtenForm="plot" partOfSpeech="n"/>
    <Sense id="s1" synset="plot-n"/></LexicalEntry>
  <LexicalEntry id="e2"><Lemma writtenForm="plot" partOfSpeech="v"/>
    <Sense id="s2" synset="plot-v"/></LexicalEntry>
  <LexicalEntry id="e3"><Lemma writtenForm="die" partOfSpeech="v"/>
    <Sense id="s3" synset="die-v"/></LexicalEntry>
  <LexicalEntry id="e4"><Lemma writtenForm="dying" partOfSpeech="a"/>
    <Sense id="s4" synset="dying-a"/></LexicalEntry>
  <LexicalEntry id="e5"><Lemma writtenForm="goose" partOfSpeech="n"/>
    <Form writtenForm="geese"/><Sense id="s5" synset="goose-n"/></LexicalEntry>
  <LexicalEntry id="e6"><Lemma writtenForm="Egypt" partOfSpeech="n"/>
    <Sense id="s6" synset="egypt-n"/></LexicalEntry>
  <LexicalEntry id="e7"><Lemma writtenForm="crane" partOfSpeech="n"/>
    <Sense id="s7" synset="slur-n"/><Sense id="s8" synset="crane-n"/></LexicalEntry>
  <LexicalEntry id="e8"><Lemma writtenForm="late" partOfSpeech="a"/>
    <Sense id="s9" synset="late-a"/></LexicalEntry>
  <LexicalEntry id="e9"><Lemma writtenForm="later" partOfSpeech="r"/>
    <Sense id="s10" synset="later-r"/></LexicalEntry>
  <Synset id="plot-n" partOfSpeech="n"><Definition>a secret scheme</Definition></Synset>
  <Synset id="plot-v" partOfSpeech="v"><Definition>plan secretly</Definition></Synset>
  <Synset id="die-v" partOfSpeech="v"><Definition>pass from physical life</Definition></Synset>
  <Synset id="dying-a" partOfSpeech="a"><Definition>in the process of passing from life</Definition></Synset>
  <Synset id="goose-n" partOfSpeech="n"><Definition>a web-footed bird</Definition></Synset>
  <Synset id="egypt-n" partOfSpeech="n"><Definition>a country</Definition></Synset>
  <Synset id="slur-n" partOfSpeech="n"><Definition>(ethnic slur) an offensive term</Definition></Synset>
  <Synset id="crane-n" partOfSpeech="n"><Definition>a machine that lifts heavy objects</Definition></Synset>
  <Synset id="late-a" partOfSpeech="a"><Definition>after the expected time</Definition></Synset>
  <Synset id="later-r" partOfSpeech="r"><Definition>at a subsequent time</Definition></Synset>
</Lexicon></LexicalResource>
"""


def wordnet():
    return d.parse(io.BytesIO(XML.encode()))


def overrides(text):
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "definitions.txt"
        path.write_text(text)
        return d.read_overrides(path)


class DefineTest(unittest.TestCase):
    def test_base_word_has_its_own_definitions(self):
        self.assertEqual(d.define("crane", wordnet(), 2),
                         [{"p": "noun", "d": "a machine that lifts heavy objects"}])

    def test_plural_is_defined_through_its_base_word(self):
        self.assertEqual(d.define("plots", wordnet(), 2), [
            {"p": "noun", "d": "a secret scheme", "l": "plot"},
            {"p": "verb", "d": "plan secretly", "l": "plot"},
        ])

    def test_ing_form_leads_with_the_verb_then_its_own_sense(self):
        self.assertEqual(d.define("dying", wordnet(), 2), [
            {"p": "verb", "d": "pass from physical life", "l": "die"},
            {"p": "adjective", "d": "in the process of passing from life"},
        ])

    def test_irregular_form_uses_its_base_word(self):
        self.assertEqual(d.define("geese", wordnet(), 2),
                         [{"p": "noun", "d": "a web-footed bird", "l": "goose"}])

    def test_comparative_with_its_own_entry_leads_with_it(self):
        self.assertEqual(d.define("later", wordnet(), 1),
                         [{"p": "adverb", "d": "at a subsequent time"}])

    def test_limit_caps_the_number_of_definitions(self):
        self.assertEqual(len(d.define("plots", wordnet(), 1)), 1)

    def test_proper_nouns_are_ignored(self):
        self.assertEqual(d.define("egypt", wordnet(), 2), [])

    def test_slur_senses_are_dropped(self):
        wn = wordnet()
        self.assertEqual(wn.senses["crane"]["noun"], ["a machine that lifts heavy objects"])

    def test_unshowable_matches_labels_not_ordinary_uses(self):
        for gloss in ["(ethnic slur) a term", "an offensive term for someone",
                      "(offensive) of a condition", "disparaging terms for people"]:
            self.assertTrue(d.UNSHOWABLE.search(gloss), gloss)
        for gloss in ["(military) an offensive against an enemy", "flashy and vulgar",
                      "a disparaging remark"]:
            self.assertFalse(d.UNSHOWABLE.search(gloss), gloss)


class OverrideTest(unittest.TestCase):
    def test_override_replaces_generated_definitions(self):
        o = overrides("crane | noun | a tall wading bird\ncrane | verb | stretch the neck\n")
        self.assertEqual(d.build(["crane"], wordnet(), o, 2), {"crane": [
            {"p": "noun", "d": "a tall wading bird"},
            {"p": "verb", "d": "stretch the neck"},
        ]})

    def test_equals_defines_through_another_word(self):
        o = overrides("plots | = die\n")
        self.assertEqual(d.build(["plots"], wordnet(), o, 2),
                         {"plots": [{"p": "verb", "d": "pass from physical life", "l": "die"}]})

    def test_dash_hides_a_word(self):
        self.assertEqual(d.build(["crane"], wordnet(), overrides("crane | -\n"), 2), {})

    def test_words_without_definitions_are_left_out(self):
        self.assertEqual(d.build(["zzzzz"], wordnet(), {}, 2), {})

    def test_bad_line_is_rejected(self):
        with self.assertRaises(ValueError):
            overrides("crane | noun\n")
        with self.assertRaises(ValueError):
            overrides("crane | pronoun | a word\n")

    def test_check_flags_unknown_and_mixed_words(self):
        o = overrides("crane | -\ncrane | = plot\nzzzzz | -\n")
        problems = d.check_overrides(o, {"crane"})
        self.assertEqual(len(problems), 2)


class DumpsTest(unittest.TestCase):
    def test_one_word_per_line_and_valid_json(self):
        text = d.dumps({"plots": [{"p": "noun", "d": "a scheme", "l": "plot"}],
                        "crane": [{"p": "noun", "d": "a machine"}]})
        self.assertEqual(text.splitlines()[1], '"crane":[{"p":"noun","d":"a machine"}],')
        self.assertEqual(len(json.loads(text)), 2)


class GeneratedFileTest(unittest.TestCase):
    """Checks on the committed lists/definitions.json."""

    lists = Path(__file__).parent / "lists"

    def test_every_secret_word_has_a_definition(self):
        defs = json.loads((self.lists / "definitions.json").read_text())
        secret = (self.lists / "secret.txt").read_text().split()
        self.assertEqual([w for w in secret if w not in defs], [])

    def test_only_guess_words_are_defined(self):
        defs = json.loads((self.lists / "definitions.json").read_text())
        guess = set((self.lists / "guess.txt").read_text().split())
        self.assertEqual([w for w in defs if w not in guess], [])


if __name__ == "__main__":
    unittest.main()
