#!/usr/bin/env python3
"""Regenerate src/features/lesskeyCodes.ts from the vendored less/ source.

The lesskey action names and the numeric codes a compiled file carries
live in two less files: the name tables in lesskey_parse.c, and the
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
    """One `{ "name", A_SYMBOL }` table, in less's own order."""
    body = re.search(r'%s\[\]\s*=\s*\{(.*?)\{ NULL' % name, source, re.S)
    if body is None:
        sys.exit('%s: no %s table found' % (PARSE_C, name))

    return [(key, nums[symbol]) for key, symbol in
            re.findall(r'\{\s*"([^"]+)",\s*(\w+)\s*\}', body.group(1))]


def special_key_symbols(source):
    """SK_* symbol back to the \\k form that produces it."""
    body = re.search(
        r"case 'k':\s*\n\s*if \(xlate\)(.*?)\n\t\t\t\t\}\n\t\t\t\tif \(ch == 0\)",
        source, re.S)

    forms = {'SK_CONTROL_K': None}
    prefix = ''

    for line in body.group(1).splitlines():
        opens = re.match(r"\s*case '(.)':\s*$", line)
        if opens and opens.group(1) in '^+p':
            prefix = opens.group(1)
            continue

        case = re.match(r"\s*case '(.)': ch = (SK_\w+); break;", line)
        if case:
            forms.setdefault(case.group(2), prefix + case.group(1))
        elif re.match(r'\s*break;', line):
            prefix = ''

    return forms


def special_keys(source, nums):
    """The \\k letter forms and their SK_* codes, out of less's tstr.

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


DECODE_C = 'less/decode.c'

# C character literals that mean something else in lesskey source
KEY_CHARS = {r"'\r'": r'\r', r"'\n'": r'\n', r"'\t'": r'\t',
             "' '": r'\40', "'#'": r'\#', "'^'": r'\^',
             r"'\\'": '\\\\', r"'\17'": r'\017'}

# inside an extra string a space is just a space: it ends nothing
EXTRA_CHARS = dict(KEY_CHARS, **{"' '": ' '})


def token(text, chars, skforms):
    """One entry of less's byte table, as lesskey source notation."""
    if text.startswith('SK('):
        form = skforms.get(text[3:-1])
        # SK_CONTROL_K has no \k form: it is how a literal ^K is stored
        return '^K' if form is None else '\\k' + form
    if text.startswith('CONTROL('):
        return '^' + text[9:-2]
    if text == 'ESC':
        return r'\e'
    if text.startswith("'"):
        return chars.get(text, text[1:-1])
    return '<?%s>' % text


def builtin(source, name, nums, names, skforms):
    """less's own default bindings, as lesskey source lines.

    decode.c's tables are byte lists - the key bytes, a 0, then the
    action, and for an action OR'd with A_EXTRA a NUL-terminated extra
    string after it.
    """
    body = re.search(r'%s\[\]\s*=\s*\{(.*?)\n\};' % name, source, re.S)
    if body is None:
        sys.exit('%s: no %s found' % (DECODE_C, name))

    parts = [t.strip() for t in
             re.sub(r'/\*.*?\*/', '', body.group(1), flags=re.S).split(',')
             if t.strip()]

    lines = []
    keys = []
    i = 0

    while i < len(parts):
        if parts[i] != '0':
            keys.append(token(parts[i], KEY_CHARS, skforms))
            i += 1
            continue

        action = parts[i + 1]
        i += 2
        extra = ''

        if '|A_EXTRA' in action:
            action = action.split('|')[0]
            chunk = []
            while i < len(parts) and parts[i] != '0':
                chunk.append(token(parts[i], EXTRA_CHARS, skforms))
                i += 1
            i += 1
            extra = ''.join(chunk)

        sequence = ''.join(keys)
        keys = []
        named = names.get(nums.get(action))

        if named is None:
            # A_START_PASTE and A_END_PASTE have no lesskey name; they
            # are the bracketed-paste markers, not commands
            lines.append('# %s\t<%s: no lesskey name>' % (sequence, action))
        else:
            lines.append('%s\t%s%s' % (sequence, named,
                                       '\t' + extra if extra else ''))

    return lines


def ts_string(text):
    """A TypeScript single-quoted literal."""
    return "'%s'" % text.replace('\\', '\\\\').replace("'", "\\'").replace(
        '\t', '\\t')


def forward(pairs):
    width = max(len(name) for name, _ in pairs) + 1
    return '\n'.join("  '%s':%s %d," % (name, ' ' * (width - len(name)), code)
                     for name, code in pairs)


def reverse(pairs):
    """Code back to ONE name: the first less lists for it."""
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

    decode = open(DECODE_C).read()
    symbols = special_key_symbols(source)
    cmd_names = {code: name for name, code in reversed(cmd)}
    edit_names = {code: name for name, code in reversed(edit)}
    defaults = (['#command'] +
                builtin(decode, 'cmdtable', nums, cmd_names, symbols) +
                ['', '#line-edit'] +
                builtin(decode, 'edittable', nums, edit_names, symbols))

    open(OUT, 'w').write(TEMPLATE % {
        'extra': nums['A_EXTRA'],
        'ev_ok': nums['EV_OK'],
        'sk_key': nums.get('SK_CONTROL_K'),
        'keys': forward(keys),
        'defaults': '\n'.join('  %s,' % ts_string(l) for l in defaults),
        'cmd': forward(cmd),
        'edit': forward(edit),
        'cmd_names': reverse(cmd),
        'edit_names': reverse(edit),
    })

    print('%s: %d command names, %d line-edit names, %d \\k forms'
          % (OUT, len(cmd), len(edit), len(keys)))


TEMPLATE = '''/**
 * less's lesskey action NAMES against the numeric codes a compiled file
 * carries - `lesskey_parse.c`'s cmdnames/editnames tables resolved
 * through `cmd.h`.
 *
 * The pager itself never needs this: reading a binding only has to
 * reach an action, which `ACTION_CODES` already does. WRITING one
 * does, because the byte in the file is less's code and nothing else,
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

/** #command action names, like less's cmdnames[]. */
export const COMMAND_CODES: Record<string, number> = {
%(cmd)s
};

/** #line-edit action names, like less's editnames[]. */
export const EDIT_ACTION_CODES: Record<string, number> = {
%(edit)s
};

/**
 * A code back to ONE name, for rendering a binary as source.
 *
 * less lets several names share a code - "end" and "goto-end" are both
 * A_GOEND - so this keeps the first less lists, which is also the first
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
 * Every \\k form and the SK_* code it compiles to, out of less's tstr.
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

/**
 * less's built-in bindings, written out as lesskey source.
 *
 * --edit-lesskey opens this when a session has no lesskey of any kind,
 * so the editor holds what the keys ALREADY do rather than an empty
 * file - every binding is there to be changed or deleted, and the
 * shape of the syntax comes with it.
 *
 * It is less's own cmdtable/edittable (decode.c), not a description of
 * them: compile it and you get the defaults back. The two paste
 * markers appear commented out, because A_START_PASTE and A_END_PASTE
 * have no lesskey name to write.
 */
export const DEFAULT_KEYMAP: string[] = [
%(defaults)s
];
'''

if __name__ == '__main__':
    main()
