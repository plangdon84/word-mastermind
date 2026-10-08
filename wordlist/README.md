# Word lists

The secret, guess and ban lists are built by an ETL script from
[ESDB](https://github.com/en-wl/wordlist) (formerly SCOWL), whose main source
is Alan Beale's 12dicts. The same run builds short definitions for the guess
words from [Open English WordNet](https://github.com/globalwordnet/english-wordnet)
(see [Definitions](#definitions)). The generated files are committed; the app
never fetches anything from a third party at runtime.

```sh
npm run wordlist                       # full run
python3 wordlist/etl.py --dry-run      # show what would change, write nothing
python3 -m unittest discover wordlist  # tests
```

Needs Python 3 and git. The first run fetches and builds the pinned ESDB
commit (about a minute) and downloads the pinned WordNet release (about 11 MB)
into `wordlist/.cache/` (git-ignored); later runs reuse them.

## Pinned, not auto-refreshed

`config.json` pins an exact upstream commit. Each run rebuilds the lists
from that commit plus our rule files, so the lists only change when we
change a rule or deliberately bump the pin. Each log notes when upstream has
newer commits, but never applies them. Nothing runs it on a schedule.

## Pipeline

1. **Extract:** every lowercase 5-letter a–z word from ESDB's `scowl_` view (the view behind the documented `scowl_v0`, plus each form's annotation).
   Keeping lowercase words only drops proper nouns (ESDB stores `Egypt`,
   `Steve` and so on capitalised).
2. **Transform:** apply `config.json`, then the rule files:

   | Rule | Secret list | Guess list |
   |---|---|---|
   | Size (how common; see below) | ≤ 35 | ≤ 80 |
   | Form | base forms, plus conversational plurals, "-s" verbs, past tenses, "-ing" forms, comparatives and superlatives (`caves`, `hates`, `liked`, `dying`, `wider`) | any |
   | Repeated letters | not allowed | allowed |
   | Spelling | American | American, British, Canadian |
   | Region-specific words | none, or US | none, US, GB, CA |
   | Abbreviations, Roman numerals, prefixes, contractions, hacker slang | excluded | excluded |
   | Upstream vulgar/offensive usage notes | banned | banned |

   Every secret word is also a guess word.

   **Inflected forms in the secret list.** Plurals, "-s" verbs, past tenses,
   "-ing" forms, comparatives and superlatives are allowed (`inflectedPoses`)
   if they're conversational.
   ESDB lists only real inflections, so made-up forms such as `lifes` or
   `whichs` never appear. ESDB annotates forms that exist but read oddly (for
   example `infos`, the plural of a mass noun), and those are left out
   (`excludeFormAnnotations`). An inflected form also has to meet the same
   size ≤ 35 cut-off. Odd forms that ESDB doesn't annotate (`balds`, `bayed`,
   `apter`) are listed in `rules/secret-exclude.txt`.
3. **Load:** write `lists/`, compare with the previous load, write a log to
   `logs/` if anything changed, and purge logs older than
   `logRetentionDays` (365).

## ESDB sizes

Size is ESDB's measure of how common a word is. A lower size means more common.
Each size includes all the smaller ones.

| Size | Meaning |
|---|---|
| 35 | Small: core words, in at least 11 of the 12 dictionaries behind 12dicts |
| 50 | Medium: in at least 5 of the 12 dictionaries |
| 60 | Spell-checker default: in at least 2 of the 12 dictionaries |
| 70 | Large: in most dictionaries |
| 80 | Valid but unusual words, as used in Scrabble |

## Hand-maintained rules (`rules/`)

One word per line; `#` starts a comment.

- `ban.txt`: rejected from **both** lists (slurs, crude words that upstream
  doesn't tag).
- `secret-exclude.txt`: a valid guess but never a secret (double meanings,
  obscure words).
- `secret-include.txt`: force onto the secret list (for example, a natural
  plural). This overrides an upstream usage note but not `ban.txt`.
- `guess-include.txt`: force onto the guess list.
- `definitions.txt`: hand-written definitions; see
  [`rules/definitions.txt`](#rulesdefinitionstxt).

The script refuses to run if these files conflict (for example, a word both
banned and included).

## Outputs

- `lists/secret.txt`, `lists/guess.txt`, `lists/banned.txt`: one word per
  line, sorted.
- `lists/candidates.tsv`: every 5-letter word ESDB has, with its status
  (`secret`, `guess`, `banned` or `rejected`), the reason it missed the next
  list up, its size, parts of speech, spellings, usage notes and source tags.
  Use it to review and tune the rules.
- `lists/manifest.json`: pinned commit and counts.
- `logs/<UTC timestamp>.md`: words added to and removed from each list since
  the previous load.

## Daily Rush themes

The Daily Rush's themes and calendar aren't here: they're every day's
answers, and this repo is public. They're kept in a private repo and loaded
into the server's database (worker/README.md "Daily Rush themes"). Loading
checks each word against `lists/secret.txt`, so after taking a word off the
secret list, change any theme to come that uses it there, and load again.

## Definitions

`definitions.py` writes `lists/definitions.json`: up to `maxPerWord` (2)
definitions for each guess word, one word per line so changes diff cleanly.

```json
"dying":[{"p":"verb","d":"pass from physical life ...","l":"die"},{"p":"adjective","d":"in or associated with ..."}],
```

`p` is the part of speech (noun, verb, adjective or adverb), `d` the
definition, and `l`, when present, the base word the definition belongs to.

- **Source:** Open English WordNet, pinned in `config.json` by release URL and
  SHA-256. A different file fails the run instead of silently changing the
  definitions. It is CC BY 4.0, so the app must credit it; see `NOTICE-OEWN`.
- **Which definition:** WordNet's first sense for each part of speech; the
  part of speech with more senses comes first.
- **Inflected words** are matched to their base word: WordNet's irregular
  forms (`geese` → goose), then regular endings (`plots` → plot, `liked` →
  like, `dying` → die, `wider` → wide). "-ed" and "-ing" words lead with the
  base verb and then their own sense, if WordNet has one.
- **Offensive senses:** a sense whose definition labels the word as a slur or
  an offensive term is dropped.
- **Coverage:** every secret word, and about 70% of guess words. The rest are
  mostly rare words WordNet doesn't list; the app shows "No definition
  available" for them.

### `rules/definitions.txt`

Hand-written entries replace the generated ones for that word. Use it for a
secret word with no definition or a misleading one.

```
among | adverb | in the middle of, or surrounded by    # one line per definition
women | = woman                                        # define through another word
xxxxx | -                                              # show no definition
```

The run fails if a word isn't on the guess list or mixes the three forms.

## Licence

ESDB's licence requires its notice to ship with the lists: see
[`NOTICE-ESDB`](NOTICE-ESDB). Avoiding Australian spellings and regions and
staying at size ≤ 80 keeps its extra AU and UKACD clauses out of scope.
