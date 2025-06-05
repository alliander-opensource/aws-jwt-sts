const tsPlugin = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");
const importPlugin = require("eslint-plugin-import");
const jest = require("eslint-plugin-jest");
const pluginN = require("eslint-plugin-n");
const globals = require("globals");

/** @type {Array<object>} */
module.exports = [
  // Global ignores - files we don't want to lint at all
  {
    ignores: [
      "cdk.out/**",
      "node_modules/**",
      "**/*.js",
      "**/*.mjs",
      "**/*.cjs",
      "**/*.d.ts"
    ]
  },
  // TypeScript files configuration
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: __dirname,
        ecmaVersion: "latest",
        sourceType: "module"
      },
      globals: {
        ...globals.jest,
        ...globals.browser,
        ...globals.node,
        ...globals.commonjs,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      import: importPlugin,
      jest: jest,
      n: pluginN,
    },
    // All rules in one place for TypeScript files
    rules: {
      // Disabled rules
      "no-magic-numbers": "off",
      "no-new": "off", // Keep this off for AWS CDK patterns
      "sort-keys": "off",
      "one-var": "off",
      "max-classes-per-file": "off", // Off for CDK stack files
      "no-console": "off",  // Allow console in CDK project

      // Warning level rules
      "no-unused-vars": "warn",
      "no-undef": "warn",
      "no-undefined": "warn",
      "init-declarations": "warn",
      "sort-imports": "warn",
      "capitalized-comments": "warn",
      "max-lines-per-function": ["warn", { "max": 150 }], // Increased for CDK methods
      "max-statements": ["warn", 50],
      "prefer-destructuring": "warn",

      // Error level rules
      "prefer-const": "error",
      "no-var": "error",
      "no-duplicate-imports": "error",

      // Import plugin rules
      "import/no-unresolved": "error",
      "import/no-duplicates": "error",
      "import/order": ["warn", {
        "groups": ["builtin", "external", "internal", ["parent", "sibling"], "index"],
        "newlines-between": "always",
        "alphabetize": { "order": "asc", "caseInsensitive": true }
      }],

      // TypeScript specific rules
      "@typescript-eslint/explicit-function-return-type": ["warn", {
        "allowExpressions": true,
        "allowTypedFunctionExpressions": true
      }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],

      // Jest plugin rules
      "jest/no-disabled-tests": "warn",
      "jest/no-focused-tests": "error",
      "jest/no-identical-title": "error",
      "jest/valid-expect": "error"
    }
  }
];
