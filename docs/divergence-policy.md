# Divergence policy

This repository's `integration` branch is a permanent downstream line of Pi Atelier. It is allowed to contain both changes that later merge upstream and changes that remain fork-only.

There is no single fork point after which all changes are downstream-only. Treat divergence as a per-change property.

## Canonical line

- Canonical repository: `markfeinstein/pi-atelier`
- Canonical branch: `integration`
- Public package identity: `@markfeinstein/pi-atelier`
- npm dist-tag for routine divergent releases: `integration`

The upstream project remains useful for source reading and selective contribution, but contributors and agents must not rebase this line onto upstream `main` or assume upstream `main` is the review base.

## Change categories

Each significant change should be described as one of:

- **upstream candidate** — intended to be proposed upstream when it is small enough and aligned with upstream goals;
- **upstreamed** — already accepted upstream and kept here as part of normal history;
- **fork-only** — intentionally owned by this integration line;
- **local maintenance** — release, docs, CI, package identity, or automation work for this line.

Use `CHANGELOG.md`, issue descriptions, or pull request descriptions to record the category when it matters to future maintenance.

## Upstream imports

Upstream changes may be imported only by an explicit maintainer operation. Acceptable approaches are:

- cherry-pick a focused upstream change;
- manually port the behavior when history or structure has diverged;
- merge an upstream branch only when the maintainer intentionally wants the full merge and has reviewed the conflict surface.

Do not run broad rebases onto upstream `main` for ordinary development.

For an upstream import, validation must include:

```bash
npm run check
git diff --check origin/integration...HEAD
```

If conflicts occur, the importer owns conflict resolution, affected documentation, and any regression coverage needed for this line.

## Contributions

New work should branch from `origin/integration` and target `integration`. Pull request diffs and whitespace checks should compare against `origin/integration`, not upstream `main`.

If a change is intended for upstream too, keep that work small and document the upstream-candidate portion separately from fork-only behavior.

## Issues and releases

Issues for this line belong in `markfeinstein/pi-atelier` unless a maintainer explicitly says to file upstream. Routine releases publish the scoped package with the `integration` dist-tag; `latest` should be changed only as an intentional maintainer decision.
