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

  // A promise is an object, so `if (!switchToFile(i))` is always
  // false and the recovery it guards is dead code. That shipped four
  // times over when the (press RETURN) gate went async, and nothing
  // caught it: tsc allows it, and the recommended preset cannot see
  // it without types. This is the one type-aware rule worth the
  // project service, and only its conditional half - the repo floats
  // promises deliberately, all over the key dispatch.
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
    },
    rules: {
      "@typescript-eslint/no-misused-promises": ["error", {
        checksConditionals: true,
        checksVoidReturn: false,
        checksSpreads: false,
      }],
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
