/** @type {import('stylelint').Config} */
export default {
  extends: ["stylelint-config-standard"],
  plugins: ["@carlosjeurissen/stylelint-csstree-validator"],
  rules: {
    // Catch invalid CSS values (e.g., "color: 12px", "width: red").
    // This is the primary defense against LLM "hallucinated" properties.
    // Its syntax data predates container queries, which the landing's
    // drawn phones use for their text sizes (src/landing/*.css).
    "csstree/validator": {
      ignoreAtrules: ["container"],
      ignoreProperties: ["container-type"],
    },

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
        // Allow Tailwind @apply and other at-rules if we use them.
        "at-rule-no-unknown": [
          true,
          { ignoreAtRules: ["tailwind", "apply", "layer", "config"] },
        ],
      },
    },
    {
      // Parse <style> blocks in HTML files (the starter styles inline).
      files: ["**/*.html"],
      customSyntax: "postcss-html",
    },
  ],
};
