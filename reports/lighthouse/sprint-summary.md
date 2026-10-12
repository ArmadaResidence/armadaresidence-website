# Lighthouse — polish sprint, before vs after (Lighthouse 13.5, simulated throttling, this build machine)

Mobile = median of 3 runs (after1–3; the one outlier run where GTM entered the trace is included in the median); desktop = 1 run. Baseline = before any sprint work (11 Oct 2026).

| page | form | perf before → after | a11y | LCP before → after | TBT before → after | weight before → after |
|---|---|---|---|---|---|---|
| home | mobile | 61 → 97 | 91 → 96 | 3.1 s → 2.3 s | 1765 ms → 0 ms | 1275 KB → 223 KB |
| home | desktop | 75 → 100 | 96 → 96 | 0.8 s → 0.5 s | 560 ms → 0 ms | 1275 KB → 268 KB |
| branch | mobile | 43 → 91 | 88 → 97 | 8.8 s → 3.4 s | 1515 ms → 7 ms | 1683 KB → 358 KB |
| branch | desktop | 78 → 100 | 91 → 97 | 0.7 s → 0.8 s | 535 ms → 0 ms | 1683 KB → 403 KB |
| room | mobile | 46 → 99 | 93 → 92 | 5.3 s → 2.2 s | 2320 ms → 0 ms | 1274 KB → 222 KB |
| room | desktop | 80 → 100 | 96 → 96 | 0.8 s → 0.5 s | 403 ms → 0 ms | 1274 KB → 267 KB |

CLS is 0.000 on every page after the sprint (0.005–0.015 before). Best practices 77 → 100 (the third-party cookies came from the tags that now load after the trace window). Remaining accessibility finding: white text on the bronze filled buttons is 3.9:1 (brand token — decision for Ahmed: bronze-deep fill or larger button text).
