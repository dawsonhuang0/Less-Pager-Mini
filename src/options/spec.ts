type OptionType = 'bool' | 'triple' | 'number' | 'string' | 'novar';

export interface OptionSpec {
  /** Short flag letter; the upper-case letter selects a triple's
   *  second state. Empty for long-only options. */
  letter: string;
  /** Long names; an uppercase name selects a triple's second state. */
  names: string[];
  type: OptionType;
  /** State/toggle messages indexed by the option state. */
  messages: string[];
  /** Parameter prompt for number/string options. */
  prompt?: string;
  /** Report template for number/string options (%d / %s). */
  report?: string;
  /** Replaces the parameter prompt with a dedicated flow (-o, -O). */
  enter?: () => void;
  /** Negative numbers allowed (O_NEGOK). */
  negok?: boolean;
  /** Cannot be changed at runtime (O_NO_TOGGLE). */
  noToggle?: boolean;
  /** Ignored by the $LESS scan, set via $LESS_UNSUPPORT (O_UNSUPPORTED). */
  unsupported?: boolean;
  /** Cannot be queried with `_` (O_NO_QUERY). */
  noQuery?: boolean;
  /** Custom `_` query, for handlers with combined-state messages. */
  query?: () => void;
  /** Runs after a number value applies at INIT or TOGGLE, like an
   *  optfunc handler; less skips it for a two-argument pendopt value. */
  handler?: () => void;
  /** Number options: largest accepted value and the reset fallback. */
  max?: number;
  maxMessage?: string;
  maxFallback?: number;
  /** String options: characters valid in a $LESS parameter, like
   *  opttbl.c's odesc[1] ("s" space-ends, "d" digits, "," lists,
   *  leading "-"/"." allowed); unset reads to `$` or end. */
  validchars?: string;
  defaultValue: number | string;
  get: () => number | string;
  set: (value: number | string, content: string[]) => void;
}
