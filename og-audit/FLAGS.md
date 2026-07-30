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
| F11 | `4e4dce3` [3121] | `G` at the end of &-filtered input must still ring the bell when the file's last line is filtered OUT (#774). | ? |
| F12 | `7649e1d` [3120] | `jump_forw` must set `soft_eof` to the end of FILTERED input so `(END)` shows after `G` under a filter (#774). | ? |
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
| F32 | `43957b9` [3001] | The long prompt must reserve a column for the `&` indicator, or it wraps onto a second line (#749). | ? |
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
