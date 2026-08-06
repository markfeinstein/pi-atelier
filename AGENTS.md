Use available agent skills proactively whenever a request matches their purpose; the user does not need to name a skill explicitly. Briefly state which skill you are using and why. Do not use Superpowers unless the user explicitly requests it.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the five default canonical labels. See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses a single-context layout. See `docs/agents/domain.md`.

## npm publishing

This branch publishes as `@markfeinstein/pi-atelier` from the divergent `integration` line. Follow `docs/release.md`; routine releases use `npm publish --access public --tag integration`. The maintainer completes npm browser authentication manually in their terminal. Do not request, accept, or pass an OTP through the agent. After the maintainer reports success, verify the published version and the `integration` dist-tag before pushing the release commit and Git tag. Verify or change `latest` only when the maintainer explicitly promotes an integration release.
