# Human-like computer: benchmarks

The human-like computer, `src/game/humanLike.ts` (the rated ladder's since Dev Plan item 19zr), benchmarked
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

## Third run: a grid of settings (1,000 words each)

`insight`, `test` (letters a staging guess may change), `leeway` and openers
with common to rare letters, each on the same 1,000 words (seed 1), in four
runs. "vs table" rates each against the recall computers at their table
ratings, so the runs compare.

```
computer                  average  median  90th %  table  fitted  vs table
intermediate:insight=0:open=crane+split+dough     9.22       9      12           1677      1675
intermediate:insight=0.25:open=crane+split+dough     9.25       9      12           1671      1669
intermediate:insight=0.5:open=crane+split+dough     9.09       9      11           1688      1684
intermediate:insight=0.75:open=crane+split+dough     9.01       9      11           1696      1692
intermediate:insight=1:open=crane+split+dough     8.95       9      11           1702      1697

computer                    no anagrams 1-2 anagrams  3+ anagrams
(words)                             684          285           31
intermediate:insight=0:open=crane+split+dough           9.08         9.56         9.26
intermediate:insight=0.25:open=crane+split+dough           9.14         9.52         9.13
intermediate:insight=0.5:open=crane+split+dough           8.92         9.42         9.68
intermediate:insight=0.75:open=crane+split+dough           8.86         9.35         9.23
intermediate:insight=1:open=crane+split+dough           8.82         9.30         8.68

vs            intermediate:insight=0:open=crane+split+doughintermediate:insight=0.25:open=crane+split+doughintermediate:insight=0.5:open=crane+split+doughintermediate:insight=0.75:open=crane+split+doughintermediate:insight=1:open=crane+split+dough

no anagrams                    55.0%                 54.4%                 57.7%                 57.8%                 58.4%
1-2 anagrams                   48.8%                 47.2%                 51.1%                 49.5%                 52.3%
3+ anagrams                    61.3%                 53.2%                 46.8%                 59.7%                 59.7%
computer                  average  median  90th %  table  fitted  vs table
intermediate:insight=0:test=3:open=crane+split+dough     8.73       9      11           1719      1721
intermediate:insight=0.25:test=3:open=crane+split+dough     8.69       9      11           1724      1725
intermediate:insight=0.5:test=3:open=crane+split+dough     8.62       8      11           1731      1732
intermediate:insight=0.75:test=3:open=crane+split+dough     8.50       8      11           1741      1741
intermediate:insight=1:test=3:open=crane+split+dough     8.40       8      10           1752      1752

computer                    no anagrams 1-2 anagrams  3+ anagrams
(words)                             684          285           31
intermediate:insight=0:test=3:open=crane+split+dough           8.55         9.19         8.45
intermediate:insight=0.25:test=3:open=crane+split+dough           8.56         8.96         9.03
intermediate:insight=0.5:test=3:open=crane+split+dough           8.41         9.07         9.16
intermediate:insight=0.75:test=3:open=crane+split+dough           8.35         8.84         8.84
intermediate:insight=1:test=3:open=crane+split+dough           8.27         8.74         8.06

vs            intermediate:insight=0:test=3:open=crane+split+doughintermediate:insight=0.25:test=3:open=crane+split+doughintermediate:insight=0.5:test=3:open=crane+split+doughintermediate:insight=0.75:test=3:open=crane+split+doughintermediate:insight=1:test=3:open=crane+split+dough

no anagrams                    62.6%                 61.6%                 64.7%                 66.2%                 65.9%
1-2 anagrams                   53.9%                 58.6%                 54.9%                 58.9%                 59.6%
3+ anagrams                    64.5%                 50.0%                 56.5%                 61.3%                 69.4%
computer                  average  median  90th %  table  fitted  vs table
intermediate:insight=0:test=5:open=crane+split+dough     8.22       8      10           1772      1772
intermediate:insight=0.5:test=5:open=crane+split+dough     8.09       8      10           1784      1784
intermediate:insight=1:test=5:open=crane+split+dough     7.96       8      10           1799      1797
intermediate:insight=1:test=5:leeway=0.75:open=crane+split+dough     8.46       8      10           1741      1745
intermediate:insight=1:test=5:leeway=0.6:open=crane+split+dough     8.89       9      11           1696      1703

computer                    no anagrams 1-2 anagrams  3+ anagrams
(words)                             684          285           31
intermediate:insight=0:test=5:open=crane+split+dough           7.96         8.75         9.16
intermediate:insight=0.5:test=5:open=crane+split+dough           7.90         8.52         8.13
intermediate:insight=1:test=5:open=crane+split+dough           7.81         8.29         8.23
intermediate:insight=1:test=5:leeway=0.75:open=crane+split+dough           8.21         8.98         9.23
intermediate:insight=1:test=5:leeway=0.6:open=crane+split+dough           8.60         9.51         9.52

vs            intermediate:insight=0:test=5:open=crane+split+doughintermediate:insight=0.5:test=5:open=crane+split+doughintermediate:insight=1:test=5:open=crane+split+doughintermediate:insight=1:test=5:leeway=0.75:open=crane+split+doughintermediate:insight=1:test=5:leeway=0.6:open=crane+split+dough

no anagrams                    72.4%                 71.3%                 74.1%                 67.4%                 60.9%
1-2 anagrams                   59.5%                 62.8%                 66.0%                 58.1%                 50.7%
3+ anagrams                    58.1%                 62.9%                 67.7%                 51.6%                 48.4%
computer                  average  median  90th %  table  fitted  vs table
intermediate:open=herds+jaunt+block     9.30       9      12           1658      1666
expert:open=herds+jaunt+block     7.38       7       9           1881      1863
intermediate:open=dance+fight+jumpy     9.43       9      12           1648      1656
expert:open=dance+fight+jumpy     7.39       7       9           1879      1861
intermediate:open=jumpy+whack+boxed     9.59      10      12           1630      1640
expert:open=jumpy+whack+boxed     7.42       7       9           1876      1859
intermediate:insight=0.5:test=3:leeway=0.75:open=crane+split+dough     9.04       9      11           1690      1694
intermediate:insight=0.5:test=3:leeway=0.6:open=crane+split+dough     9.54       9      12           1641      1649

computer                    no anagrams 1-2 anagrams  3+ anagrams
(words)                             684          285           31
intermediate:open=herds+jaunt+block           9.19         9.52         9.77
expert:open=herds+jaunt+block           7.25         7.62         8.00
intermediate:open=dance+fight+jumpy           9.15         9.92        11.03
expert:open=dance+fight+jumpy           7.21         7.69         8.52
intermediate:open=jumpy+whack+boxed           9.39         9.86        11.42
expert:open=jumpy+whack+boxed           7.26         7.69         8.48
intermediate:insight=0.5:test=3:leeway=0.75:open=crane+split+dough           8.77         9.66         9.23
intermediate:insight=0.5:test=3:leeway=0.6:open=crane+split+dough           9.23        10.27         9.90

vs            intermediate:open=herds+jaunt+blockexpert:open=herds+jaunt+blockintermediate:open=dance+fight+jumpyexpert:open=dance+fight+jumpyintermediate:open=jumpy+whack+boxedexpert:open=jumpy+whack+boxedintermediate:insight=0.5:test=3:leeway=0.75:open=crane+split+doughintermediate:insight=0.5:test=3:leeway=0.6:open=crane+split+dough

no anagrams                    54.8%                 79.3%                 53.7%                 79.8%                 49.5%                 79.1%                 59.9%                 53.9%
1-2 anagrams                   49.6%                 72.6%                 46.5%                 71.4%                 45.8%                 71.9%                 47.2%                 42.1%
3+ anagrams                    45.2%                 69.4%                 30.6%                 64.5%                 24.2%                 53.2%                 48.4%                 40.3%
```

## Fourth run: tuning the 1602, 1839 and 1890 rungs (1,000 words each)

```
intermediate:leeway=0.75:open=crane+split+dough     9.63       9      12           1646      1642
intermediate:leeway=0.65:open=crane+split+dough     9.87      10      13           1627      1625
intermediate:leeway=0.55:open=crane+split+dough    10.12      10      13           1605      1604
intermediate:leeway=0.45:open=crane+split+dough    10.41      10      13           1581      1580
(words)                             684          285           31
intermediate:leeway=0.75:open=crane+split+dough           9.34        10.33         9.71
intermediate:leeway=0.65:open=crane+split+dough           9.64        10.41         9.84
intermediate:leeway=0.55:open=crane+split+dough           9.83        10.81        10.29
intermediate:leeway=0.45:open=crane+split+dough          10.14        10.99        11.16
vs            intermediate:leeway=0.75:open=crane+split+doughintermediate:leeway=0.65:open=crane+split+doughintermediate:leeway=0.55:open=crane+split+doughintermediate:leeway=0.45:open=crane+split+dough
no anagrams                    52.1%                 46.5%                 44.2%                 41.5%
1-2 anagrams                   38.4%                 39.1%                 35.3%                 32.8%
3+ anagrams                    45.2%                 50.0%                 41.9%                 32.3%
expert:open=crane+split+dough     7.42       7       9           1854      1859
expert:leeway=0.9:open=crane+split+dough     7.58       8       9           1834      1840
expert:leeway=0.85:open=crane+split+dough     7.73       8       9           1813      1822
(words)                             684          285           31
expert:open=crane+split+dough           7.29         7.64         8.10
expert:leeway=0.9:open=crane+split+dough           7.42         7.91         8.19
expert:leeway=0.85:open=crane+split+dough           7.57         8.09         8.10
vs            expert:open=crane+split+doughexpert:leeway=0.9:open=crane+split+doughexpert:leeway=0.85:open=crane+split+dough
no anagrams                    79.2%                 77.9%                 76.3%
1-2 anagrams                   75.8%                 68.2%                 68.8%
3+ anagrams                    59.7%                 66.1%                 67.7%
expert:leeway=0.8:open=crane+split+dough     7.83       8       9           1806      1811
expert:leeway=0.75:open=crane+split+dough     8.03       8      10           1782      1789
(words)                             684          285           31
expert:leeway=0.8:open=crane+split+dough           7.64         8.20         8.65
expert:leeway=0.75:open=crane+split+dough           7.77         8.62         8.10
vs            expert:leeway=0.8:open=crane+split+doughexpert:leeway=0.75:open=crane+split+dough
no anagrams                    74.8%                 73.5%
1-2 anagrams                   66.7%                 61.1%
3+ anagrams                    66.1%                 69.4%
expert:open=crane            7.13       7       9           1882      1892
(words)                             684          285           31
expert:open=crane                  7.05         7.33         7.16
vs                 expert:open=crane
no anagrams                    81.5%
1-2 anagrams                   75.6%
3+ anagrams                    77.4%
expert:open=crane+split      7.15       7       9           1879      1889
(words)                             684          285           31
expert:open=crane+split            7.02         7.41         7.68
vs            expert:open=crane+split
no anagrams                    81.4%
1-2 anagrams                   76.7%
3+ anagrams                    79.0%
expert:leeway=1:open=crane+split+dough     7.29       7       9           1865      1874
(words)                             684          285           31
expert:leeway=1:open=crane+split+dough           7.14         7.58         7.84
vs            expert:leeway=1:open=crane+split+dough
no anagrams                    81.3%
1-2 anagrams                   75.1%
3+ anagrams                    71.0%
```

## The ladder (Dev Plan item 19zr): the seven rungs on the final code (2,000 words)

The settings in `src/game/humanLadder.ts`, after each guess's work was capped
for the server (`WORK` in `humanLike.ts`). "vs table" is the rating in
`HUMAN_LADDER`.

```
computer                  average  median  90th %  table  fitted  vs table
novice:open=crane+split+dough    11.29      11      14           1514      1503
intermediate:leeway=0.55:open=crane+split+dough     9.97      10      13           1630      1619
computer                    no anagrams 1-2 anagrams  3+ anagrams
(words)                            1371          558           71
novice:open=crane+split+dough          11.24        11.47        10.80
intermediate:leeway=0.55:open=crane+split+dough           9.72        10.56        10.27
vs            novice:open=crane+split+doughintermediate:leeway=0.55:open=crane+split+dough
no anagrams                    28.1%                 45.5%
1-2 anagrams                   27.6%                 37.1%
3+ anagrams                    37.3%                 43.7%
computer                  average  median  90th %  table  fitted  vs table
intermediate:open=crane+split+dough     9.29       9      12           1680      1672
intermediate:test=3:insight=0.5:open=crane+split+dough     8.54       8      11           1752      1742
computer                    no anagrams 1-2 anagrams  3+ anagrams
(words)                            1371          558           71
intermediate:open=crane+split+dough           9.18         9.55         9.34
intermediate:test=3:insight=0.5:open=crane+split+dough           8.42         8.80         8.82
vs            intermediate:open=crane+split+doughintermediate:test=3:insight=0.5:open=crane+split+dough
no anagrams                    53.2%                 64.0%
1-2 anagrams                   50.5%                 60.1%
3+ anagrams                    48.6%                 58.5%
computer                  average  median  90th %  table  fitted  vs table
intermediate:test=5:insight=1:open=crane+split+dough     7.99       8      10           1802      1796
computer                    no anagrams 1-2 anagrams  3+ anagrams
(words)                            1371          558           71
intermediate:test=5:insight=1:open=crane+split+dough           7.81         8.36         8.49
vs            intermediate:test=5:insight=1:open=crane+split+dough
no anagrams                    71.3%
1-2 anagrams                   65.9%
3+ anagrams                    59.9%
computer                  average  median  90th %  table  fitted  vs table
expert:leeway=0.9:open=crane+split+dough     7.52       8       9           1855      1850
expert:open=crane+split      7.18       7       9           1899      1890
computer                    no anagrams 1-2 anagrams  3+ anagrams
(words)                            1371          558           71
expert:leeway=0.9:open=crane+split+dough           7.37         7.86         7.79
expert:open=crane+split            7.07         7.37         7.73
vs            expert:leeway=0.9:open=crane+split+doughexpert:open=crane+split
no anagrams                    78.2%                 81.0%
1-2 anagrams                   74.0%                 78.6%
3+ anagrams                    69.7%                 68.3%
```
