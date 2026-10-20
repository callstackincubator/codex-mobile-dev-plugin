const { withAppBuildGradle } = require("expo/config-plugins");

// The storage tool reads Android app data with `run-as`, which only works for debuggable
// builds. A debuggable release build runs without Metro and stays readable.
module.exports = function withDebuggableRelease(config) {
  return withAppBuildGradle(config, gradle => {
    if (!gradle.modResults.contents.includes("debuggable true")) {
      gradle.modResults.contents = gradle.modResults.contents.replace(/(\n\s*release\s*\{)/, "$1\n            debuggable true");
    }
    return gradle;
  });
};
