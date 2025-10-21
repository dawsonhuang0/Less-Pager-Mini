# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Test Directory Overview

This directory contains the test suite for Less-Pager-Mini, a terminal pager library. Tests are organized by feature area and use Vitest as the test runner.

## Running Tests

```bash
# Run all tests in watch mode
npm test

# Run tests once with coverage
npm run coverage

# Run a specific test file
npx vitest tests/moving/lineForward.test.ts

# Run tests matching a pattern
npx vitest tests/moving/
```

## Test Structure

### Feature Tests
- `moving/`: Tests for navigation features (lineForward, lineBackward, windowForward)
- `jumping/`: Tests for jump-to-position features (planned/incomplete)
- `normalKeys.test.ts`: Tests for key-to-action mapping
- `readKey.test.ts`: Tests for async keyboard input reading

### Test Utilities
- `utils/mockContent.ts`: Mock content for testing with various character types (ASCII, CJK, emoji, long lines)
- `utils/testUtils.ts`: Helper functions for implementing common test patterns

## Testing Patterns

### Mock Content (`utils/mockContent.ts`)
The `text` array contains 50+ lines with diverse content:
- ASCII text of various lengths
- Wide characters (CJK: 你好, こんにちは, 안녕하세요)
- Emoji with varying widths
- Very long lines that exceed typical terminal width (80 chars)
- Mixed content combining ASCII, CJK, and emoji

The `content` array is a processed version used in tests.

### Testing Navigation Functions
Navigation tests typically:
1. Set up initial `config` state (row, screenWidth, window, etc.) in `beforeEach`
2. Call navigation functions like `lineForward(content, offset)`
3. Verify the resulting `config.row`, `config.subRow`, `config.col` values
4. Check rendered output or mode flags (EOF, INIT)

### State Management in Tests
- Import `config` and `mode` from `src/config` to inspect/modify global state
- Reset state in `beforeEach` hooks to ensure test isolation
- Common config properties:
  - `config.row`: Current content line index (0-based)
  - `config.subRow`: Position within wrapped long line
  - `config.col`: Horizontal scroll offset
  - `config.screenWidth`: Terminal width (typically 80)
  - `config.window`: Terminal height in lines (typically 24)
  - `config.chopLongLines`: Whether to chop or wrap long lines

## Architecture Context for Tests

### Sub-row System
Long lines exceeding `config.screenWidth` are broken into "sub-rows" when wrapping is enabled. Tests must account for both `row` (content line) and `subRow` (position within wrapped line).

### Character Width Handling
The pager uses `wcwidth-o1` to calculate visual width:
- ASCII characters: width 1
- CJK characters (你, 好): width 2 each
- Emoji: typically width 2
- ANSI escape codes: width 0 (stripped for width calculation)

### EOF Detection
Tests verify EOF (end-of-file) behavior:
- `mode.EOF` flag indicates viewport is at end
- Navigation functions should ring bell and not advance when at EOF
- EOF position depends on content length and window size
