import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import globals from "globals";

export default tseslint.config(
  // 全局忽略
  {
    ignores: [
      "node_modules/",
      "dist/",
      "dist-ssr/",
      "*.local",
      "public/vconsole.min.js",
    ],
  },

  // JavaScript 基础规则
  js.configs.recommended,

  // TypeScript 规则
  ...tseslint.configs.recommended,

  // Vue 规则
  ...pluginVue.configs["flat/recommended"],

  // Vue 文件中的 TypeScript 处理
  {
    files: ["*.vue", "**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".vue"],
      },
    },
  },

  // 项目自定义规则
  {
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // TypeScript 允许 any
      "@typescript-eslint/no-explicit-any": "off",
      // 未使用变量设为警告
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
      // Vue 组件名不强制多词
      "vue/multi-word-component-names": "off",
      // 允许空块（如 catch {}）
      "no-empty": "off",
      // 允许 switch case 中声明变量
      "no-case-declarations": "off",
      // 允许重复 case 标签（项目中用于联合消息类型）
      "no-duplicate-case": "off",
    },
  },

  // Prettier 关闭冲突规则
  eslintConfigPrettier,
);
