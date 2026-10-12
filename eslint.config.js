"use strict";

/**
 * Flat config de ESLint. Solo JS vanilla de Node — sin TypeScript, sin plugins de
 * framework, sin build step (ver regla "Solo HTML, CSS y JavaScript" en CLAUDE.md).
 */
module.exports = [
  {
    ignores: ["node_modules/**", "data/viewer.html", "data/index.html", "graphify-out/**"],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "writable",
        exports: "writable",
        process: "readonly",
        console: "readonly",
        __dirname: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        Blob: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        Buffer: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
      eqeqeq: ["warn", "smart"],
      "no-var": "error",
      "prefer-const": "warn",
    },
  },
];
