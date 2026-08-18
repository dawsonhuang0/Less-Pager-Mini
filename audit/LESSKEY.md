# lesskey — divergences from og

Found while writing the `--lesskey-help` syntax page (2026-08-17). Same
statuses as `FLAGS.md`: `?` unresolved · `OK` verified match · `FIX`
diverged and fixed · `GAP` diverged, open.

`K01` is a divergence we keep on purpose; everything else found here
is fixed.

## Open

| # | status | case | og | ours |
|---|---|---|---|---|
| K01 | **KEPT** | `x digit` bound, then pressing `x` | spins | the key joins the count |

og cannot leave that state. `fcmd_decode` returns `A_DIGIT`, the loop
runs `start_mca(A_DIGIT, ":")` and `goto again` with the SAME
character (`command.c:1649`); `mca_char` sees a non-digit, `editchar`
answers `A_INVALID`, and its A_DIGIT arm ends the number, clears the
mca and returns `NO_MCA` (`command.c:685`) - which drops the character
straight back into `fcmd_decode`. Nothing in that cycle reads another
key, so it repeats forever.

Measured before it was traced, it read as "the following key is
swallowed": the harness simply hit its deadline with the screen
unchanged. A hang is not a behaviour to port. Ours treats the key as
og's own A_DIGIT arm would treat a digit and moves on.

`digit` on a non-digit key produces no count either way -
`command.c:685` re-tests the character - so nothing is lost by not
spinning.

## Fixed

| # | status | case | was | now |
|---|---|---|---|---|
| K03 | **FIX** | the four mouse codes (66, 67, 78, 79) in a compiled file | rang — we had no action to map them onto | the wheel moves, like og's `A_F_MOUSE` (`command.c:1720`) |
| K04 | **FIX** | `goto-pos`, and code 51 | rang — the table said unsupported | jumps to the byte position, like og's `A_GOPOS` (`command.c:1918`) |
| K05 | **FIX** | codes 53 / 54 in a compiled file | rang, though the NAMES `next-tag`/`prev-tag` bound fine | both channels reach the tag steps |
| K06 | **FIX** | `--lesskey-help` said `debug` did nothing | og writes no `case A_DEBUG`, so it falls to `commands()`'s default and RINGS (`command.c:2517`) | the page says it rings |
| K02 | **FIX** | `5e forw-line` bound, then `5 j` | the `j` runs: cmd_decode matches the TAIL of what accumulated, so bytes that lead nowhere age out (`decode.c:943`, `cmd_match:845`) | the `j` ran, where it used to ring and be dropped |

K02 is why a digit is not always a count: binding a sequence that
STARTS with one turns that digit into a prefix. Both pagers agree on
that; they disagreed on the key that ended an incomplete one. The key
that ended it now runs on its own - the whole sequence cannot be
replayed, since that would collect the same prefix again and arrive
back here forever.

K04 was measured through the pager — but NOT with `P goto-pos`, which
proves nothing: `P` is already `A_GOPOS` in og's built-in table
(`decode.c:137`) and `GO_POS` in ours, so `300P` works with no lesskey
at all and the test passes either way. Bind it to a key that is not
already taken. With `x goto-pos`: og and ours both land on line 39 with
no bell, and ours BEFORE the fix rang once and did not jump.

The same trap is worth checking before trusting any lesskey
measurement — most action names have a default key, so binding one to
its own key measures nothing.

K03 is binary-only — `lesskey_parse.c` gives those four codes no NAME,
because they are what og's DECODER resolves a wheel report to
(`decode.c:613`), not something a user writes. Fixing it meant giving
them real actions, and that turned up a live bug with no lesskey in
sight:

> **The wheel only worked for one tick on a file.** The wheel path
> called the in-memory mover directly instead of going through the
> input's `handle`, so the first tick moved the array view while the
> file-backed view stayed put; the second tick bell'd at an `(END)`
> the file was nowhere near. Measured against og: three wheel-downs
> reach line 26 in og and line 24-then-bell in ours.
>
> og has no such split — a wheel report becomes an action and runs
> through `commands()` like any keystroke — so the fix was to do the
> same: `act('MOUSE_FORWARD')`, and let `fileInput` move the view it
> owns. `tests/moving/wheel.test.ts` covers it.

The reason it survived: the only wheel test alternated down/up/left/
right, one tick each, and its `--emouse=all` never even arrived —
`runLt` builds a `$LESS` from option args and then overwrites it with
the recording's own env when it calls `pager()`. Options belong in
`env.LESS` in that harness.

And a second one, found by the user scrolling with a count typed:

> **A report during a prompt leaked into the prompt.** og reads it
> through the LINE EDITOR: `editchar` hands the bytes to
> `x116mouse_action(skip=TRUE)`, which returns `A_NOACTION` before it
> ever looks at the button (`decode.c:818`). `cmd_char` turns that
> into `CC_OK` and the digit prompt into `MCA_MORE`, "ignore this
> char and get another one" (`command.c:690`) — the report is
> consumed and thrown away, the prompt keeps its text, nothing
> repaints. Ours scrolled anyway (dropping the count), and inside a
> search prompt typed the report's bytes INTO the pattern.
>
> Measured: with `:5` up, og swallows a wheel tick whole and still
> shows `:5` at exit. `/li` + a tick + `ne 9` searches for `line 9`
> in og; ours searched for something with `[<65;1;1M` in it.

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
