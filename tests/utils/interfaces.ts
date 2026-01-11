export interface TextRatio {
  thin: number;
  wide: number;
}

export interface TextOptions {
  ratios: TextRatio;
  ascii: boolean;
  ansi: boolean;
}

export interface TestCase {
  name: string;
  length: number;
  options: TextOptions;
}

export interface TestData {
  chars: string[];
  widths: number[];
}
