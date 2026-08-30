#!/usr/bin/env python3
"""less parity on a terminal with no capabilities at all (TERM=dumb).

The other sweeps all run on an xterm, and every bug this one exists to
catch hid there:

  - -R colour was stripped, because the dumb painter stripped every
    escape instead of letting less's empty attribute strings do it;
  - "...skipping..." printed over the FIRST screen, because a command
    line open before any paint (the "-" the startup error gate ungets)
    left a previous frame behind and made that first forw look like a
    repaint;
  - "(END)" never appeared on a pipe, because the "Press RETURN to
    continue" gate is long enough for a short pipe to finish, and the
    spool's one end event reached nobody.

A dumb terminal starts with "WARNING: terminal is not fully functional
/ Press RETURN to continue", so every case here leads with a key for
that gate -- except the ones deliberately typing INTO it.

Which is why this sweep, alone among them, measures against v707 and
not against whatever less/ currently is.

less v708's 4ad6753 moved raw_mode(TRUE) out of main() into putchr(),
where it fires on the first byte written to STDOUT. The gate writes to
stderr, so from v708 onward it runs in COOKED mode: the terminal
echoes the key, line-buffers it, and less receives nothing until
RETURN. MEASURED on 707, 708, 709 and 710x - typing "x" at that gate
pages the file on 707 and prints a bare "x" on every version since.

We do not follow that, and will not: it costs the single-keypress
dismissal for nothing anyone asked for. So every case here would be
comparing our raw-mode gate against a cooked one, and what appeared on
the wire would have been written by the tty rather than by less. 707
is the last release whose gate works, so 707 is the oracle.

The one difference that remains against 707 is ours on purpose: less
v708's 05bfd38 made A_QUIT call cmd_exec, which on a dumb terminal is
a bare CR, so every case ends one byte longer than 707. Counted as a
match and marked *, the way intrsweep marks its own.

Known failing on 2026-08-15, all pre-existing (HEAD scored 7/13):

  file -R [RET G q]        1 byte:  a doubled CR before a newline,
  pipe    [RET G q]        1 byte:  the ":" prompt's clear_bot and the
  pipe -R [RET G q]        1 byte:  next frame's opening both emit one
  file -R [RET / 5 RET q]  the prompt lands on the end of the last
                           content row instead of its own -- the only
                           one of the four the SCREEN can see

usage: dumbsweep.py [path/to/cli.js]
"""
import os, sys, tempfile, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fastpty

S = os.path.dirname(os.path.abspath(__file__))
P = os.path.dirname(S)
CLI = sys.argv[1] if len(sys.argv) > 1 else f'{P}/dist/cli.js'


def less707():
    """A v707 build, made once from less/'s own git and cached.

    Not the binary in less/, which follows whatever was last pulled.
    Built rather than committed so it is reproducible from the source
    that is already here.
    """
    work = f'{P}/less/.v707'
    binary = f'{work}/less'

    if os.path.exists(binary):
        return binary

    import subprocess

    def sh(cmd, cwd):
        return subprocess.run(cmd, cwd=cwd, shell=True,
                              stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL)

    if not os.path.exists(work):
        sh(f'git worktree add -q --detach {work} v707', f'{P}/less')

    if not os.path.exists(work):
        sys.exit('dumbsweep needs a v707 build; git worktree failed')

    # configure is generated, so it is not in the tag - take the one
    # next to the source we already have
    for gen in ('configure', 'defines.h.in'):
        if not os.path.exists(f'{work}/{gen}'):
            sh(f'cp {P}/less/{gen} {work}/', P)

    sh('./configure --quiet', work)

    # three generated files the tag does not carry, each with a rule
    # in Makefile.aut rather than in the configured Makefile
    sh("sed -e '/^ *#/d' -e '/^ *$/d'"
       " -e 's/^ *\\([^ ]*\\)  *\\(.*\\)/M(\\1,\"\\2\")/'"
       ' lessmsg lessmsg_int > lessmsg.inc', work)
    sh('grep -h "^public [^;]*$" *.c | sed "s/$/;/" > funcs.h', work)
    sh('perl mkhelp.pl < less.hlp > help.c', work)
    sh('make', work)

    if not os.path.exists(binary):
        sys.exit(f'dumbsweep could not build v707 in {work}')

    return binary


OG = less707()

env = dict(TERM='dumb', LESS='', LESSNOCONFIG='', LESSOPEN='',
           LESSCLOSE='', LESSHISTFILE='/dev/null', LC_ALL='en_US.UTF-8')

# QUIET has to outlast the pager's own settle timers (PROMPT_SETTLE_MS
# 150, EDGE_DWELL_MS 120), or the sweep compares a half-drawn screen
QUIET = float(os.environ.get('QUIET', '0.30'))

# colour, wide characters and a line past the screen edge: what -R has
# to carry through to a terminal that cannot draw an attribute itself
COLOUR = ''.join(
    f'{n} \033[3{n % 7 + 1}mcoloured line {n}\033[0m tail\n' if n % 3 else
    f'{n} plain line {n}\n' if n % 5 else
    f'{n} \033[1m{"wide " * 30}\033[0m\n'
    for n in range(1, 61))


def run(shell, groups):
    keys = [bytes.fromhex(g).decode('latin-1')
            for g in groups.split(',') if g]
    return fastpty.run(['/bin/sh', '-c', shell], keys, 24, 100, env, cwd=S,
                       quiet=QUIET, first=2.5, step=2.5, dead=40)


# (keys as staged hex groups, label, options, piped?)
RET = '0d'
CASES = [
    (f'{RET},71',          'RET q',              '',   False),
    (f'{RET},6a,71',       'RET j q',            '',   False),
    (f'{RET},47,71',       'RET G q',            '',   False),
    (f'{RET},2d,52,{RET},47,71', 'RET -R RET G q', '', False),
    (f'{RET},71',          'RET q',              '-R', False),
    (f'{RET},47,71',       'RET G q',            '-R', False),
    (f'{RET},2f,35,{RET},71', 'RET / 5 RET q',   '-R', False),
    # typed INTO the gate: the key is ungot and opens a command line
    # before anything has been painted
    ('2d,2d,7f,71',        '- - DEL q',          '',   False),
    ('2d,7f,71',           '- DEL q',            '',   False),
    ('2d,2d,08,71',        '- - ^H q',           '-R', False),
    # a pipe: the length is not known until a read returns EOI
    (f'{RET},71',          'RET q',              '',   True),
    (f'{RET},47,71',       'RET G q',            '',   True),
    (f'{RET},47,71',       'RET G q',            '-R', True),
]

with tempfile.TemporaryDirectory() as tmp:
    fixture = os.path.join(tmp, 'colour.txt')
    with open(fixture, 'w') as handle:
        handle.write(COLOUR)

    def one(case):
        groups, label, opts, piped = case
        less = f'{OG} {opts}'.strip()
        us = f'node {CLI} {opts}'.strip()
        shell = (f'cat {fixture} | %s' if piped else f'%s {fixture}')

        return (run(shell % less, groups), run(shell % us, groups))

    started = time.time()
    bad = 0
    starred = 0

    for (groups, label, opts, piped), (a, b) in zip(
            CASES, fastpty.imap(one, CASES)):
        how = 'pipe' if piped else 'file'

        # ours ends one CR longer on purpose: A_QUIT calls cmd_exec
        # from less v708 (05bfd38), which we took, and on a dumb
        # terminal clear_bot is a bare CR with an empty clear_eol
        quit_cmd_exec = b == a + b'\r'

        if a != b and not quit_cmd_exec:
            bad += 1
            print(f'DIFF {how:4} {opts:3} [{label}]  '
                  f'less={len(a)} ours={len(b)}')
        elif quit_cmd_exec:
            starred += 1

    print(f'dumb: {len(CASES) - bad}/{len(CASES)} identical'
          f'   [{time.time() - started:.1f}s]'
          + (f'   ({starred} * = q calls cmd_exec, less v708, taken)'
             if starred else ''))

sys.exit(1 if bad else 0)
