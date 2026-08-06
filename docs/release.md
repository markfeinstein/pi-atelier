# Release checklist

Maintainers own releases for the divergent integration line. Contributors and agents must not publish packages, change release versions, create tags or releases, change npm dist-tags, or edit npm publishing credentials unless a maintainer explicitly asks for that release work.

Package identity:

- npm package: `@markfeinstein/pi-atelier`
- canonical branch: `integration`
- routine npm dist-tag: `integration`
- GitHub repository: `markfeinstein/pi-atelier`

## Preflight

1. Confirm the working copy is clean except for the intended release change.
2. Finalize `CHANGELOG.md` for the release and identify entries as upstream-candidate, upstreamed, fork-only, or local maintenance when that matters.
3. Confirm `package.json` and `package-lock.json` have the same version.
4. Run:

```bash
npm ci
npm run check
git diff --check origin/integration...HEAD
npm pack --dry-run --json
```

5. Inspect the dry-run package report for expected files, package name, version, repository, README assets, and excluded private files such as `.plans/`.

## Publish

The maintainer completes any npm browser authentication manually in their terminal. Agents must not request, accept, print, or pass an OTP.

Routine integration-line publish:

```bash
npm publish --access public --tag integration
```

Use `latest` only when the maintainer explicitly decides that this divergent line should become the default install target:

```bash
npm dist-tag add @markfeinstein/pi-atelier@<version> latest
```

## Verify

After publish, verify the registry state before pushing release refs:

```bash
npm view @markfeinstein/pi-atelier@<version> name version repository dist-tags
npm view @markfeinstein/pi-atelier dist-tags
```

Confirm that the `integration` dist-tag points to the new version. Confirm `latest` only if it was intentionally changed.

## Tag and release

After npm verification succeeds:

1. Commit or describe the release change.
2. Create a tag named `integration-v<version>`.
3. Push the release commit and tag.
4. Create a GitHub Release for the tag when release notes or large demo artifacts are useful.

## Rollback or correction

If a bad package is published, prefer a corrective patch release. Use npm deprecation only when users need an explicit warning:

```bash
npm deprecate @markfeinstein/pi-atelier@<bad-version> "Use @markfeinstein/pi-atelier@<fixed-version>."
```

Never unpublish without explicit maintainer approval and npm-policy review.
