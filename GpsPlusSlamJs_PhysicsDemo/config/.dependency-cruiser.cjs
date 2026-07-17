/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  options: {
    doNotFollow: { path: "node_modules" },
    includeOnly: "src",
    reporterOptions: { dot: { collapsePattern: "node_modules/[^/]*" } },
  },
  forbidden: [
    // Catch typos in import paths (unresolvable specifiers)
    {
      name: "not-to-unresolvable",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },

    // No circular dependencies (component dependency loops)
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
};
