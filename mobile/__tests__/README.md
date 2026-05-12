# Mobile test and screenshot workflow

This folder contains Jest tests for the Expo mobile app.

## Reliable local/CI test run

From repo root:

```bash
npm --prefix mobile ci
npm --prefix mobile test -- --runInBand
```

Why this sequence:
- `npm ci` guarantees devDependencies (including `jest`) are installed.
- `--runInBand` avoids worker parallelism issues in constrained CI containers.

## Quick troubleshooting

- `sh: 1: jest: not found` -> run `npm --prefix mobile ci` first.
- Expo web startup fetch/proxy failures -> prefer static export for screenshots.

## Deterministic screenshot path (without running dev server)

From `mobile/`:

```bash
CI=1 npx expo export --platform web
python3 -m http.server 4173 --directory dist
wkhtmltoimage --width 390 --height 844 http://127.0.0.1:4173 /tmp/mobile-preview.png
```

This uses a built web bundle, so it is less flaky than relying on live Metro startup in restricted environments.
