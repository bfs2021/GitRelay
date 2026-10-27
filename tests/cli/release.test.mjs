import assert from "node:assert/strict";
import { test } from "node:test";

import { validateRelease } from "../../scripts/check-release.mjs";

test("release metadata rejects mismatched versions and unrecorded tags", () => {
  const pkg = { name: "git-relay", version: "0.1.0" };
  const lock = { ...pkg, packages: { "": pkg } };
  const changelog = "# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-10-27\n";
  assert.doesNotThrow(() => validateRelease(pkg, lock, pkg, changelog));
  assert.doesNotThrow(() => validateRelease(pkg, lock, pkg, changelog, "v0.1.0"));
  assert.throws(() => validateRelease(pkg, lock, { ...pkg, version: "0.2.0" }, changelog), /versions must match/);
  assert.throws(
    () => validateRelease(pkg, { ...lock, packages: { "": { ...pkg, version: "0.2.0" } } }, pkg, changelog),
    /versions must match/,
  );
  assert.throws(() => validateRelease(pkg, lock, pkg, changelog, "v0.2.0"), /tag must match/);
  assert.throws(() => validateRelease(pkg, lock, pkg, "\n## [Unreleased]\n", "v0.1.0"), /dated changelog/);
});
