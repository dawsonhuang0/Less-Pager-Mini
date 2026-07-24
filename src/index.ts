import paramPager from './pager/paramPager';
import streamPager, { pagerPipe } from './pager/streamPager';

async function pager(
  input: unknown,
  preserveFormat: boolean = false,
  examineFile: boolean = false
): Promise<void> {
  return examineFile
    ? streamPager(input)
    : paramPager(input, preserveFormat);
}

export { pagerPipe };

export default pager;

// CommonJS interop; ESM importers use the default export directly.
try {
  module.exports = pager;
  module.exports.default = pager;
  module.exports.pagerPipe = pagerPipe;
} catch {
  // ESM module records are frozen.
}
