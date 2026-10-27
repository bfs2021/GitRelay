# Changelog

## [Unreleased]

- Restrict maintained integrations to Codex and OpenCode v2, with sessions off by default.
- Require explicit session activation; preserve unread messages when disabling or migrating.
- Keep automatic branch synchronization blocked pending safe worktree binding.
- Stabilize the OpenCode lost-response regression around independently persisted receipts.
- Add formatting, unused-code and release-metadata checks to local validation and CI.
- Document source-release checks and reproducible benchmark evidence.

This section is not a published release. See [migration](docs/migration.md) for
behavior changes and [acceptance](docs/acceptance.md) for verified boundaries.
