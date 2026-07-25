import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import pager, { PagerConfig } from '../../src/index';

import { config } from '../../src/state/config';

import { initUnsupport, opt, optionSpecs, setCliOptions }
  from '../../src/options';

import { buildLessOptionMap } from '../../src/options/apiTypes';

import { LESS_OPTION_VALUES } from '../../src/state/lessOptionTypes';

import { PAGER_ENV_NAMES, PAGER_ENV_PREFIXES }
  from '../../src/state/envTypes';

const ENV_NAMES = ['LESS', 'LESSHISTFILE', 'LESSNOCONFIG'] as const;

const originalEnv = Object.fromEntries(
  ENV_NAMES.map(name => [name, process.env[name]])
);

beforeEach(() => {
  process.env.LESSHISTFILE = '-';
  process.env.LESSNOCONFIG = '1';
  delete process.env.LESS;

  config.row = 0;
  config.subRow = 0;
  config.col = 0;
  config.window = 12;
  config.screenWidth = 40;
  config.setCol = 0;
  config.chopLongLines = false;

  initUnsupport('');
  setCliOptions([]);
});

afterAll(() => {
  setCliOptions([]);

  for (const name of ENV_NAMES) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

// 60 chars: wraps at width 40 unless -S chops the tail away
const longTail = 'head-' + 'x'.repeat(45) + '-CHOPTAIL';
// joined, not an array: array input is flat JSON without tab-object,
// and these cases only care about the option under test
const content = [longTail, 'second line'].join('\n');

/** Runs one library pager call under mocked tty streams. */
async function drive(
  call: () => Promise<void>
): Promise<string> {
  const stdout = process.stdout as unknown as Record<string, unknown>;
  const stdin = process.stdin as unknown as Record<string, unknown>;

  const savedWrite = process.stdout.write;
  const savedRows = Object.getOwnPropertyDescriptor(stdout, 'rows');
  const savedColumns = Object.getOwnPropertyDescriptor(stdout, 'columns');
  const savedIsTTY = Object.getOwnPropertyDescriptor(stdout, 'isTTY');
  const savedStdin = {
    isTTY: Object.getOwnPropertyDescriptor(stdin, 'isTTY'),
    setRawMode: stdin.setRawMode,
    resume: stdin.resume,
    pause: stdin.pause,
    on: stdin.on,
    off: stdin.off,
    once: stdin.once,
    unshift: stdin.unshift,
  };

  let output = '';
  let dataHandler = null as ((data: Buffer) => void) | null;

  process.stdout.write = ((data: string | Uint8Array): boolean => {
    output += typeof data === 'string' ? data : data.toString();
    return true;
  }) as typeof process.stdout.write;

  Object.defineProperty(stdout, 'rows', { value: 12, configurable: true });
  Object.defineProperty(stdout, 'columns', { value: 40, configurable: true });
  Object.defineProperty(stdout, 'isTTY', { value: true, configurable: true });
  Object.defineProperty(stdin, 'isTTY', { value: true, configurable: true });

  stdin.setRawMode = () => process.stdin;
  stdin.resume = () => process.stdin;
  stdin.pause = () => process.stdin;
  stdin.unshift = () => true;
  stdin.once = (event: string, fn: (data: Buffer) => void) => {
    if (event === 'data') dataHandler = fn;
    return process.stdin;
  };
  stdin.on = (event: string, fn: (data: Buffer) => void) => {
    if (event === 'data') dataHandler = fn;
    return process.stdin;
  };
  stdin.off = (event: string, fn: (data: Buffer) => void) => {
    if (event === 'data' && dataHandler === fn) dataHandler = null;
    return process.stdin;
  };

  try {
    const running = call();
    await new Promise(resolve => setImmediate(resolve));

    if (!dataHandler) throw new Error('pager did not install a key handler');
    (dataHandler as (data: Buffer) => void)(Buffer.from('q'));
    await running;
    return output;
  } finally {
    process.stdout.write = savedWrite;

    if (savedRows) Object.defineProperty(stdout, 'rows', savedRows);
    else delete stdout.rows;
    if (savedColumns) Object.defineProperty(stdout, 'columns', savedColumns);
    else delete stdout.columns;
    if (savedIsTTY) Object.defineProperty(stdout, 'isTTY', savedIsTTY);
    else delete stdout.isTTY;

    if (savedStdin.isTTY) {
      Object.defineProperty(stdin, 'isTTY', savedStdin.isTTY);
    } else {
      delete stdin.isTTY;
    }
    stdin.setRawMode = savedStdin.setRawMode;
    stdin.resume = savedStdin.resume;
    stdin.pause = savedStdin.pause;
    stdin.on = savedStdin.on;
    stdin.off = savedStdin.off;
    stdin.once = savedStdin.once;
    stdin.unshift = savedStdin.unshift;
  }
}

describe('pager(input, options, envVars) API', () => {
  it('applies a less long option name from options', async () => {
    const output = await drive(
      () => pager(content, { 'chop-long-lines': true })
    );

    expect(output).not.toContain('CHOPTAIL');
    expect(output).toContain('second line');
  });

  it('still scans a letter key an untyped caller passes', async () => {
    // PagerConfig lists long names only; the cast is the point of
    // the test, mimicking plain JavaScript reaching the -X branch
    const output = await drive(
      () => pager(content, { S: true } as PagerConfig)
    );

    expect(output).not.toContain('CHOPTAIL');
  });

  it('reads env names from the same config map', async () => {
    const output = await drive(() => pager(content, { LESS: '-S' }));

    expect(output).not.toContain('CHOPTAIL');
  });

  it('clears the env overlay after the call', async () => {
    await drive(() => pager(content, { LESS: '-S' }));

    // option STATE persists across calls (og's one-shot process
    // model); reset it so a leaked overlay would re-chop via the
    // second call's own $LESS scan
    config.chopLongLines = false;
    const output = await drive(() => pager(content));

    // without the overlay the long line wraps: the tail displays
    expect(output).toContain('CHOPTAIL');
  });

  it('keeps the generated option type in sync with the table', () => {
    // adding an option must regenerate state/lessOptionTypes.ts, or
    // editors stop autocompleting the new name
    expect(LESS_OPTION_VALUES).toEqual(buildLessOptionMap(optionSpecs()));
  });

  it('keeps option and env names disjoint, splitting one map', () => {
    // the merged PagerConfig map relies on this invariant to route
    // each key: option names never look like env names
    const optionKeys = new Set(Object.keys(LESS_OPTION_VALUES));

    for (const name of PAGER_ENV_NAMES) {
      expect(optionKeys.has(name), `clash: ${name}`).toBe(false);
    }

    for (const key of optionKeys) {
      const familyLike = PAGER_ENV_PREFIXES.some(p => key.startsWith(p));
      expect(familyLike, `option in env family: ${key}`).toBe(false);
    }
  });

  it('keeps PagerEnv covering every env consumer in the source', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');

    const names = new Set<string>();
    const prefixes = new Set<string>();

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) {
          const src = fs.readFileSync(full, 'utf8');

          for (const m of src.matchAll(
            /(?:lgetenv|envInteger|envDelay)\(\s*'([A-Z_0-9]+)'/g
          )) {
            names.add(m[1]);
          }

          // computed families: lgetenv(`PREFIX_${...}`)
          for (const m of src.matchAll(/lgetenv\(`([A-Z_0-9]+_)\$\{/g)) {
            prefixes.add(m[1]);
          }
        }
      }
    };

    walk(path.join(process.cwd(), 'src'));

    const known = new Set<string>(PAGER_ENV_NAMES);

    for (const name of names) {
      const family = PAGER_ENV_PREFIXES.some(p => name.startsWith(p));
      expect(known.has(name) || family, `missing env name: ${name}`)
        .toBe(true);
    }

    for (const prefix of prefixes) {
      expect(PAGER_ENV_PREFIXES).toContain(prefix);
    }

    // the ternary-selected pair no grep can see
    expect(known.has('LESS') && known.has('MORE')).toBe(true);
  });

  it('pages input with no lines as an empty file', async () => {
    // a symbol is the one input inputToString has no line for: it
    // opens an empty session like og, rather than refusing to run
    const nothing = await drive(() => pager(Symbol('nothing')));
    const empty = await drive(() => pager(''));

    expect(nothing).toBe(empty);
  });

  it('leaves objects flat without tab-object', async () => {
    const flat = await drive(() => pager({ a: 1, b: 2 }));

    expect(flat).toContain('{"a":1,"b":2}');
  });

  it('pretty-prints objects on the tabs option stops', async () => {
    // opt is a process-wide singleton no session restores, so a -x
    // from an earlier call would carry into the default case below
    const savedStops = opt.tabStops.slice();
    const savedDefault = opt.tabDefault;

    const narrow = await drive(
      () => pager({ a: 1 }, { 'tab-object': true, tabs: 4 })
    );
    expect(narrow).toContain('    "a": 1');
    expect(narrow).not.toContain('        "a": 1');

    // the -x spelling reaches the same option through the env
    const fromEnv = await drive(
      () => pager({ a: 1 }, { 'tab-object': true, LESS: '-x3' })
    );
    expect(fromEnv).toContain('   "a": 1');

    opt.tabStops = savedStops;
    opt.tabDefault = savedDefault;

    // without tabs the indent is less's default 8-column stop
    const plain = await drive(() => pager({ a: 1 }, { 'tab-object': true }));
    expect(plain).toContain('        "a": 1');
  });
});
