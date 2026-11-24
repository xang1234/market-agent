// Typed lint for services/*. `npm run lint` runs one service per process, since
// one run over every service runs out of memory. A rule with hits on main is
// "warn" until they are fixed (#768).
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const injectClock = "Take the date as an input (wall clock in logic, #259 #611 #614).";

export default defineConfig(
  {
    files: ["services/*/{src,test}/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    // Services carry disable comments for rules this config does not enable.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      "@typescript-eslint/require-array-sort-compare": "warn",
      "@typescript-eslint/switch-exhaustiveness-check": "warn",
      "@typescript-eslint/no-floating-promises": ["error", {
        // node:test awaits its own top-level test() and describe() calls.
        allowForKnownSafeCalls: [{ from: "package", package: "node:test", name: ["test", "describe", "it", "suite"] }],
      }],
      "@typescript-eslint/no-misused-promises": "warn",
      "no-empty": ["error", { allowEmptyCatch: false }],
    },
  },
  {
    files: ["services/*/src/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["warn",
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: injectClock },
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: injectClock },
      ],
    },
  },
);
