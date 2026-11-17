# Human-like computer: first benchmark (experiment)

An experiment, not used by any mode yet: `src/game/humanLike.ts`, benchmarked
by `npm run benchmark-human` (`scripts/benchmark-human.ts`). Every computer
solved the same 2,000 random secret-list words (seed 1, word lists of
17 November 2026). Ratings are fitted on the ladder's scale, Expert's 0.38
recall pinned at 1500. The raw output:

```
2000 words, seed 1

computer              average  median  90th %  table  fitted rating
recall 0.38             12.20      12      17   1500    1500
recall 0.50             10.46      10      14   1602    1606
recall 0.60              9.49       9      13   1673    1680
recall 0.70              8.63       9      12   1736    1752
recall 0.80              8.02       8      11   1792    1810
recall 0.90              7.57       7      10   1839    1859
recall 1.00              7.07       7       9   1890    1920
human novice            12.51      12      16           1401
human intermediate      10.66      10      14           1579
human expert             7.08       7       8           1932

Average guesses by how many anagrams the word has on the secret list
computer                no anagrams 1-2 anagrams  3+ anagrams
(words)                        1371          558           71
recall 0.38                   12.32        11.93        12.08
recall 0.50                   10.51        10.29        10.86
recall 0.60                    9.41         9.67         9.77
recall 0.70                    8.61         8.57         9.66
recall 0.80                    7.92         8.11         9.17
recall 0.90                    7.42         7.80         8.55
recall 1.00                    6.89         7.38         8.13
human novice                  12.59        12.30        12.61
human intermediate            10.68        10.66        10.38
human expert                   7.03         7.19         7.32

Human-like computers' score against each recall computer, same word
vs                      human novice    human intermediate          human expert
recall 0.38                    46.4%                 65.0%                 91.7%
recall 0.50                    28.7%                 48.6%                 86.0%
recall 0.60                    18.1%                 36.5%                 80.7%
recall 0.70                    10.5%                 26.2%                 73.2%
recall 0.80                     7.6%                 19.7%                 65.4%
recall 0.90                     5.4%                 14.8%                 58.1%
recall 1.00                     3.4%                  9.9%                 47.9%

...and against recall 0.60 (rated 1673) by anagrams
no anagrams                    15.8%                 35.5%                 81.6%
1-2 anagrams                   21.9%                 38.1%                 79.2%
3+ anagrams                    32.4%                 44.4%                 73.9%
```

## Second run: with the CRANE, SPLIT, DOUGH opener

The same 2,000 words, each style with and without the opener
(`npm run benchmark-human -- --opener crane,split,dough`):

```
2000 words, seed 1

computer                  average  median  90th %  table  fitted rating
recall 0.38                 12.20      12      17   1500    1500
recall 0.50                 10.46      10      14   1602    1607
recall 0.60                  9.49       9      13   1673    1683
recall 0.70                  8.63       9      12   1736    1756
recall 0.80                  8.02       8      11   1792    1816
recall 0.90                  7.57       7      10   1839    1866
recall 1.00                  7.07       7       9   1890    1929
human novice                12.51      12      16           1395
human novice+open           11.23      11      14           1514
human intermediate          10.62      10      14           1584
human intermediate+open      9.24       9      12           1691
human expert                 7.04       7       8           1950
human expert+open            7.35       7       9           1910

Average guesses by how many anagrams the word has on the secret list
computer                    no anagrams 1-2 anagrams  3+ anagrams
(words)                            1371          558           71
recall 0.38                       12.32        11.93        12.08
recall 0.50                       10.51        10.29        10.86
recall 0.60                        9.41         9.67         9.77
recall 0.70                        8.61         8.57         9.66
recall 0.80                        7.92         8.11         9.17
recall 0.90                        7.42         7.80         8.55
recall 1.00                        6.89         7.38         8.13
human novice                      12.59        12.30        12.61
human novice+open                 11.27        11.26        10.18
human intermediate                10.64        10.66         9.90
human intermediate+open            9.09         9.60         9.34
human expert                       6.98         7.10         7.75
human expert+open                  7.18         7.70         7.85

Human-like computers' score against each recall computer, same word
vs                      human novice     human novice+open    human intermediatehuman intermediate+open          human expert     human expert+open
recall 0.38                    46.4%                 60.0%                 65.5%                 78.0%                 91.9%                 90.8%
recall 0.50                    28.7%                 40.7%                 48.4%                 64.4%                 87.0%                 84.1%
recall 0.60                    18.1%                 29.9%                 37.5%                 52.4%                 80.8%                 76.9%
recall 0.70                    10.5%                 20.4%                 27.3%                 40.2%                 74.1%                 68.9%
recall 0.80                     7.6%                 14.4%                 20.7%                 31.8%                 66.1%                 60.2%
recall 0.90                     5.4%                 11.2%                 14.7%                 24.7%                 58.7%                 52.6%
recall 1.00                     3.4%                  7.5%                 10.6%                 17.4%                 48.4%                 42.6%

...and against recall 0.60 (rated 1673) by anagrams
no anagrams                    15.8%                 29.0%                 36.5%                 53.7%                 81.7%                 78.4%
1-2 anagrams                   21.9%                 30.6%                 39.3%                 49.8%                 80.0%                 74.3%
3+ anagrams                    32.4%                 42.3%                 41.5%                 47.2%                 69.0%                 66.9%
```
