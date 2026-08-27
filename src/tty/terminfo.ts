/*
 * Reads the compiled terminfo database, the way less's curses does.
 *
 * Ported from the new-src less rewrite, which wrote it as an ADDITION
 * with no counterpart in less: less links curses and calls tgetent/tgetstr,
 * so we have to read term(5) ourselves. src had been answering every
 * capability from the LESS_TERMCAP variables and $TERMCAP alone, so a
 * terminal's real strings were never consulted and each caller fell
 * back to a guess -- which is how rmso and sgr0 came to be hardcoded
 * xterm values.
 */


import * as fs from 'fs';
import * as path from 'path';

const MAGIC16 = 0o432;
const MAGIC32 = 0o1036;

interface Terminfo {
  names: string[];
  bools: boolean[];
  nums: number[];
  strs: (string | null)[];
  /* Extended capabilities, keyed by the name stored in the file. */
  ext_strs: { [name: string]: string };
  ext_bools: { [name: string]: boolean };
  ext_nums: { [name: string]: number };
}

let ti: Terminfo | null = null;

/*
 * Where the compiled entries live. ncurses searches $TERMINFO, then
 * $TERMINFO_DIRS, then $HOME/.terminfo, then the compiled-in list; these
 * are the standard locations on the systems we run on.
 */
const terminfo_dirs = (): string[] => {
  const dirs: string[] = [];
  const env = process.env.TERMINFO;
  if (env) dirs.push(env);
  const envd = process.env.TERMINFO_DIRS;
  if (envd)
    for (const d of envd.split(':'))
      if (d !== '') dirs.push(d);
  const home = process.env.HOME;
  if (home) dirs.push(path.join(home, '.terminfo'));
  dirs.push('/usr/share/terminfo');
  dirs.push('/lib/terminfo');
  dirs.push('/etc/terminfo');
  dirs.push('/usr/share/lib/terminfo');
  return dirs;
};

const find_entry = (term: string): Buffer | null => {
  if (term === '' || term.indexOf('/') >= 0)
    return null;
  const first = term[0];
  const hex = first.charCodeAt(0).toString(16);
  for (const dir of terminfo_dirs()) {
    /* ncurses uses a letter directory; macOS uses the hex of that letter. */
    for (const sub of [first, hex]) {
      try {
        return fs.readFileSync(path.join(dir, sub, term));
      } catch {
        /* try the next location */
      }
    }
  }
  return null;
};

const parse = (buf: Buffer): Terminfo | null => {
  if (buf.length < 12)
    return null;
  const magic = buf.readUInt16LE(0);
  if (magic !== MAGIC16 && magic !== MAGIC32)
    return null;
  const numlen = (magic === MAGIC32) ? 4 : 2;

  const name_size = buf.readUInt16LE(2);
  const bool_count = buf.readUInt16LE(4);
  const num_count = buf.readUInt16LE(6);
  const str_count = buf.readUInt16LE(8);
  const table_size = buf.readUInt16LE(10);

  let off = 12;
  const names = buf.subarray(off, off + name_size)
    .toString('binary').replace(/\0.*$/, '').split('|');
  off += name_size;

  const bools: boolean[] = [];
  for (let i = 0; i < bool_count; i++)
    bools.push(buf[off + i] === 1);
  off += bool_count;

  /* Numbers start on an even boundary. */
  if (off % 2 !== 0) off++;

  const nums: number[] = [];
  for (let i = 0; i < num_count; i++) {
    const v = numlen === 4
      ? buf.readInt32LE(off + i * 4)
      : buf.readInt16LE(off + i * 2);
    nums.push(v);
  }
  off += num_count * numlen;

  const offsets: number[] = [];
  for (let i = 0; i < str_count; i++)
    offsets.push(buf.readInt16LE(off + i * 2));
  off += str_count * 2;

  const table = buf.subarray(off, off + table_size);
  const strs: (string | null)[] = [];
  for (const o of offsets) {
    if (o < 0 || o >= table.length) {
      strs.push(null);
      continue;
    }
    let end = o;
    while (end < table.length && table[end] !== 0) end++;
    /*
     * {{ The $<...> padding stays in the string. less hands the database
     *    string to tputs unchanged, and screen.c's ltputs performs the
     *    delay itself; stripping it here silently removed every delay less
     *    makes, and left cost() counting a string tputs never sees. }}
     */
    strs.push(table.subarray(o, end).toString('binary'));
  }

  off += table_size;

  /*
   * The extended section, if present. Layout (term(5)):
   *   counts:  ext_bool, ext_num, ext_str, ext_str_size(unused), last_offset
   *   ext booleans, pad to even
   *   ext numbers
   *   ext string offsets      (ext_str entries)
   *   ext name offsets        (ext_bool + ext_num + ext_str entries)
   *   table: the ext strings, then the names
   */
  const ext_strs: { [name: string]: string } = {};
  const ext_bools: { [name: string]: boolean } = {};
  const ext_nums: { [name: string]: number } = {};

  if (off % 2 !== 0) off++;
  if (off + 10 <= buf.length) {
    const eb = buf.readUInt16LE(off);
    const en = buf.readUInt16LE(off + 2);
    const es = buf.readUInt16LE(off + 4);
    const etable_size = buf.readUInt16LE(off + 8);
    off += 10;

    const ebools: boolean[] = [];
    for (let i = 0; i < eb; i++) ebools.push(buf[off + i] === 1);
    off += eb;
    if (off % 2 !== 0) off++;

    const enums: number[] = [];
    for (let i = 0; i < en; i++)
      enums.push(numlen === 4
        ? buf.readInt32LE(off + i * 4)
        : buf.readInt16LE(off + i * 2));
    off += en * numlen;

    const eoffsets: number[] = [];
    for (let i = 0; i < es; i++) eoffsets.push(buf.readInt16LE(off + i * 2));
    off += es * 2;

    const nameoffs: number[] = [];
    for (let i = 0; i < eb + en + es; i++)
      nameoffs.push(buf.readInt16LE(off + i * 2));
    off += (eb + en + es) * 2;

    const etable = buf.subarray(off, off + etable_size);
    const at = (o: number): string | null => {
      if (o < 0 || o >= etable.length) return null;
      let e = o;
      while (e < etable.length && etable[e] !== 0) e++;
      return etable.subarray(o, e).toString('binary');
    };
    /*
     * The value strings come first in the table, the names after them --
     * and the NAME offsets are relative to the end of the values, not to
     * the start of the table. Reading them from the table start yields
     * text sliced out of the middle of a value string, which is exactly
     * what it looked like before this was found.
     */
    let vend = 0;
    for (const o of eoffsets) {
      if (o < 0) continue;
      let e = o;
      while (e < etable.length && etable[e] !== 0) e++;
      if (e + 1 > vend) vend = e + 1;
    }
    /*
     * Names are stored in the order bools, nums, strs -- the same order the
     * value arrays appear in.
     */
    for (let i = 0; i < eb; i++) {
      const nm = at(nameoffs[i] + vend);
      if (nm !== null) ext_bools[nm] = ebools[i];
    }
    for (let i = 0; i < en; i++) {
      const nm = at(nameoffs[eb + i] + vend);
      if (nm !== null) ext_nums[nm] = enums[i];
    }
    for (let i = 0; i < es; i++) {
      const nm = at(nameoffs[eb + en + i] + vend);
      const v = at(eoffsets[i]);
      if (nm !== null && v !== null)
        ext_strs[nm] = v;
    }
  }

  return { names, bools, nums, strs, ext_strs, ext_bools, ext_nums };
};

/*
 * less's tgetent. Returns 1 on success, 0 if the terminal is unknown, -1 if
 * the database is unreadable -- the same three answers screen.c branches on.
 */
export const tgetent = (term: string | null): number => {
  ti = null;
  if (term === null || term === '')
    return 0;
  const buf = find_entry(term);
  if (buf === null)
    return 0;
  ti = parse(buf);
  return ti === null ? -1 : 1;
};

/*
 * Capability indices, in the order of ncurses' Caps file. Only what less
 * asks for; the two-letter names are the termcap codes screen.c uses.
 */
const BOOLS: { [cap: string]: number } = {
  bw: 0,     /* auto_left_margin */
  am: 1,     /* auto_right_margin */
  xhp: 3,    /* ceol_standout_glitch */
  xenl: 4,   /* eat_newline_glitch */
  hc: 7,     /* hard_copy */
  da: 11,    /* memory_above */
  db: 12,    /* memory_below */
  msgr: 14,  /* move_standout_mode */
  os: 15,    /* over_strike */
  /*
   * {{ Not asked for by any of less's capability lookups: these two are
   *    ncurses' own tputs consults to decide whether a $<...> delay
   *    becomes pad characters, a nap, or nothing. screen.ts reads them
   *    through the same ltgetflag path. }}
   */
  xon: 20,   /* xon_xoff */
  npc: 25,   /* no_pad_char */
};


const NUMS: { [cap: string]: number } = {
  cols: 0,     /* columns */
  lines: 2,    /* lines */
  xmc: 4,      /* magic_cookie_glitch -- 3 is lines_of_memory */
  pb: 5,       /* padding_baud_rate */
  colors: 13,  /* max_colors */
};


const STRS: { [cap: string]: number } = {
  bel: 1,      /* bell */
  cr: 2,       /* carriage_return */
  clear: 5,    /* clear_screen */
  el: 6,       /* clr_eol */
  ed: 7,       /* clr_eos */
  cup: 10,     /* cursor_address */
  home: 12,    /* cursor_home */
  cub1: 14,    /* cursor_left */
  cuf1: 17,    /* cursor_right */
  ll: 18,      /* cursor_to_ll */
  cuu1: 19,    /* cursor_up */
  blink: 26,   /* enter_blink_mode */
  bold: 27,    /* enter_bold_mode */
  smcup: 28,   /* enter_ca_mode */
  dim: 30,     /* enter_dim_mode */
  smso: 35,    /* enter_standout_mode */
  smul: 36,    /* enter_underline_mode */
  sgr0: 39,    /* exit_attribute_mode */
  rmcup: 40,   /* exit_ca_mode */
  rmso: 43,    /* exit_standout_mode */
  rmul: 44,    /* exit_underline_mode */
  flash: 45,   /* flash_screen */
  il1: 53,     /* insert_line */
  kbs: 55,     /* key_backspace */
  kdch1: 59,   /* key_dc */
  kcud1: 61,   /* key_down */
  kf1: 66,     /* key_f1 */
  khome: 76,   /* key_home */
  kich1: 77,   /* key_ic */
  kcub1: 79,   /* key_left */
  knp: 81,     /* key_npage */
  kpp: 82,     /* key_ppage */
  kcuf1: 83,   /* key_right */
  kcuu1: 87,   /* key_up */
  rmkx: 88,    /* keypad_local */
  smkx: 89,    /* keypad_xmit */
  ind: 129,    /* scroll_forward -- not 11, which is cursor_down */
  ri: 130,     /* scroll_reverse */
  ka1: 139,    /* key_a1 */
  ka3: 140,    /* key_a3 */
  kb2: 141,    /* key_b2 */
  kc1: 142,    /* key_c1 */
  kc3: 143,    /* key_c3 */
  kcbt: 148,   /* key_btab */
  kend: 164,   /* key_end */
  kent: 165,   /* key_enter */
  kDC: 191,    /* key_sdc */
  kEND: 194,   /* key_send */
  kHOM: 199,   /* key_shome */
  kLFT: 201,   /* key_sleft */
  kRIT: 210,   /* key_sright */
  op: 297,     /* orig_pair */
  setaf: 359,  /* set_a_foreground */
  setab: 360,  /* set_a_background */
};

/*
 * These have no index above because ncurses stores them as EXTENDED
 * capabilities -- the name lives in the file, not in a fixed position:
 *   kUP kDN kUP5 kDN5 kLFT5 kRIT5 kHOM5 kEND5 kDC5
 *   ka2 kb1 kb3 kc2  kpMUL kpDIV kpSUB kpADD kpDOT kpCMA kpZRO
 * special_key_str asks for every one, so tgetstr falls through to the
 * extended table when a name has no standard index.
 */

export const tgetflag = (cap: string): number => {
  if (ti === null) return 0;
  const i = BOOLS[cap];
  if (i === undefined || i >= ti.bools.length) {
    const e = ti.ext_bools[cap];
    return e === undefined ? 0 : (e ? 1 : 0);
  }
  return ti.bools[i] ? 1 : 0;
};

export const tgetnum = (cap: string): number => {
  if (ti === null) return -1;
  const i = NUMS[cap];
  if (i === undefined || i >= ti.nums.length) {
    const e = ti.ext_nums[cap];
    return e === undefined ? -1 : e;
  }
  return ti.nums[i];
};

export const tgetstr = (cap: string): string | null => {
  if (ti === null) return null;
  const i = STRS[cap];
  if (i === undefined || i >= ti.strs.length) {
    /* Not a standard capability here; try the extended section. */
    const e = ti.ext_strs[cap];
    return e === undefined ? null : e;
  }
  return ti.strs[i];
};
