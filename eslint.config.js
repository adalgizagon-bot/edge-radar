import js from "@eslint/js";
import ts from "typescript-eslint";
export default [
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["web/**/*.ts"],
    languageOptions: {
      globals: {
        document: "readonly",
        window: "readonly",
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
    files: ["scripts/**/*.mjs", "playwright.config.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly" } },
  },
  {
    files: ["cloud-monitor/**/*.mjs", "tests/monitor.test.mjs"],
    languageOptions: {
      globals: {
        fetch: "readonly",
        Response: "readonly",
        AbortSignal: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    files: ["tests/ui/**/*.mjs"],
    languageOptions: { globals: { document: "readonly", window: "readonly" } },
  },
];
