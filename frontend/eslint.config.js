import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Warn on unused vars; allow underscore-prefixed to be ignored
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Allow `any` with a warning rather than an error
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  // Must come last — disables ESLint rules that conflict with Prettier formatting
  prettierConfig,
);
