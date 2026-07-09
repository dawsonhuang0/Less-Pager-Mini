import { search, chgCaseless } from "./searching";

/**
 * Runtime option command state: `-` toggles an option, `_` queries it.
 */
export const option = {
  pending: '' as '' | '-' | '_',
};

const CASELESS_MESSAGES = [
  'Case is significant in searches',
  'Ignore case in searches',
  'Ignore case in searches and in patterns',
] as const;

/**
 * Opens the option prompt.
 *
 * @param command - `-` to toggle an option, `_` to query its state.
 */
export function startOption(command: '-' | '_'): void {
  option.pending = command;
}

/**
 * Handles the option letter following a `-` or `_` command.
 *
 * - `i` cycles smart case sensitivity, `I` cycles always-ignore.
 * - Reports the resulting state at the prompt like less.
 *
 * @param key - Raw key input following the option command.
 */
export function optionKey(key: string): void {
  const command = option.pending;
  option.pending = '';

  if (key === '\x03' || key.startsWith('\x1B')) return;

  const char = key[0];

  switch (char) {
    case 'i':
      if (command === '-') chgCaseless(search.caseless === 1 ? 0 : 1);
      search.message = CASELESS_MESSAGES[search.caseless];
      return;

    case 'I':
      if (command === '-') chgCaseless(search.caseless === 2 ? 0 : 2);
      search.message = CASELESS_MESSAGES[search.caseless];
      return;
  }

  search.message = `There is no ${char} option`;
}


// ---- forward stubs for the line-editing layer ----
// The real implementations arrive with the OPTIONS section; these
// keep the defaults og uses when the options are untouched.

/** True when --no-histdups removes duplicate history entries. */
export const optNoHistDups = (): boolean => false;

/** True when --autosave writes the history file for an action. */
export const optAutosaveAction = (action: string): boolean => {
  void action;
  return false;
};

/** The --search-options preset modifiers (all off by default). */
export const optDefSearchType = () => ({
  invert: false,
  fromStart: false,
  pastEof: false,
  keep: false,
  noRegex: false,
  wrap: false,
  subs: [] as number[],
});

/** Forgets the tracked --header start (no headers yet). */
export function resetHeaderStart(): void {}
