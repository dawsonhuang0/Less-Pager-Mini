# lesskey — divergences from og

Found while writing the `--lesskey-help` syntax page (2026-08-17). Same
statuses as `FLAGS.md`: `?` unresolved · `OK` verified match · `FIX`
diverged and fixed · `GAP` diverged, open.

Both open items are in the same area: how a **digit that turned out to be
a prefix** is resolved. Neither is reachable without a lesskey file.

## Open

| # | status | case | og | ours |
|---|---|---|---|---|
| K01 | **GAP** | `x digit` bound, then `x x x j` | top stays 1 — the `j` is swallowed | top 2 — the `j` moves one line |
| K02 | **GAP** | `5e forw-line` bound, then `5 j` | top 2 — the `j` runs after the incomplete prefix | top 1 — the `j` is dropped |

K01: `digit` on a non-digit key does not produce a count in either pager
— `command.c:685` re-tests the character (`c >= '0' && c <= '9'`). The
divergence is only in what happens to the key that ends the number.

K02: binding a sequence that STARTS with a digit turns that digit into
`A_PREFIX`, so it stops being a count. Both pagers agree on that much;
they disagree on the key that follows an unmatched prefix.

The two look like one bug from opposite sides: og replays the trailing
key, we drop it (K02), except when we replay one og drops (K01).

## Verified matching — do not re-investigate

Every one of these was byte-compared or screen-compared against og and
came out identical.

| case | note |
|---|---|
| `#version` guards | `>= 707`, `> 600`, `= 707` all true; `< 707`, `>= 999` false. We compare 707, like og, not our npm version |
| `\40`, `\ `, `\#`, `\^`, `\\`, `\134` | every literal escape binds the right key |
| `x quit` via `--lesskey-src`, `-k` (compiled), `$LESSKEY_CONTENT` | all three channels byte-identical, including a binary built by GNU `lesskey` |
| `invalid` vs `noaction` | og rings the bell for `invalid` only; ours matches (BEL 1 vs 0) |
| trailing `# comment` after a binding | truncated at the `#`, binding still applies |
| `#foo` (unknown directive) | silently ignored by both, no error |
| `#command` header omitted | command is the default section in both |
| extra string (`x forw-line 4j`, `x noaction 5j`) | pushed back as input, same result |
| count before a bound key (`5x` with `x forw-line`) | count applies normally |
| `ZZ` two-key binding, `\e[15~` with an extra string | identical |

## Harness warning

The pty harness sends keys after `RUNPTY_DELAY` (default **0.4s**), and
node starts slower than og. At the default, our pager often misses the
keystroke entirely and runs to the 10s timeout — which looks exactly
like "the binding did not work". Several false divergences were reported
this way before it was spotted.

Use `RUNPTY_DELAY=1.5` (or `RUNPTY_STAGE=0.6` for the staged harness) and
include a known-good control in every batch.
