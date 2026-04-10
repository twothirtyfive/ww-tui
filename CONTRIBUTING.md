# Contributing

Thanks for helping improve `wuxiaworld-tui`.

## Local setup

```bash
npm install
npm test
npm run build
npm run build:binary
```

Use `npm run dev` while iterating on the TUI.

## Ground rules

- Do not commit real credentials, cookies, tokens, or copied chapter content.
- Keep fixtures and tests synthetic unless there is a strong reason not to.
- Prefer small, surgical changes with tests for auth, parsing, storage, and reader-state regressions.
- When changing login or session behavior, verify both the happy path and expired-session behavior.

## Before opening a PR

- Run `npm test`
- Run `npm run build`
- Run `npm run build:binary` if you changed packaging or startup behavior
- Update `README.md` if controls, setup, or behavior changed

## Cutting a release

- Push a tag like `v1.0.0` to trigger the GitHub release workflow.
- The workflow builds per-platform binaries and publishes checksum files alongside the release assets.
- If you later add code-signing or notarization, keep those credentials in GitHub Actions secrets rather than the repository.
