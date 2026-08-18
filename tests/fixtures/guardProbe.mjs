/*
 * Exercises the two-worker guard in a real node process.
 *
 * Not a vitest test: the guard blocks its thread in Atomics.wait and
 * spawns workers, and vitest's own worker pool will not schedule a
 * nested worker while the thread that owns it is blocked - the wait
 * simply never ends. A plain process has no such trouble, so the test
 * runs this and reads the JSON back.
 */
import { guardedMatch, endJsRegexGuard, jsRegexAborted, beginGuardedRun }
  from '../../dist/features/jsRegexGuard.js';

const never = () => false;
const out = {};
// each case is its own run, as a frame or a search would be
const step = name => { process.stderr.write('STEP ' + name + '\n');
  beginGuardedRun(); };

step('match');
out.match = guardedMatch(
  { source: '(a+)(b+)', flags: '', text: 'xxaaabbz', test: false },
  false, never).answer;

step('test');
out.test = guardedMatch(
  { source: 'a+b', flags: '', text: 'aaab', test: true }, false, never)
  .answer?.test;

step('miss');
out.miss = guardedMatch(
  { source: 'a+b', flags: '', text: 'aaa', test: true }, false, never)
  .answer?.test;

// 2^40 steps: this call cannot finish, and only the kill ends it
let polls = 0;
const started = Date.now();

step('killed');
out.killed = guardedMatch(
  { source: '(a+)+b', flags: '', text: 'a'.repeat(40), test: false },
  false, () => ++polls > 2).answer;

out.killedMs = Date.now() - started;
out.aborted = jsRegexAborted();

// and it still works afterwards, on a fresh pair of workers
step('after');
out.after = guardedMatch(
  { source: 'b+', flags: '', text: 'abbbc', test: false }, false, never)
  .answer;

// a subject too big for the buffer grows it rather than being refused
step('big');
out.big = guardedMatch(
  { source: 'x+$', flags: '', text: 'x'.repeat(3 << 20), test: true },
  false, never).answer?.test;

endJsRegexGuard();
process.stdout.write(JSON.stringify(out));
