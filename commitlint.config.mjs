export default {
  extends: ["@commitlint/config-conventional"],
  defaultIgnores: false,
  ignores: [message => /^Merge (?:branch|pull request|remote-tracking branch) /.test(message)],
};
