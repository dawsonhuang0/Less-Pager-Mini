import { expect } from 'vitest';

import { formatContent } from '../../src/helpers';

import {
  lineForward,
  lineBackward,
  windowForward
} from '../../src/features/moving';

/**
 * Moves forward through content and checks expected output lines.
 *
 * @param content - Full content array.
 * @param steps - Number of lines to move.
 * @param consecutive - Whether to move one step at a time.
 * @param expectedOutputs - Lines expected after movement.
 * @param expectedLines - Line indices to validate (default: [0]).
 */
export function implementLineForward(
  content: string[],
  steps: number,
  consecutive: boolean,
  expectedOutputs: string[],
  expectedLines: number[] = [0]
): void {
  if (consecutive) {
    for (let i = 0; i < steps; i++) lineForward(content, 1);
  } else if (steps > 0) {
    lineForward(content, steps);
  }

  checkOutputs(content, expectedOutputs, expectedLines);
}

/**
 * Moves backward through content and checks expected output lines.
 *
 * @param content - Full content array.
 * @param steps - Number of lines to move.
 * @param consecutive - Whether to move one step at a time.
 * @param expectedOutputs - Lines expected after movement.
 * @param expectedLines - Line indices to validate (default: [0]).
 */
export function implementLineBackward(
  content: string[],
  steps: number,
  consecutive: boolean,
  expectedOutputs: string[],
  expectedLines: number[] = [0]
): void {
  if (consecutive) {
    for (let i = 0; i < steps; i++) lineBackward(content, 1);
  } else if (steps > 0) {
    lineBackward(content, steps);
  }

  checkOutputs(content, expectedOutputs, expectedLines);
}

/**
 * 
 * @param content 
 * @param steps 
 * @param consecutive 
 * @param expectedOutputs 
 * @param expectedLines 
 */
export function implementWindowForward(
  content: string[],
  steps: string,
  consecutive: boolean,
  expectedOutputs: string[],
  expectedLines: number[] = [0]
) {
  const numSteps = parseInt(steps, 10) || -1;

  if (consecutive) {
    for (let i = 0; i < numSteps; i++) windowForward(content, '');
  } else if (numSteps > 0) {
    windowForward(content, steps);
  } else if (numSteps === -1) {
    windowForward(content, '');
  }

  checkOutputs(content, expectedOutputs, expectedLines);
}

/**
 * Verifies that rendered output matches expected lines.
 *
 * @param content - Full content array to format and check.
 * @param expectedOutputs - Expected strings for comparison.
 * @param expectedLines - Line indices to validate.
 */
function checkOutputs(
  content: string[],
  expectedOutputs: string[],
  expectedLines: number[]
) {
  const output = formatContent(content).split('\n');

  for (let i = 0; i < expectedLines.length; i++) {
    expect(output[expectedLines[i]]).toBe(expectedOutputs[i]);
  }
}
