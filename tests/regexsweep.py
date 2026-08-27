#!/usr/bin/env python3
"""Differential test of the search REGEX against og, on a pty.

The engine behind `/` is posix-regex, not JavaScript's RegExp, because
og calls regcomp(REG_EXTENDED). The two languages disagree, so every
pattern below is one where a JS engine would have answered differently
-- leftmost-longest, [[:classes:]], \\d as a literal, the brace family,
empty branches -- plus the multibyte cases, where og matches whole
CHARACTERS and a UTF-16 engine would come up short.

Needs the vendored less/less and tests/regex.txt.

usage: regexsweep.py [PATTERN ...]      (default: the whole corpus)
       REGEXSWEEP_OPTS='-i'             extra flags for both pagers
       JOBS=1                           run the cases one at a time
"""
import os, sys, time, multiprocessing
from concurrent.futures import ProcessPoolExecutor

S = os.path.dirname(os.path.abspath(__file__))
P = os.path.dirname(S)
sys.path.insert(0, S)

import fastpty

# The old driver paid 0.8s before the first key and 0.5s between each
# one after, per pager, per case: 41 cases x 2 pagers x ~9 keys is
# seven minutes of sleeping, and 82 python interpreters to do it in.
# fastpty asks the same question by reading until the pager has been
# silent for QUIET, which is true as soon as it IS true. The caps are
# raised from fastpty's defaults because a search is slower than a
# scroll and (a+)+b is the slowest thing in the corpus.
fastpty.QUIET = float(os.environ.get('QUIET', '0.12'))
fastpty.FIRST = 2.0
fastpty.STEP = 2.0
fastpty.DEAD = 30.0

OPTS = os.environ.get('REGEXSWEEP_OPTS', '').split()

# fastpty sets LESSNOCONFIG itself; this corpus predates it and wants
# the same environment for both pagers, whatever the user's is
ENV = dict(LESS='', LESSHISTFILE='/dev/null', LESSNOCONFIG='',
           LC_ALL='en_US.UTF-8')


def run(cmd, keys):
    """One pager, one case: every byte it writes, keys fed one at a time."""
    return fastpty.run(cmd, list(keys), 24, 80, ENV, cwd=S)


# (keys, what it proves).  \r submits, q quits.
CASES = [
    # leftmost-longest: POSIX takes the LONGEST match, JS the first
    # alternative that fits, so these two differ in what gets highlit
    ('/a|ab\rq',            'leftmost-longest picks "ab"'),
    ('/(a|ab)(c|bcd)\rq',   'longest split across groups'),
    ('/abc|abcabc\rq',      'longer alternative wins'),

    # POSIX bracket classes -- JS has no such syntax at all
    ('/[[:digit:]]+\rq',    'digit class'),
    ('/[[:alpha:]]+\rq',    'alpha class'),
    ('/[[:space:]]\rq',     'space class'),
    ('/[[:punct:]]+\rq',    'punct class'),
    ('/[[:upper:]][[:lower:]]+\rq', 'case classes'),

    # GNU/Perl operators are LITERAL characters to a BSD regcomp
    ('/\\d\rq',             'backslash-d is the letter d'),
    ('/\\w\rq',             'backslash-w is the letter w'),
    ('/\\b\rq',             'backslash-b is the letter b'),
    ('/\\1\rq',             'backslash-1 is the digit 1'),

    # the brace family -- og commits to an interval only after a digit
    ('/a{1\rq',             'committed interval is refused'),
    ('/{\rq',               'lone brace is literal'),
    ('/a{\rq',              'trailing brace is literal'),
    ('/a{}\rq',             'empty braces are literal'),
    ('/a{2}\rq',            'a real interval still works'),
    ('/a{2,3}\rq',          'bounded interval'),
    ('/a{2,1}\rq',          'reversed bounds are refused'),

    # duplication upon duplication, and the empty branch
    ('/a**\rq',             'repeated repeat refused'),
    ('/a+?\rq',             'no lazy quantifiers in POSIX'),
    ('/x|\rq',              'empty branch refused'),
    ('/(d|)\rq',            'empty branch in a group'),

    # multibyte: og matches whole characters, so one "." spans one
    # emoji.  A UTF-16 engine would eat half of it.
    ('/emoji .. tail\rq',   'two dots span two astral chars'),
    ('/\U0001F600\rq',      'astral literal'),
    ('/你好\rq',             'CJK literal'),
    ('/cjk ....\rq',        'four dots span four wide chars'),
    ('/caf.\rq',            'dot spans an accented char'),
    ('/[é]\rq',              'accented char in a bracket'),

    # anchors, and the classic ReDoS bait that used to hang us
    ('/^anchor\rq',         'start anchor'),
    ('/end$\rq',            'end anchor'),
    ('/^$\rq',              'empty-line pattern'),
    ('/(a+)+b\rq',          'no catastrophic backtracking'),

    # search modifiers: ^R literal, ^N invert, ^S subsearch
    ('/\x12a{1\rq',         '^R literal search of a bad pattern'),
    ('/\x12!@#$\rq',        '^R literal punctuation'),
    ('/\x0eaaa\rq',         '^N inverted search'),
    ('/\x13\x31(abc)-(123)\rq', '^S restrict to group 1'),

    # & filter and n/N repeat run through the same engine
    ('&[[:digit:]]\rq',     '& filter with a POSIX class'),
    ('&a|ab\rq',            '& filter leftmost-longest'),
    ('/a|ab\rnq',           'n repeats the POSIX match'),
    ('/[[:alpha:]]+\rnNq',  'n then N'),
]

def one(case):
    """Both pagers on one case. Runs in a worker, so it returns bytes."""
    keys, what = case
    return (run([f'{P}/less/less', '-X'] + OPTS + ['regex.txt'], keys),
            run(['node', f'{P}/dist/cli.js', '-X'] + OPTS + ['regex.txt'], keys))


def main():
    want = sys.argv[1:]
    cases = [(k, w) for k, w in CASES
             if not want or any(a in k for a in want)]

    # a case is two pty sessions that only ever wait on each other, so
    # they parallelise cleanly. PROCESSES, not threads: every session
    # forks, and forking out of a thread holding the interpreter's
    # locks is a way to hang for reasons that have nothing to do with
    # the pager. FORK, not macOS's default spawn, which re-imports this
    # module in every worker and re-runs the sweep inside itself
    jobs = int(os.environ.get('JOBS', str(min(8, os.cpu_count() or 4))))
    started = time.time()

    if jobs > 1 and len(cases) > 1:
        with ProcessPoolExecutor(
                max_workers=jobs,
                mp_context=multiprocessing.get_context('fork')) as pool:
            results = list(pool.map(one, cases))
    else:
        results = [one(c) for c in cases]

    bad = 0
    for (keys, what), (a, b) in zip(cases, results):
        if a == b:
            print(f'  ok   {keys!r:34} {what}')
            continue
        bad += 1
        i = 0
        while i < min(len(a), len(b)) and a[i] == b[i]:
            i += 1
        print(f'  DIFF {keys!r:34} {what}')
        print(f'         og  {len(a):5}b  ...{a[max(0,i-25):i+45]!r}')
        print(f'         our {len(b):5}b  ...{b[max(0,i-25):i+45]!r}')

    print(f'\n{len(cases)-bad}/{len(cases)} identical'
          + (f'   ({" ".join(OPTS)})' if OPTS else '')
          + f'   [{time.time()-started:.1f}s, {jobs} job(s)]')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
