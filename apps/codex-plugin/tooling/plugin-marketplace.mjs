export function pluginMarketplace(pluginName, publicRelease = false) {
  return {
    name: publicRelease ? "mobile-dev" : "mobile-dev-local",
    interface: { displayName: publicRelease ? "Mobile Dev" : "Mobile Dev local" },
    plugins: [{
      name: pluginName,
      source: { source: "local", path: `./plugins/${pluginName}` },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Developer Tools",
    }],
  };
}
