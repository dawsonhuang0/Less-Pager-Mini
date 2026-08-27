import { config } from "../state/config";

/**
 * Mutable option state shared by the option files, like less
 * opttbl.c's globals. Defaults mirror less's option table.
 */
export const opt = {
  howSearch: 2,
  bufSpace: 64,
  autoBuffers: 1,
  clearRepaint: 0,
  knowDumb: 0,
  quitAtEof: 0,
  forceOpen: 0,
  quitIfOneScreen: 0,
  hiliteSearch: 2,
  backScroll: -1,
  jumpTarget: 0,
  jumpFraction: -1,
  shiftFraction: -1,
  statusCol: 0,
  quitOnIntr: 0,
  useLessopen: 1,
  prType: 0,
  linenums: 1,
  quiet: 0,
  // less's default: caret ALL escape sequences (user revoked the old
  // ctldisp=2 divergence 2026-07-24 — full less parity, -R for ANSI)
  ctldisp: 0,
  squeeze: 0,
  tagsFile: 'tags',
  bsMode: 0,
  showAttn: 0,
  tabStops: [] as number[],
  tabDefault: 8,
  noInit: 0,
  forwScroll: -1,
  quoteOpen: '"',
  quoteClose: '"',
  tildes: 1,
  noKeypad: 0,
  followName: 0,
  useBackslash: 0,
  rscrollChar: '>',
  rscrollAttr: 's' as 'n' | 's' | 'd' | 'u' | 'k',
  noHistDups: 0,
  mouseMode: 0,
  mouseReverse: 0,
  oldBot: 0,
  wheelLines: 1,
  permaMarks: 0,
  linenumWidth: 7,
  statusColWidth: 2,
  incrSearch: 0,
  useColor: 0,
  useJsRegexp: 0,
  useZshGlob: 0,
  headerLines: 0,
  headerCols: 0,
  headerStart: 0,
  nonumHeaders: 0,
  nosearchHeaderLines: 0,
  nosearchHeaderCols: 0,
  wantFileSize: 0,
  noVbell: 0,
  noEditWarn: 0,
  exitFollowOnClose: 0,
  showPreprocError: 0,
  redrawOnQuit: 0,
  noPaste: 0,
  hiliteTarget: 0,
  intrChar: '\x18',
  autosave: '-',
  matchShift: 0,
  // less defaults --match-shift to half the screen width
  // (match_shift_fraction = NUM_FRAC_DENOM/2)
  matchShiftFraction: 500000,
  emouse: 0,
  statusLine: 0,
  stopOnFormFeed: 0,
  pastEof: 0,
  modelines: 0,
  procBackspace: 0,
  procTab: 0,
  procReturn: 0,
  wordwrap: 0,
  appliedGutter: 0,
  // $LESS_IS_MORE: POSIX more compatibility, like less's less_is_more
  lessIsMore: 0,
};

// less gets a clean option table by being one process per session; a
// library call has to ask for it. Snapshotted at load, before any
// scan touches the table.
const DEFAULTS = JSON.parse(JSON.stringify(opt)) as typeof opt;

/**
 * Restores every option to its table default, like a fresh less.
 *
 * Without this a second pager() call in the same process inherits the
 * first call's -x, -S and friends: less's opttbl.c globals are
 * process-lifetime, and ours outlive a session the same way.
 */
export function resetOptions(): void {
  Object.assign(opt, JSON.parse(JSON.stringify(DEFAULTS)) as typeof opt);
}

/**
 * less keeps sc_width as the complete terminal width. Our renderer stores
 * the text width after reserving the line prefix, so anything defined in
 * terms of sc_width - every bottom-row measurement, since the command
 * line never carries the gutter - must add that reservation back.
 *
 * It lives here, in the leaf, so the low-level display code can ask
 * without pulling the whole option table in behind it.
 */
export const fullScreenWidth = (): number =>
  config.screenWidth + opt.appliedGutter;
