#!/usr/bin/env python3
"""Regenerate src/features/lesskeyCodes.ts from the vendored less/ source.

The lesskey action names and the numeric codes a compiled file carries
live in two og files: the name tables in lesskey_parse.c, and the
numbers behind their A_* / EC_* symbols in cmd.h. Typing 99 pairs by
hand is how a table goes quietly wrong, so it is read from the source.

usage:  python3 tools/gen-lesskey-codes.py        (from the repo root)
"""
import re
import sys

CMD_H = 'less/cmd.h'
PARSE_C = 'less/lesskey_parse.c'
OUT = 'src/features/lesskeyCodes.ts'


def cnum(text):
    """A C integer literal: a leading 0 means octal, as in A_EXTRA 0200."""
    return int(text, 8) if text.startswith('0') and len(text) > 1 else int(text)


def defines(header):
    """Every `#define NAME <number>`, plus the EC_* that alias an A_*."""
    nums = {m.group(1): cnum(m.group(2)) for m in re.finditer(
        r'^#define\s+(\w+)\s+(\d+)\s*(?:/\*.*?\*/)?\s*$', header, re.M)}

    for m in re.finditer(r'^#define\s+(EC_\w+)\s+(A_\w+)\s*$', header, re.M):
        nums[m.group(1)] = nums[m.group(2)]

    return nums


def table(source, nums, name):
    """One `{ "name", A_SYMBOL }` table, in og's own order."""
    body = re.search(r'%s\[\]\s*=\s*\{(.*?)\{ NULL' % name, source, re.S)
    if body is None:
        sys.exit('%s: no %s table found' % (PARSE_C, name))

    return [(key, nums[symbol]) for key, symbol in
            re.findall(r'\{\s*"([^"]+)",\s*(\w+)\s*\}', body.group(1))]


def forward(pairs):
    width = max(len(name) for name, _ in pairs) + 1
    return '\n'.join("  '%s':%s %d," % (name, ' ' * (width - len(name)), code)
                     for name, code in pairs)


def reverse(pairs):
    """Code back to ONE name: the first og lists for it."""
    first = {}
    for name, code in pairs:
        first.setdefault(code, name)

    return '\n'.join("  %d:%s '%s'," % (code, ' ' * (4 - len(str(code))), name)
                     for code, name in sorted(first.items()))


def main():
    nums = defines(open(CMD_H).read())
    source = open(PARSE_C).read()
    cmd = table(source, nums, 'cmdnames')
    edit = table(source, nums, 'editnames')

    open(OUT, 'w').write(TEMPLATE % {
        'extra': nums['A_EXTRA'],
        'ev_ok': nums['EV_OK'],
        'cmd': forward(cmd),
        'edit': forward(edit),
        'cmd_names': reverse(cmd),
        'edit_names': reverse(edit),
    })

    print('%s: %d command names, %d line-edit names' % (OUT, len(cmd), len(edit)))


TEMPLATE = '''/**
 * og's lesskey action NAMES against the numeric codes a compiled file
 * carries - `lesskey_parse.c`'s cmdnames/editnames tables resolved
 * through `cmd.h`.
 *
 * The pager itself never needs this: reading a binding only has to
 * reach an action, which `ACTION_CODES` already does. WRITING one
 * does, because the byte in the file is og's code and nothing else,
 * and so does rendering a binary back as source. Both directions live
 * here so they cannot drift apart.
 *
 * GENERATED from the vendored less/ source (707x) by
 * `tools/gen-lesskey-codes.py`. Regenerate rather than edit.
 */

/** A_EXTRA: OR'd into the action byte when an extra string follows. */
export const A_EXTRA = 0x%(extra)02X;

/** EV_OK: the #env section's action byte, always with A_EXTRA. */
export const EV_OK = 0x%(ev_ok)02X;

/** #command action names, like og's cmdnames[]. */
export const COMMAND_CODES: Record<string, number> = {
%(cmd)s
};

/** #line-edit action names, like og's editnames[]. */
export const EDIT_ACTION_CODES: Record<string, number> = {
%(edit)s
};

/**
 * A code back to ONE name, for rendering a binary as source.
 *
 * og lets several names share a code - "end" and "goto-end" are both
 * A_GOEND - so this keeps the first og lists, which is also the first
 * alphabetically. Any of them compiles back to the same byte.
 */
export const COMMAND_NAMES: Record<number, string> = {
%(cmd_names)s
};

/** The same, for the #line-edit section. */
export const EDIT_ACTION_NAMES: Record<number, string> = {
%(edit_names)s
};
'''

if __name__ == '__main__':
    main()
