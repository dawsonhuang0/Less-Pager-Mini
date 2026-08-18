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


def special_keys(source, nums):
    """The \\k letter forms and their SK_* codes, out of og's tstr.

    The compiler needs every one: a compiled file stores the SK blob,
    not a terminal sequence, and the reader expands it through terminfo
    later. The ^ + p prefixes each open a nested switch.
    """
    body = re.search(
        r"case 'k':\s*\n\s*if \(xlate\)(.*?)\n\t\t\t\t\}\n\t\t\t\tif \(ch == 0\)",
        source, re.S)
    if body is None:
        sys.exit('%s: no \\k switch found in tstr' % PARSE_C)

    keys = {}
    prefix = ''

    for line in body.group(1).splitlines():
        opens = re.match(r"\s*case '(.)':\s*$", line)
        if opens and opens.group(1) in '^+p':
            prefix = opens.group(1)
            continue

        case = re.match(r"\s*case '(.)': ch = (SK_\w+); break;", line)
        if case:
            keys[prefix + case.group(1)] = nums[case.group(2)]
        elif re.match(r'\s*break;', line):
            prefix = ''

    return keys


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
    keys = sorted(special_keys(source, nums).items())

    open(OUT, 'w').write(TEMPLATE % {
        'extra': nums['A_EXTRA'],
        'ev_ok': nums['EV_OK'],
        'sk_key': nums.get('SK_CONTROL_K'),
        'keys': forward(keys),
        'cmd': forward(cmd),
        'edit': forward(edit),
        'cmd_names': reverse(cmd),
        'edit_names': reverse(edit),
    })

    print('%s: %d command names, %d line-edit names, %d \\k forms'
          % (OUT, len(cmd), len(edit), len(keys)))


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

/**
 * SK_SPECIAL_KEY, the byte that opens a special-key blob in a compiled
 * file: CONTROL('K'). A literal ^K in a key sequence is stored as the
 * SK_CONTROL_K blob instead, so that this byte always means "blob".
 */
export const SK_SPECIAL_KEY = 0x0B;

/** SK_CONTROL_K: how a literal ^K is stored. */
export const SK_CONTROL_K = %(sk_key)d;

/**
 * Every \\k form and the SK_* code it compiles to, out of og's tstr.
 *
 * A compiled file stores the blob `SK_SPECIAL_KEY <code> 6 1 1 1`, not
 * a terminal sequence - the reader expands it through terminfo when it
 * loads. Which is why this is a different table from the pager's own
 * \\k handling, and a superset of it: the keypad forms have no
 * capability to resolve to, but they still compile.
 */
export const SPECIAL_KEY_CODES: Record<string, number> = {
%(keys)s
};
'''

if __name__ == '__main__':
    main()
