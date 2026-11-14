# Token Radar

Build the best token launch radar — a make.fun entry for **token-radar-01**
($1,325 total, 1st $1,000, top 10 share; entries close 2026-12-14T10:00:00Z).

## What it does

`main.ts` (Node 22, standard library only) reads the sealed snapshot of every
protocol DefiLlama tracks, works out which ones still record no token and are
not a wrapped/staked/versioned product of one that trades, ranks them by what
their launch would be worth, and writes a web dashboard with a farm plan for
each one.

## The model (radar-2)

Every row is scored by one function, from the snapshot's own figures only —
no name is ever hardcoded:

```
implied = TVL x comps x growth x maturity x chains

comps    = median(market cap / TVL) of the live protocols in the
           protocol's own category, clamped to [0.05, 1.00];
           a category with fewer than 3 live peers uses the
           whole market's median
growth   = 1 + clamp(7d change, -60%, +120%) x 0.6
maturity = 0.6 + min(age, 1460 days) / 1460 x 0.4   (age unknown: 365)
chains   = 1 + 0.03 x min(chains - 1, 5)
```

The board holds **every** rankable pre-token protocol: the whole 40-slug
watchlist (the floor, never the ceiling) plus every other rankable pre-token
protocol below the floor. Live-token protocols are kept apart and shown with
the market's own values, never mixed into the ranking. A separate readiness
score (0–100, display only) blends age, growth and size.

Each farm plan has six steps — a fresh wallet, the category's one action sized
by TVL, a weekly qualifying action, a hold window sized by age, a points check
from the protocol's own page, and a farm log — each with a cost and a time.

## Layout

```
main.ts                  entrypoint: snapshot in, board + dashboard + dossier out
lib/model.ts             the model, the board builder, the farm plans
vendor/makefun-board.ts  the kit's dossier library, copied verbatim
dashboard/               index.html + app.css + app.js (static, no network)
screenshots/             1-board.png, 2-detail.png, 3-filtered.png
board.json               the ranked board (generated; also in /output)
dossier.json             the kit's dossier (generated; also in /output)
```

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Or, in the grader's container: `node main.ts` (reads `/input/snapshot.json`,
writes `/output`). The program runs twice and writes identical bytes, and it
rebuilds the dossier from the written `/output` and refuses a mismatch.

## Verify it

```sh
# the board: rows, watchlist coverage, ranks 1..N, implied values non-increasing
node -e "const b=require('./out/board.json'); console.log(b.rows.length)"
# the dashboard: open out/dashboard/index.html in a browser with no network
# screenshots: out/screenshots/ shows the board, a detail view, a filtered view
```

## Files

- `main.ts` — MIT, no dependencies
- `lib/model.ts` — MIT, no dependencies
- `vendor/makefun-board.ts` — the kit's file, as supplied
- `dashboard/` — MIT, no external assets
