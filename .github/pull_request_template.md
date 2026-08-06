## Summary

<!-- What problem does this solve, and what is the user-facing solution? -->

## Issue and scope

- [ ] I linked the issue for this change, when an issue was required.
- [ ] This PR targets the divergent `integration` branch.
- [ ] This PR contains one coherent change or user-facing behavior.
- [ ] Unrelated changes and non-goals are called out below or split into another PR.

**Issue:** <!-- #123, or "Not applicable — reason" for a typo/docs-only fix or narrowly scoped obvious bug fix. If unsure whether an issue is required, open one. -->

**Change category:** <!-- upstream-candidate, upstreamed, fork-only, local maintenance, or "Not applicable — reason". -->

**Scope / non-goals:** <!-- Include focused docs, tests, refactors, or maintenance when relevant. -->

## Validation

Update your branch from `origin/integration` before validating (see `CONTRIBUTING.md` for setup). Fill every applicable field; for a conditional field, write `Not applicable — reason` rather than leaving it blank.

- [ ] I ran `npm run check` (mandatory for every PR, including docs-only; it is the complete repository gate).
- [ ] I ran `git diff --check origin/integration...HEAD` against the updated integration branch.
- [ ] I added or updated regression tests through the relevant public/runtime seam for behavior changes.
- [ ] For configuration, event, or sidebar behavior, relevant edge cases are covered or explained below.
- [ ] For TUI changes (sidebar, footer, menu, or overlay), I manually validated with `npx --no-install pi -e .` (or an equivalent supported global `pi -e .`).
- [ ] For TUI changes, I provided a screenshot/recording URL or attached artifact, terminal dimensions/context, and observed result below.

**Commands and results:**

**Manual validation:** <!-- For TUI changes, include the command, terminal dimensions/context (for example OS, Pi version, and scenario), and observed result. Otherwise: "Not applicable — reason". -->

**Screenshots / recordings:** <!-- For TUI changes, provide a URL or identify the attached artifact. Otherwise: "Not applicable — reason". -->

## Documentation and compatibility

- [ ] I updated `README.md` and `CHANGELOG.md` under `Unreleased` when this user-visible change requires it.
- [ ] For significant divergence, I documented whether the change is upstream-candidate, upstreamed, fork-only, or local maintenance.
- [ ] Configuration or documentation impact is described below.
- [ ] Known limitations and compatibility considerations are described below.

**Config/docs impact:** <!-- Describe the impact, or: "Not applicable — reason". -->

**Known limitations:** <!-- Describe limitations/compatibility, or: "Not applicable — reason". -->

## Release safety

- [ ] This PR does not publish packages, change release versions, create tags/releases, change npm dist-tags, or edit npm publishing credentials.

<!-- Maintainers own merging, releases, and publishing for @markfeinstein/pi-atelier. -->
