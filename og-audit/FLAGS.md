# Triage flags — things a commit message says that I cannot confirm we do

Built by reading FULL commit messages (bodies, not subjects) of the 454
core-touching commits that have one, newest first. A flag means "unclear to
me", not "broken" — each needs a dig. Resolved flags move to a verdict in
`LEDGER.md`.

Status: `?` unresolved · `OK` verified match · `FIX` diverged and fixed · `GAP` diverged, open

## From commits 3100-3201 (v706..HEAD era)

| # | commit | what the message claims | status |
|---|---|---|---|
| F01 | `9241325` [3194] | In a COMMAND table (unlike an env table), if a command is a prefix of a LATER command, the later longer one must win — the user deliberately overrode it. Chain: `fd09752` → `8f951a3` → reverted `df70e7a` → this. | ? |
| F02 | `df53ea6` [3187] | `getchr()` must treat `iread()` returning 0 (tty EOF) as fatal and `quit(QUIT_ERROR)`, else it busy-loops forever. Note [3186] reverts an earlier attempt at this. | ? |
| F03 | `7c85230` [3184] | Failure EXIT STATUS in three cases: missing filename when stdin is a tty; missing option argument (`less -b`); no input file openable in non-interactive mode. | **OK** ran both binaries: `-b` -> 1/1, unopenable file -> 1/1. Third case (no filename, stdin a tty) not exercised. |
| F04 | `81ba76f` [3182] | `POSIXLY_CORRECT` must be read with `getenv`, NOT `lgetenv` — it is true if set to ANY value including the empty string. | **OK** `cli.ts:90` uses `actualEnv(...) !== undefined` (raw env, empty counts). |
| F05 | `9f2e50f` [3157] | `#` and `%` expansion in `:e` and `!` must be SHELL-ESCAPED (#784). | ? |
| F06 | `254fefb` [3153] | An unterminated OSC sequence must have the ENTIRE sequence removed, not be closed with a synthesised ST. | **FIX** — we passed it through RAW (older than either og behaviour), leaking the sequence and the text it swallowed. Fixed in `helpers.ts` transformLine. Verified vs og on `/tmp/osc-unterm.txt`. |
| F07 | `f65bf48` [3139] | Color descriptors loosened: color part may be omitted entirely (`-DNd`, not just `-DN-d`), and a dot with empty background is allowed (`-DN43.`). | **OK** `-DNd`, `-DN-d`, `-DN43.`, `-DN43.5` all accepted by both. |
| F08 | `b2ae157` [3136] | After the end of OSC 8 link text, the last escape sequence must be re-sent (matters when `-DO` gives links a real color). | ? |
| F09 | `604a1f0` [3133] | OSC 8 underlining is ORTHOGONAL to coloring: it must not set `in_hilite` and must not resend escapes at its end (search hilite must). Also: OSC 8 sequences must not be saved as resendable. | ? |
| F10 | `c654d98` [3132] | Emit the null OSC 8 sequence at end of line only when actually MID-LINK, not when any link appeared anywhere in the line. | **GAP** — measured: on an unterminated OSC 8, og ends the line with `ESC[m ESC]8;; ESC\\` (attr reset + null OSC 8 closing the link); we emit neither. So we never close an open link at EOL. Needs `in_osc8_link` state in the transform. |
| F11 | `4e4dce3` [3121] | `G` at the end of &-filtered input must still ring the bell when the file's last line is filtered OUT (#774). | **FIX** we never belled. og's jump_forw bells when `bot_pos == end_pos || (bot_pos == soft_eof && soft_eof != NULL_POSITION)` (jump.c:44) — the second half is the filtered end, which bottom+1 never reaches when the real last line is filtered away. Verified: og and we now bell on the same step. NOTE the condition is NOT "EOF is displayed": on a screen ending in tildes bottom+1 is NULL_POSITION and og does not bell, so the screen must be FULL too — my first attempt used mode.EOF alone and regressed the short-file case. |
| F12 | `7649e1d` [3120] | `jump_forw` must set `soft_eof` to the end of FILTERED input so `(END)` shows after `G` under a filter (#774). | **OK** the filter probe shows `(END)` from the first `G` onward in both. |
| F13 | `bbc23b6` [3112] | OSC 8 mouse click on a link that wraps across screen lines must search from the start of the FILE line, not the screen line (#775). | ? |
| F14 | `96c8eb9` [3110] | `LESS_OSC8_OPEN_ANY` (one handler) replaces `LESS_OSC8_OPEN_file`/`_man`. | **OK** `osc8.ts:162` falls back to `LESS_OSC8_OPEN_ANY`. |
| F15 | `3e11cb4` [3109] | Do NOT prompt-expand `LESS_OSC8_OPEN_xxx`; just append the shell-escaped URI. | **OK** `osc8.ts:175` builds `${handler} ${shellQuote(uri)}` and nothing else. |
| F16 | `c082728` [3108] | OSC 8 scheme is LOWERCASED to find the handler var; a URI with no colon uses `LESS_OSC8_OPEN_NONE`. | **OK** `osc8.ts:159` `colon < 0 ? 'NONE' : uri.slice(0,colon).toLowerCase()`. |
| F17 | `d5122e3` [3183] | `J`, `K` and `Y` must appear on the help screen (#796). | **OK** `startup/lessHelp.ts:25-26` matches `less/less.hlp:16-17` verbatim. |

### Adjudicated in this batch without a flag
`9af2a4f` getenv-lifetime cache (C memory semantics, N/A) · `b097e6d` remove
lesskey program (N/A) · `f168cf1`/`ba58a22`/`b9974c8`/`102e2a2`/`fe404e9`/
`4d4583c` Windows/OS-2 only (N/A) · `1cb75ca` signedness (N/A) ·
`8f951a3`+`fd09752` superseded by `9241325` (folded into F01) ·
`9797e2f`+`2f29d36` OSC 8 underline/-DO — we have `O: 'osc8'` and
`UNDERLINE_ON+INVERSE_ON` on selection, provisionally MATCH, confirmed via F08-F10.

## From commits 3015-3099 (v705..v706 era)

| # | commit | what the message claims | status |
|---|---|---|---|
| F18 | `32c1a2a` [3097] | Don't call `get_term()` when stdout is not a tty (cat mode); and don't try to save the position on close, which crashes if the position table was never built. | ? |
| F19 | `06ef944` [3078] | Unassigned special keys must do NOTHING (NOACTION), not beep or leak escape sequences into the command line: ctrl/shift UP+DOWN, DELETE, ctrl/shift DELETE, INSERT, BACKSPACE, ctrl-BACKSPACE, BACKTAB. | ? |
| F20 | `f959db9` [3077] | A malformed binary lesskey whose last entry claims a length past the end of the table must not be over-read. | ? |
| F21 | `b5cdbec` [3076] | shift/ctrl UP+DOWN and shift-DELETE must be mappable; ctrl-DELETE also on terminfo systems, not just Windows. | **OK** `lesskey.ts` has `^d`/`^u` (ctrl down/up), `+d`/`+u` (shift down/up), `+x` (shift-DELETE) and `^x` (ctrl-DELETE). |
| F22 | `4c7fc82` [3075] | lesskey gains `\k^x` (control) and `\k+x` (shifted) alternate forms. | **OK** both families present: `^b ^d ^e ^h ^l ^r ^u ^x` and `+d +e +h +l +r +u +x`. (An earlier grep called this MISSING — the table keys carry no `\k` prefix. Third bad grep today; verify by reading the table, not by pattern.) |
| F23 | `1ff22c5` [3054] | `\kpe` maps keypad ENTER, and mapping it DISABLES the low-level conversion to newline. Also adds `noaction` as a line-edit action. | ? |
| F24 | `429ed1f` [3050] | If a prompt_message wraps, the screen is trashed and must be repainted — make_display runs BEFORE prompt_message, so call it again. | ? |
| F25 | `d377035`+`752dc96` [3045-46] | With `LESS_LINES` < real height, jump_loc must FULLY repaint rather than scroll, and the compensating lclear in make_display comes out. | ? |
| F26 | `7f5bb27` [3042] | Reverts `8f107024`: `+` commands must NOT all be deferred until after the first paint (it broke `&` filters); fixed a different way. | ? |
| F27 | `930053c` [3026] | `?O` prompt conditional: true when an OSC 8 link is selected. | **FIX** we hardcoded `false` with a stale "OSC 8 links are not supported" comment. Now `selectedOsc8() !== null`; verified vs og with `-P'?OSELECTED:none.'` — both print `none` then `SELECTED` after `^O^N`. |
| F28 | `53e13d3` [3025] | Opening an OSC 8 link must NOT clear the selection: lsystem → reedit_ifile → undo_osc8 wipes it, so save and restore around the call. | ? |
| F29 | `e0d51f0` [3024] | `%O` expands to the shell-escaped URI of the selected link. | **N/A — SUPERSEDED** by `3e11cb4`, which deletes `case 'O'` from protochar when handlers stopped being prompt-expanded. `%O` does NOT exist at HEAD; not having it is correct. |
| F30 | `e5e52da` [3020] | The numeric argument to `m` and `M` changed meaning: it is now the FILE line number, not the screen line number (#736). | **OK** `jumping.ts:702-725` resolves `lineNum` through `linePosition()` and sets `row: lineNum - 1`, with og's "Cannot find line number N" error when it does not resolve. |

## From commits 2951-3014 (v704..v705 era)

| # | commit | what the message claims | status |
|---|---|---|---|
| F31 | `2f65ad0` [3002] | Changing `-i` while `&` filtering must not start highlighting every match of the FILTER pattern (#750). | ? |
| F32 | `43957b9` [3001] | The long prompt must reserve a column for the `&` indicator, or it wraps onto a second line (#749). | **OK** probed `-M` with an `&` filter and a 68-character filename at width 80, so the long prompt sits right at the edge: identical to og. |
| F33 | `033c1f2`+`1f282c3`+`e34a2f4`+`2a1d0f6`+`e650b25` [2963-2993] | `--hilite-target` and its refinements: no highlight while squished; a spurious space carries it on an empty line; underline by default and in BOTH color modes; `-DJ` may drop the underline; with `-N` do not highlight the line-number field. | **PARTIAL** the option exists (`options/hilite-target.ts`, `helpers.ts:273-310`); the five refinements above are each unverified. |
| F34 | `2dabc11` [2992] | `--status-line` highlighting extends to the RIGHT COLUMN, not one char short. | ? |
| F35 | `d6204d4` [2989] | OSC 8 opener: `-` prefix suppresses echoing the command, `^P` prefix suppresses the "link done" message. | **OK** ours matches og twice over: `handler === '-'` falls back to `_ANY` exactly like `strcmp(handler,"-")==0` (search.c:1964), `\x10` sets `done = null` like `CONTROL('P')` (search.c:1973), and the "No handler for ... link type" text agrees. |
| F36 | `a470d32` [2986] | `ESC-m` clrmark must clear the FILE mark table too, or `--save-marks` writes the cleared mark back to the history file. | ? |
| F37 | `3f07484` [2985] | `restore_marks()` must NOT clip the mark line to screen size — it runs before `sc_height` is known; `gomark`/`jump_loc` clip later. | ? |
| F38 | `640adf1` [2982] | Forced BACKWARD scrolling stops when the first file line reaches the screen BOTTOM, mirroring forced forward stopping at the top. | **OK** probed `G` then 45×`K` on both a plain 40-line file and a 6-line wrapped one: identical to og. |
| F39 | `feb6a00` [2976] | No unintentional file wrap when force-scrolling with `-c`. | **FIX (adjacent)** probing this family found a real bug of our own: `--past-eof` never reached the stream engine's FORWARD path. og's `forward()` opens `if (past_eof) force = TRUE` (forwback.c:479); ours consulted the option only in `backwardFrom`, so a forward move still stopped at the last screenful. Measured: at step 18 of 40 `j`s og sits on line-018 and we sat on line-017. Fixed in `fileInput.forward`; the `-c` wrap claim itself is still unverified. |
| F40 | `1a5f5e6` [2975] | Forced forward scrolling must stop when the LAST file line reaches the TOP; the old check was wrong. | **OK** probed 45×`J` on plain and wrapped files: identical to og. Note og's test counts SCREEN rows (`empty_lines(3, sc_height-1)` with rows 0-2 non-empty), which the wrapped probe exercises. |
| F41 | `778e1515` [2973] | `pos_rehead()` takes a flag: adjusting `hshift` is WRONG when the rehead is caused by a horizontal shift, or the shift jumps unexpectedly. | **OK** we already split it the way og did: `jumping.ts:345 posRehead()` does NOT touch the shift (= `pos_rehead(FALSE)`, used by LSHIFT/RSHIFT/LLSHIFT/RRSHIFT and the wheel), while `-S` does the hshift adjustment inline in `options/chop-long-lines.ts` (= `pos_rehead(TRUE)`, og's only such caller, optfunc.c:340). |
| F42 | `a8b1c3b` [2971] → `778e1515` | Horizontal DRAG: og calls `pos_rehead(FALSE)` before adjusting hshift (decode.c:666). (The `chopline = TRUE` hack this commit added was REMOVED by 778e1515 once the flag existed — do not port the hack.) | **FIX (UNMEASURED)** our HDRAG branch adjusted `config.col` without re-heading; added `posRehead()`. Transcription of og's call sequence, **not verified against the binary**: the pty harness delivers keys one byte per step, so a mouse sequence is echoed as typed text and never becomes a mouse event. Needs a harness that writes a byte GROUP in one go before this can be called OK. |
| F43 | `82d1141` [2961] | `less -fM .` (a directory) must not print `lines 1--1/?`: a position of 0 was entered in the table though no line was displayed. | ? |
| F44 | `23f8672` [2952] | A tags-file line number of 0 is INVALID and the tag is skipped, not dereferenced as a pattern (segfault). | **OK** `tags.ts:206` `if (!linenum) continue;` is og's `if (n == 0) continue;`. |
| F45 | `6c4a43b` [2951] | Read-error messages are DEFERRED to the next prompt instead of rate-limited by a 4s timer; also fixes the `&` prefix vanishing when such a message shows. | ? |

### Adjudicated without a flag
`3225c2a` cmd_exec before ESC-u/ESC-U/m/ESC-m (folds into F26's `+`-option
family) · `d32b563`/`7fc61d9`/`2f228d3`/`f98933b` C portability, N/A ·
`3008` last-cell-of-last-line avoidance — we never address that cell ·
`3007` `--end-prompt` present · `2968` `--emouse` present · `2958` cmd.h
constant numbering, N/A · `2970`/`2969` cursor-addressing and padding
details of --hilite-target, folded into F33.

## From commits 2908-2949 (v703..v704 era)

| # | commit | what the message claims | status |
|---|---|---|---|
| F46 | `e60346e` [2940] | **Revises `bc798f8`.** Removing forw()'s per-line EOF stop was a REGRESSION: forward()'s test runs once at the start, forw()'s runs per line, so both are needed. Later replaced again by the 3-row test in `1a5f5e6`/`640adf1`. | **OK, with a correction to our own history.** HEAD's forw() is the 3-row form (forwback.c:318-325). Our `1c61681` commit message cites `bc798f8` as if final — the FIX is sound because it was measured against the binary, but the citation is incomplete. Probed `e60346e`'s exact scenario (short file with tildes at bottom, then ESC-SPACE; also `G`+ESC-SPACE and ESC-b): all identical to og. |
| F47 | `2937` `2a9cbf2` | The `|` command pipes just ONE line when the marked line is at the top of the screen, instead of the whole screen. | ? |
| F48 | `2930` `2c112b7` | `-w`/`-W` must highlight the new line after BACKWARD movement too, not only forward (#729). | ? |
| F49 | `2942` `28e950f` | `getmark('$')` must place the BEGINNING of the last line on the second-to-bottom row, not the file's end position on the bottom row — otherwise an extra tilde appears (#720). | ? |
| F50 | `2917` `e1fdd8c` | Errors while opening the input must go to STDERR when stdout is redirected (`less fifo >out` must not write the message into `out`). | **FIX** two bugs. (1) A file whose stat succeeds but whose OPEN fails (mode 000) escaped as node's raw `Error: EACCES: permission denied, open 'x'` from the top-level handler, abandoning the rest of the list; og reports `errno_message()` = `"name: strerror"` and moves on. (2) The stream is positional: og moves `set_output(1, TRUE)` to AFTER `edit_first()` succeeds, so errors before the first successful open go to STDERR and later ones go to STDOUT. Verified against the binary in all four orderings (`noperm`, `noperm good1`, `good1 noperm`, `good1 noperm good2`) — text, stream, ordering and exit code all match. |
| F51 | `2915`+`2916` | Skip the binary-file check when output is not a tty, but STILL call bin_file so `nread` is set, or `less /proc/x > o` yields an empty file. | **OK** catted a binary file with stdout redirected: identical bytes to og, no prompt, rc=0. The `/proc` half is Linux-only and untestable here, but our cat path streams to EOF and never consults the stat size, so it cannot hit that failure. Note og's fix is a one-token reorder — `bin_file(f,&nread) && is_tty` — so bin_file always runs for its side effect. |
| F52 | `2912` `fe4fb0c` | HOME acts like `g`, END like `G`; shift-arrows act like ctrl-arrows; lesskey gains `\kE \kF \kH \kI \kM \kS`; lesskey gains the missing commands `forw-bell-hilite`, `goto-pos`, `osc8-jump`. | **PARTIAL** the `\kE/\kF/\kH/\kI/\kM/\kS` escapes are all in our table; the three lesskey COMMAND names and the HOME/END/shift-arrow bindings are unverified. |
| F53 | `2911` `155bec4` | `scrsize()` falls back to fd 1 when the `TIOCGWINSZ` ioctl on fd 2 fails (#711). | ? |
| F54 | `2928` `543eb06` | `-DT` formats tilde lines. | **OK** `color.ts:36` maps `T: 'tilde'`; og's `optfunc.c:669` `case 'T': return AT_COLOR_TILDE`. |
| F55 | `2938` `b8f9444` | `--use-backslash` status messages were REVERSED (#735). | **OK** ours reads "Don't use backslash escaping..." then "Use backslash escaping...", matching og opttbl.c:551-552 in that order. |

### Adjudicated without a flag
`2949` read errors treated as EOF (pairs with F45) · `2947`/`2946`/`2945`/
`2944`/`2943` V8 regexp.c internals — N/A, we use V8's own engine ·
`2941` lessecho install path, N/A · `2939` numeric arg on m/M = F30, OK ·
`2935` C portability, N/A · `2931` "Pattern not found" shows the pattern —
ours does (`Pattern not found: ${pattern}`) · `2927`/`2926`/`2925` Windows SGR
message noise and attrmode, N/A · `2924`/`2923`/`2921`/`2918` command-parser
rewrites and lesskey overrun hardening — fold into F01/F20 · `2922` bc798f8,
superseded by F46 · `2908` lesstest locale, N/A.

## From commits 2841-2907 (v702..v703 era)

| # | commit | what the message claims | status |
|---|---|---|---|
| F56 | `038ccd9` [2907] | `bin_file` must stop its binary check 4 bytes before the end of its 256-byte buffer, or a truncated UTF-8 sequence reads as malformed. | **OK** built a file with a 4-byte U+1F600 at offset 253 so its tail crosses byte 256: og and we agree, neither treats it as binary. |
| F57 | `18db5ae` [2905] | An EMPTY terminfo capability is treated as undefined (#710). | ? |
| F58 | `3eb4d40` [2902] | `-z` may take a NEGATIVE value; the blanket ban on negative numeric options was wrong, hence `O_NEGOK`. | **OK** `-z-3` and `-z3` both accepted, matching og. |
| F59 | `e65b895` [2900] | Clear `ICRNL`/`INLCR` so a lesskey file can give CR and NL different meanings (#703). | ? |
| F60 | `2db32ef` [2854] | Only `^C`/`^X` may interrupt "Waiting for data" — allowing ANY key meant type-ahead cancelled operations. This REVERTS `23ff6a42`. | ? |
| F61 | `d70ac51` [2848] | Option errors name the option with its `--` prefix: `There is no --xxx option`, `The --xxx option should not be followed by =`. | **FIX** we BUILT both messages correctly and never printed them when catting — `printStartupError` wrote unconditionally to stdout while og's `error()` uses the current output fd, which is stderr until `set_output(1)`. Verified all four cases against the binary. |
| F62 | `0c707c9` [2846] | Incremental search must not jump back to the start when that position is NULL_POSITION (a `--pattern` search before the screen exists). | ? |
| F63 | `513a436` [2844] | `SIGINT` must be able to interrupt the FIRST read from a pipe, by making the handler call `have_read_data()`. | ? |

### Adjudicated without a flag
`2901` lesstest lesskey isolation, N/A · `2889`/`2868`/`2867`/`2864` C
type/build cleanups, N/A · `2878`/`2877`/`2876`/`2872`/`2849` Windows console
resizing and non-tty output, N/A · `2851` term_init_ever crash in --version,
C-specific · `2847`/`2845`/`2841` the deferred-terminal-init experiment, which
og REVERTED in 2845 — do not port.

## Found while probing, not from a commit message

| # | evidence | what differs | status |
|---|---|---|---|
| F64 (searched: NO og commit explains this — it is original design, not a missed fix, which confirms it belongs to the linebuf model rather than the audit) | dump of `/tmp/bin1.dat` under `-R` | **Attribute runs are per-character, not per-run.** og emits `ESC[7m ^@^A^B ESC[27m` and `ESC[7m <FF><FE> ESC[27m` — one standout run spanning adjacent same-attribute chars, because put_line/at_switch write a transition only when the attribute CHANGES. We emit `ESC[7m<FF>ESC[m ESC[7m<FE>ESC[m`, one wrap per character, because the transform wraps each representation independently in `colored('ctrl'/'bin', ...)`. | **GAP (cosmetic today)** the emulated screens are IDENTICAL — the pty differ is silent — so nothing is visibly wrong; this is byte-level output parity only. SAME ROOT CAUSE as the reverted representation-clustering work: og keeps attributes in the parallel `linebuf.attr` and emits transitions, we splice escape pairs into the text. Fix it with the linebuf reform, not separately. Note `coalesceOwnRuns` in helpers.ts already does exactly this merging for OVERSTRIKE runs, so the precedent and the shape of the fix exist. |

| F65 | measured, `short5.txt` + `G` | **`G` on a file SHORTER than the screen must move the content to the BOTTOM.** og's jump_forw ends in `jump_loc(pos, sc_height-1)`, placing the last line on the bottom screen line; there are not enough lines above, so the top rows become null lines and og draws `~`. We leave the content at the top with blank rows and never move. Visible in the pty differ (`og|~` vs `us|` on rows 0-1) and it is also why og's second `G` bells there and ours does not — after the move bottom+1 == end_pos. | **FIXED** — and my first root-cause call was WRONG. It is not the near-target `onscreen()` branch. The mechanism is further down `jump_loc`: it walks back `sindex` lines to place the last one at the bottom, and when `back_line` hits BOF first it BREAKS and passes the shortfall to `forw()` as its **nblank** argument — "rely on forw() below to draw the required number of blank lines at the top of the screen" (jump.c). So a short file ends up at the BOTTOM under tildes. Our `gotoEnd` clamped at BOF and left it at the top. Fixed by setting `padTop` to the shortfall. Exposed a second, latent bug in the process: `forward()` consumed a pad row before testing for EOF, while og's `forward()` asks `position(BOTTOM_PLUS_ONE)` and bells FIRST (forwback.c:481) — fixed too. Seven probes verified (GGG, G j b G, G j j b b, forced G J J, plus lines40/wrapped6/filtered). **Sweep seeds 1/2/3 are still open and still belong to the near-target branch** — that part of the earlier note stands. |

## Sweep seed status after 7d76144 (five of six remain)

| seed | step | key | reading |
|---|---|---|---|
| 1 | — | — | **FIXED** by the near-target `g` branch (`7d76144`). |
| 2 | 16 | RETURN | the `-r` toggle itself. Removing every `-r` from the sequence pushes the divergence from step 16 to 43, so this seed belongs to the `-r`/linebuf family. |
| 3 | 55 | RETURN | **step 14 FIXED.** Bisected to a 3-key minimum: RESIZE, `G`, RESIZE. Only the PROMPT differed — og `(END)`, us `:` — with every content row identical. Cause: `calculateEOF` decides `mode.EOF` from whether the CONTENT ARRAY fits one screen, but for a source engine that array is a multi-screen materialized window, so it always answers "no" and wiped the `mode.EOF` the engine's `sync()` had just derived from the file. og cannot have this bug: `eof_displayed` reads `position(BOTTOM_PLUS_ONE)` off its one table (forwback.c:95), so a resize that does not move the top cannot change the answer. Now diverges much later, at step 55. |
| 4 | 15 | RETURN | **CHARACTERISED, not fixed.** Minimal repro found by bisection: `j, RESIZE, k, /e⏎` (6 keys, down from 14). Both the RESIZE and the `k` are required — `f` in place of `k` is clean, and dropping either the leading `j` or the RESIZE is clean. Symptom: after the search og's row 0 runs `[014]..[027]` (a full 70-column row) and ours stops at `[014][015]` — exactly `[70,80)`, which is the SEAM extent the preceding `k` created (old top was char 80 at width 80; after the resize `k` lands on 70). So the seam entry survives the search in our render and og's does not. TWO HYPOTHESES TESTED AND BOTH WRONG: (1) clearing the table before `landMatch` repaints instead of after — no change; (2) forcing a full repaint on the landing — no change, which also rules out a redraw/prevRows artifact and proves the row is computed short. The stale extent therefore is not coming from `config.screen` via the paths I checked. INSTRUMENTED (the guessing stopped): `buildScreen` receives `config.screen = [{row:0, offset:70, end:80}]` on every frame from the `k` onward — the seam entry is never cleared. `landMatch` is NEVER REACHED, because the search FAILS: `chunks.txt` holds only `[0000]`-style tokens and the pattern is `e`, so both pagers report "Pattern not found". **og repaints anyway** — its frame for the failing RETURN is 3821 bytes where the two keys before it were 5 and 6 — and that repaint is `jump_loc(position(TOP), 1)`, which pos_clears and regenerates every row whole. We emit nothing and keep the seam.
THIRD ATTEMPT ALSO FAILED: clearing the table + re-syncing on the not-found path moved the divergence from row 0 to row 1 instead of removing it, and left every seed unchanged, so it was reverted too. Reading: replicating og here is not just "drop the seam" — og's repaint re-derives the whole screen from table[TOP] through a path we do not have an equivalent of on a non-moving search. **ANSWERED by `repaint_hilite` (search.c).** Two facts about og's table that we do not implement:
(1) **og's table stores STARTS ONLY** — the redraw loop is `forw_line(position(sindex)); goto_line(sindex); clear_eol(); put_line(FALSE)` with NO end bound, so a row's extent is recomputed every draw. A row `back_line` cut short at a seam is short only in the frame that drew it. Our `ScreenRow` carries its own `end` and keeps it forever.
(2) **og persists ALL sc_height entries.** We persist only the SEAM rows and let `buildScreen` regenerate everything below from the last entry's end.
Together they explain the measurement exactly: og redraws its STALE starts (70, 80, 150 — the 80 dates from the old width) at the new full width, so its rows genuinely OVERLAP, row0 = 70..140 AND row1 = 80..150. We have one seam entry, so row0 redraws to 70..140 and row1 continues at 140.
FOUR attempts, all reverted: clear before `landMatch`; force a full repaint; clear on the not-found path; recompute extents while keeping starts. The last is the informative one — it fixed row 0 and left row 1 wrong, which says the missing piece is the other 22 entries, not the extents.
So seed 4 is not a call-site bug: it is the position table half-adopted. Fix = every row's start persisted for the life of the screen with extents derived at paint, done alongside jump_loc's near-target branch. |
| 5 | 15 | `g` | NOT a near-target miss. The keys before it are `...2d,72,0a` — `-r` is ON, so the whole 11001-byte line is ONE screen row (`fits_on_screen` returns TRUE unconditionally, line.c:842). og ends with a screen of tildes, we show content. Same `-r` family as the styled gate's r-toggle/r-resize, i.e. the linebuf model, not the jump. |
| 7 | 12 | `u` | under `-r` (toggled 2 keys earlier). Removing `-r` pushes it from step 12 to 24, so also the `-r`/linebuf family. |

## From commits 2783-2839 (v701..v702 era)

| # | commit | claim | status |
|---|---|---|---|
| F66 | `2800` `16879fd` | `ESC-f`: like `ESC-F` but on a match it only rings the bell, staying in F mode. | **OK** `keys.ts:287` binds `\x1Bf` -> FOLLOW_BELL; og binds `ESC,'f'` -> A_F_FOREVER_BELL. |
| F67 | `2795` `03bdeff` | `--autosave`. | **OK** `src/options/autosave.ts` exists. |
| F68 | `2832`+`2833` | New prompt sequences `%C` (right-edge column), `%W` (longest line on screen), `%Q` (percent %C/%W) and the `?Q` conditional. | **OK** all four present (`prompt.ts` cond `case 'Q'`, expansions `case 'C'`, `case 'W'`, `case 'Q'`). |
| F69 | `2817` `a1bce6a` | Long prompt and `=` show the column when shifted; `%c` becomes 1-BASED. | **OK** `case 'c': return out + (config.col + 1)` and LONG_PROTO carries `?c (column %c).`. |
| F70 | `2794` `62d87f4` | `ESC-u` must NOT clear the compiled search string — only hide/unhide the hilites. | **OK** probed `/01⏎ ESC-u ESC-u n`: identical to og, so the pattern survives the toggle and `n` still steps. |
| F71 | `2785` `57c2728` | Changing a STRING-valued option with `-` must print a confirmation, like numeric and boolean ones do. | **OK** probed `-Pfoo⏎`: identical to og. |
| F72 | `2805` `dcc567a` | Line-number attribute becomes `use_color ? AT_COLOR_LINENUM : AT_BOLD` with color string `c*`, so `-DN` can REMOVE the bold. | **OK** with `--use-color -N -DNg` both emit `ESC[32m` and NO `ESC[1m`; `-DN+g` (add bold) also agrees. (First attempt used `-DNg` without `--use-color` and both correctly errored "Set --use-color before changing colors" — the resulting diff was a swallowed keystroke, not a colour difference.) |
| F73 | `2787` `84b407f` | The `-j` ARGUMENT must be kept separate from the computed `jump_sline`, so a resize recomputes it from the original. | **OK** probed `-j.5` both orders — resize then search, and search then resize then `n`: identical to og, so the fractional argument survives and is recomputed at the new height. |
| F74 | `2793` `bb7b893` | Opening an OSC 8 link by mouse click is disallowed under SECURE. | ? (mouse — blocked on the grouped-write harness) |
| F75 | `2796` `3e88782` | `sindex_from_sline` clips to sc_height-1, never sc_height (the bottom line is the prompt). | **OK** our `jumpNear` uses `min(max(sline,1), window-1) - 1`. |

### Adjudicated without a flag
`2801`/`2803`/`2819`/`2820`/`2830`/`2831`/`2835`/`2838`/`2839` are the deferred
terminal-init experiment and its seven follow-up repairs — og REVERTED the
whole line in `2845`. Do not port. · `2804` rename, N/A · `2821` LESSNOCONFIG,
we have it · `2783` negative numeric options, see F58 · `2789` lesstest, N/A.

## From commits 2712-2782 (v700..v701 era)

| # | commit | claim | status |
|---|---|---|---|
| F76 | `2760` `db2e844` | og REMOVES replace mode and its commands — "too complicated and risky for a feature that seems to be very rarely used and has never been requested". | **OK by absence** we never had it. Our only `'overwrite'` is the `-o` log-file prompt; og's cmdbuf.c has no `replace` at HEAD either. A chronological port would have built this and then deleted it. |
| F77 | `2713`+`2722` | HOME becomes `ESC-{` (beginning of LINE), END `ESC-}`, with ctrl/shift variants. | **N/A — SUPERSEDED** by `2912` (`fe4fb0c`), which reverts HOME to `g` and END to `G`. Do not port `2713`. |
| F78 | `2912` `fe4fb0c` | HOME acts like `g`, END like `G`. | **OK against the SPEC, unverifiable here.** Our pager takes `ESC[H` to the file start, which is `g`. The binary cannot be probed for it: the harness passes no `$TERM`, so og's `setupterm` fails and it has NO special-key bindings — it read `ESC`, `[`, `H` as three keys and opened the HELP screen. Same class of limitation as the mouse sequences. |
| F79 | `2762` `02858e1` | Marks already in the history file must be written back on exit even WITHOUT `--save-marks`; the option only governs whether NEW marks are saved. | ? |
| F80 | `2746` `ceac046` | `ESC-u` with an OSC 8 highlight but no search pattern must clear the highlight, update the display, and NOT say "No previous regular expression". | **FIX** we showed og's PRE-fix message. og's `undo_search` runs `osc8_active = undo_osc8()` FIRST and gates the complaint on it: `else if (!osc8_active) error(...)` (search.c:405). Verified all three branches against the binary — link selected (quiet), pattern present (toggles), neither (still errors). |
| F81 | `2712` `342a086` | `--incsearch` returning to the start line on a non-match must restore the horizontal COLUMN too, not just the line. | **?** — probe inconclusive AND it exposed something else. With `--incsearch` on chunks.txt, two `ESC-)` shifts already diverge BEFORE any search: og's prompt reads `(END)`, ours `:`. So a horizontal shift changes og's eof_displayed and not ours (see F83); the incsearch claim itself is still untested behind it. |
| F82 | `2782` `cb0d379` | A NEGATIVE `-j` argument is normalized in calc_jump_sline, plus a check that jump_sline stays on screen. | ? |

### Adjudicated without a flag
`2775` ignaw -> defer_wrap: we already use DEFER_WRAP with og's two-meaning
`xn` reading · `2779` --form-feed must not stop while repainting · `2769`/`2771`
Lit indicator · `2766`/`2717`/`2716`/`2715`/`2756` internal/valgrind/compiler
fixes, N/A · `2732`/`2728`/`2727` man-page formatting, N/A.

| F83 | measured, `ESC-)` on a one-line file | Two `ESC-)` right-shifts and og's prompt becomes `(END)` while ours stays `:`; content rows agree. A horizontal shift changes og's `eof_displayed` answer and not ours. Same SHAPE as the resize-EOF bug fixed in `e12e089` — a second source of truth for "is the end displayed" going stale — but a different trigger, and not yet traced. | **FIXED** og's shifts all end in `screen_trashed()`, so the next make_display repaints and eof_displayed re-reads `position(BOTTOM_PLUS_ONE)` from the rebuilt table. It matters because a shift CHANGES a line's row count: `forw_line` is called with `chop_line() || hshift > 0` (input.c:348), so ANY hshift reads lines CHOPPED, one row each — og's screen after `ESC-)` on the one-line file is a single row ending in the rscroll `>` with tildes below, hence `(END)`. Our shift commands changed `config.col` and re-synced nothing; `posRehead()` early-returns when the top is already at a line start, so the source engine kept the EOF flag it had while the line was still folded. All four shift commands now resync. |

## From commits 2666-2709 (v698..v700 era)

| # | commit | claim | status |
|---|---|---|---|
| F84 | `2692` `77dddb2` | `LESS_TERMCAP_SUSPEND` / `LESS_TERMCAP_RESUME` wrap screen updates; og reads them via `ltgetstr` (screen.c:1596-99) because the sequences are in no termcap entry. | **FIX** we NAMED them in a comment and then emitted our own sync-update pair unconditionally, so the override did nothing. Now `terminalCapability(null,'SUSPEND'/'RESUME')` with our pair as the default. Verified: default emits `ESC[?2026h`, and with the vars set emits the custom strings instead. |
| F85 | `2708`+`2709` | Insert-mode toggle, and `LESS_TERMCAP_RCURSOR`/`NCURSOR` to show insert vs replace by cursor shape. | **N/A — SUPERSEDED** by `2760`, which removes replace mode outright. Do not port (see F76). |
| F86 | `2667` `ca22311` | A lesskey `invalid` action is `A_UINVALID`, a UNIQUE command distinct from `A_INVALID` — so mapping a key to `invalid` DISABLES it rather than falling through to the built-in. | ? our tables have `'invalid': null`; the fall-through semantics are unverified. |
| F87 | `2673`+`2674`+`2670`+`2671` | Unicode: emoji modifiers DELETED from output, VS15 discarding a shifted-off double-width placeholder, more chars treated as binary. | **OK** the deletion half is F93 (fixed in `4aff42a`). The VS15 half probed clean: a file mixing VS15, VS16, bare wide chars and CJK agrees with og as displayed, and agrees under a right-shift, a shift-and-back, and a one-column narrowing — the cases where og's placeholder discard applies. A width mismatch would shift every following column, so the differ would catch it. |
| F88 | `2682` `501af7b` | An abort signal must NOT set the EOF position, and `forw()` interrupted by a signal must not ring the eof bell. | ? — fifth member of the mode.EOF-ownership family. |
| F89 | `2705`+`2704` | INSERT, BACKTAB, CTL_RIGHT/LEFT arrows and F1 implemented for termcap/terminfo systems. | ? unverifiable in the harness (no `$TERM`, see F78). |

| F90 | found by sweeping for "not supported" comments | `-k` (`--lesskey-file`) was a STUB: `set: () => {}` under a comment reading "-k names the binary lesskey format, which is not supported" — untrue, since the compiled-lesskey reader already existed for the default files. og's `opt_k` is `if (lesskey(s,0)) error("Cannot use lesskey file \"%s\"")`. | **FIX** wired through a new `hook.loadLesskeyFile` (keeps the option table free of the features/lesskey import). Verified against the binary: a MISSING file gives the identical message on stderr with rc=0 and the content still catted, a VALID compiled file loads silently, and a file binding `X` to A_QUIT makes both pagers exit on `X` while both survive without `-k`. Building that test file also caught that og's section length is **radix-64 little-endian** (`gint`: `n = *p++; n += *p++ * 64`, hence `KRADIX 64`) — a big-endian guess made og reject the file while OUR parser accepted it, so our binary reader is more permissive than og's. |

## Sweep: option specs with stub implementations (not from a commit)

Prompted by `?O`, `LESS_TERMCAP_SUSPEND` and `-k` all turning out to be
features described in a comment but never wired. Six option specs carry an
empty `set: () => {}` or `get: () => ''`:

| option | verdict |
|---|---|
| `-k` `--lesskey-file` | **WAS A REAL GAP** — fixed in `f20d65e`. |
| `-o` / `-O` log-file | OK, intercepted in `index.ts` by `setStartupLogFile`. |
| `--lesskey-src` | OK, intercepted (`opt_ks`). |
| `--lesskey-content` | OK, intercepted, `parseLesskeyContent`. |
| `-p` `--pattern` | **OK, verified by running** — `-p line-020` puts line-020 at the top in BOTH, so it is handled outside the spec like og's `opt_p` ungetting `/pattern⏎`. |
| `-t` `--tag` | handled by `features/tags.ts` (the Gap C work); not re-probed here. |

Hit rate one in six, from a two-minute grep. Worth repeating whenever a stale
comment turns up: the pattern is a spec that PARSES an option and drops it.

## From commits 2629-2665 (v697..v698 era)

| # | commit | claim | status |
|---|---|---|---|
| F93 | `2657` `023bc64` + `2673` `4ad1ce1` | U+00AD (SOFT HYPHEN) and U+200D (ZWJ) are treated as binary so they are NEVER sent to the terminal — "terminals do not display these characters consistently, so the screen content cannot be known after printing them". `2673` then switches emoji modifiers from hex display to outright DELETION as "visually nicer". | **FIXED.** og prints `A👨👩👧B softhyphen`; we print `A👨\u200d👩\u200d👧B soft\xadhyphen`. On a real terminal og shows three separate glyphs where we show one joined family emoji. **Our `tests/graphemes.test.ts` asserts the OPPOSITE** ("ZWJ emoji sequences survive wrap/chop boundaries intact"), so that test encodes a behaviour og deliberately rejects — fixing this means changing the test too. Note the pty differ UNDER-detects it: the emulator collapses the zero-width chars, so the row text matched and only the byte stream differed. Implemented og's omit table (`omit.uni`: U+00AD, U+200D, U+FE00-FE0F, U+1F3FB-1F3FF, U+1F9B0-1F9B3, U+E0100-E01EF) as `charset.ts omitChar()`, dropped in transformLine except under `-U` (og's BS_CONTROL branch, line.c:1373) where they show as `<U+XXXX>` in standout. Verified both modes against the binary. TWO gotchas: (a) `CONTROL_REGEX` gates whether a line is transformed AT ALL, and the omit set is \p{Cf}/\p{Sk} which it did not cover, so the first attempt changed nothing; (b) those code points cannot go in a character class — eslint's no-misleading-character-class rejects a lone ZWJ/variation selector — so the gate alternates them instead. `tests/graphemes.test.ts` still passes: it asserts clusters are not SPLIT at a wrap boundary, which is orthogonal to deleting the joiner. |
| F94 | `2665` `3979f5c` | `--cmd`: like `+` but NOT executed if we exit before the first prompt (short input with -E/-F). | ? |
| F95 | `2653` `7428955` | With `--incsearch`, every per-character search must start from the position where the search command was FIRST invoked, not the current one, or matches are missed. | ? (pairs with F81) |
| F96 | `2633` `e66db83` | `^S` sub-search hangs if the pattern matches an empty string — the loop restarts from the same point. | **FIXED (the hang was never ours; the rule was wrong).** Probed `/ ^S 1 (x*) ⏎` on a 40-line file: neither pager hangs (og's own bug is fixed and we never had that loop). But og reports `Pattern not found: (x*)  (press RETURN)` and we print nothing, leaving the prompt at `:`. Content rows are identical, so neither moved — only the report differs. Traced to `testRegex`: it accepted a group that merely PARTICIPATED (`match[n] === undefined`) and judged only the FIRST match. og's `subsearch_ok` fails on `ep[i] == sp[i]` — the group must be NON-EMPTY — and `match_pattern` keeps searching AFTER each non-satisfying match, giving up when `mlen == 0` because it cannot advance (that guard is `e66db83` itself). Both rules implemented; verified the empty-group case, a `^S` group that genuinely matches, and a plain search, all against the binary. |
| F97 | `2629` `4befc21` | Software-generated aborts use `S_SWINTERRUPT`, not `S_INTERRUPT`, so they do not make less exit under `-K`. | ? (pairs with F88) |

## From commits 2588-2628 (v696..v697 era)

| # | commit | claim | status |
|---|---|---|---|
| F98 | `2588`+`2589` | A word-boundary search (`\<` gnu, `\b` pcre) can match where there is no boundary; fixed by passing the start offset to the match function. | **N/A — engine divergence, already documented.** Probed `/\bbar`: og reports `Pattern not found` because this build is `less 707x (POSIX regular expressions)`, where `\b` is not a boundary escape at all; we use V8, where it is, and we match. That is the pre-existing, deliberate regexp.c divergence in the og-read-ledger, not a new gap. The underlying hazard (a mid-line start making `\b` see the wrong preceding char) is worth a separate probe against OUR engine. |
| F99 | `2611` `3cbfbe1` | The selected OSC 8 link must be cleared when a new file is opened — `osc8_linepos` survived `edit_ifile` and highlighted a random part of the new file. | ? |
| F100 | `2599` `c1d24c0` | `^O^N`/`^O^P` must always search the CURRENTLY DISPLAYED page, rather than returning to the page of the previously selected link. | ? |
| F101 | `2620` `86b1dc0` | `jump_loc` under `&` filtering must not assume the char after a line's end starts the next DISPLAYED line. | ? — same jump_loc family as seeds 2/3. |
| F102 | `2616`+`2619` | `forw()` cannot just accept BOTTOM_PLUS_ONE under filtering, and on EOF the final `add_forw_pos` must store the position AFTER the last line, not NULL_POSITION; `forw_line` must return the SCREEN line's start, not the raw line's. | ? — directly relevant to the position-table work. |
| F103 | `2591`+`2592` | A command must interrupt the initial screen fill, and with `-F` may interrupt `get_one_screen` after 3s / `LESS_SCREENFILL_TIME`. | ? |
