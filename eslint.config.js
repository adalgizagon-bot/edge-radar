import js from "@eslint/js";
import ts from "typescript-eslint";
export default [
  { ignores: ["dist/**", "node_modules/**", "**/.wrangler/**"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["web/**/*.ts"],
    languageOptions: {
      globals: {
        document: "readonly",
        window: "readonly",
        crypto: "readonly",
        fetch: "readonly",
        HTMLElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLSelectElement: "readonly",
        HTMLFormElement: "readonly",
        URLSearchParams: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        AbortController: "readonly",
        console: "readonly",
      },
    },
  },
  {
    files: [
      "scripts/**/*.mjs",
      "tests/helpers/**/*.mjs",
      "playwright.config.mjs",
    ],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        Response: "readonly",
      },
    },
  },
  {
    files: [
      "cloud-monitor/**/*.mjs",
      "tests/runtime/**/*.mjs",
      "tests/monitor.test.mjs",
    ],
    languageOptions: {
      globals: {
        crypto: "readonly",
        console: "readonly",
        fetch: "readonly",
        Response: "readonly",
        AbortSignal: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    files: ["tests/ui/**/*.mjs"],
    languageOptions: { globals: { document: "readonly", window: "readonly" } },
  },
];
