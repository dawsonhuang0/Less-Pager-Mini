import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";


export default defineConfig([
  // default config
  tseslint.configs.recommended,

  // JS + TS
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: {
      globals: globals.node
    },
    rules: {
      "max-len": ["warn", { code: 80 }],
      "eol-last": ["error", "always"],
      "semi": ["error", "always"],
    }
  },

  // TS: core no-unused-vars false-positives on type annotations;
  // @typescript-eslint/no-unused-vars covers it. no-undef is the same
  // story one step further: it cannot see ambient types, so NodeJS
  // and BufferEncoding read as undefined globals, and tsc already
  // rejects a genuinely undefined name
  {
    files: ["**/*.{ts,mts,cts}"],
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
    }
  },

  // A pager's subject matter IS control characters: \x1b in a regex
  // is the normal case here, not a suspicious one. src carried inline
  // disables at a dozen sites to say so; the rule earns nothing in
  // this repo
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    rules: {
      "no-control-regex": "off",
    }
  },
]);
