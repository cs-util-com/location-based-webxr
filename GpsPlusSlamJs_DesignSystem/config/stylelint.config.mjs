/** @type {import('stylelint').Config} */
// Copied from the demo apps' config (GpsPlusSlamJs_AnchorStarter/config/),
// minus the HTML override: this package's CSS lives in .css files since the
// 2026-08-27 split, and until this config existed nothing linted it at all -
// the sheet the apps are about to vendor was checked by prettier only
// (adoption-plan review, 2026-08-27).
export default {
  extends: ["stylelint-config-standard"],
  plugins: ["@carlosjeurissen/stylelint-csstree-validator"],
  rules: {
    // Catch invalid CSS values (e.g., "color: 12px", "width: red").
    // This is the primary defense against LLM "hallucinated" properties.
    "csstree/validator": true,

    // Disable formatting rules - Prettier handles these.
    "rule-empty-line-before": null,
    "comment-empty-line-before": null,
    "declaration-empty-line-before": null,

    // Flag !important usage - the reset's [hidden] guard and the
    // reduced-motion transition kill are the two legitimate uses.
    "declaration-no-important": [true, { severity: "warning" }],

    // The language's alphas are decimals everywhere they are quoted -
    // the brief, the decision log, the tokens' own comments - so
    // "rgb(52 58 80 / 0.35)" is the contract and "35%" would be drift.
    "alpha-value-notation": null,
    // BEM modifiers (.btn--icon, .anno--target) are the atom-variant
    // convention the brief documents; the standard pattern rejects the
    // double hyphen.
    "selector-class-pattern": [
      "^[a-z][a-z0-9]*(-[a-z0-9]+)*(--[a-z0-9]+(-[a-z0-9]+)*)?$",
      { message: "kebab-case, with an optional BEM --modifier" },
    ],
    // Source order follows the catalog's atom sections, not specificity;
    // every pair this rule flags targets a different element under a
    // different ancestor (a locate button's svg circle vs the diamond's).
    "no-descending-specificity": null,
    // No build step means no autoprefixer: the few prefixes here are
    // hand-kept where a target still needs them.
    "property-no-vendor-prefix": null,
    // Formatting - Prettier owns blank lines.
    "at-rule-empty-line-before": null,
  },
};
