/** @type {import('stylelint').Config} */
export default {
  extends: ["stylelint-config-standard"],
  plugins: ["@carlosjeurissen/stylelint-csstree-validator"],
  rules: {
    // Catch invalid CSS values (e.g., "color: 12px", "width: red").
    "csstree/validator": true,

    // Disable formatting rules — Prettier handles these.
    "rule-empty-line-before": null,
    "comment-empty-line-before": null,
    "declaration-empty-line-before": null,

    // Flag !important usage — legitimate uses exist but should be reviewed.
    "declaration-no-important": [true, { severity: "warning" }],
  },
  overrides: [
    {
      files: ["**/*.css"],
      rules: {
        "at-rule-no-unknown": [
          true,
          { ignoreAtRules: ["tailwind", "apply", "layer", "config"] },
        ],
      },
    },
    {
      // Parse <style> blocks in HTML files (the demo styles inline).
      files: ["**/*.html"],
      customSyntax: "postcss-html",
    },
  ],
};
