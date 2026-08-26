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
        less = f'{P}/less/less {opts}'.strip()
        us = f'node {CLI} {opts}'.strip()
        shell = (f'cat {fixture} | %s' if piped else f'%s {fixture}')

        return (run(shell % less, groups), run(shell % us, groups))

    started = time.time()
    bad = 0

    for (groups, label, opts, piped), (a, b) in zip(
            CASES, fastpty.imap(one, CASES)):
        how = 'pipe' if piped else 'file'

        if a != b:
            bad += 1
            print(f'DIFF {how:4} {opts:3} [{label}]  '
                  f'less={len(a)} ours={len(b)}')

    print(f'dumb: {len(CASES) - bad}/{len(CASES)} identical'
          f'   [{time.time() - started:.1f}s]')

sys.exit(1 if bad else 0)
