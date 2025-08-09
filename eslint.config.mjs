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
]);
