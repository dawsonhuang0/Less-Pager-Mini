import pager from ".";

pager(`/**
 * Generate a block of text to fill the terminal window with a repeating character.

function generateFilledString(): string {
  const columns = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const filler = '🟩';

  let result = '';

  for (let r = 0; r < rows; r++) {
    result += filler.repeat(columns) + '\n';
  }`);