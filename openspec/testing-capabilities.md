## Testing Capabilities

**Strict TDD Mode**: enabled
**Detected**: 2026-08-26

### Test Runner

- `daemon/`: `cd daemon && node --test` (built-in Node.js test runner, CommonJS). Verified: 378 tests passing, 0 failing.
- `app/`: `cd app && node --test ui/lib/*.test.js` (built-in Node.js test runner). Verified: 12 tests passing, 0 failing.

### Test Layers

| Layer       | Available | Tool                                            |
| ----------- | --------- | ------------------------------------------------ |
| Unit        | ✅        | Node.js built-in `node --test` (daemon, app/ui)   |
| Integration | ⚠️        | `test-backend.js` (root) — manual REST/WS smoke suite, requires the daemon running on :8471 |
| E2E         | ⚠️        | `test-ui-e2e.js` (root) — manual Electron+CDP smoke suite, requires the daemon and app running with `--remote-debugging-port=9222` |

`test-backend.js` and `test-ui-e2e.js` are standalone harnesses (not wired into `node --test`, no npm script) and require live processes; treat them as manual/E2E smoke checks, not part of the automated regression gate.

### Coverage

- Available: ❌
- Command: — (no `c8`/`nyc` or equivalent configured in `daemon/` or `app/`)

### Quality Tools

| Tool         | Available | Command |
| ------------ | --------- | ------- |
| Linter       | ❌        | — (no ESLint config found in `daemon/` or `app/`) |
| Type checker | ❌        | — (plain JS, no TypeScript/JSDoc type-checking configured) |
| Formatter    | ❌        | — (no Prettier config found) |

### Notes

- No root-level `package.json`; `daemon/` and `app/` are independent Node packages, each with their own `package.json` and `node_modules/`.
- The SwiftUI companion (`HermesVoice/`) was removed on 2026-08-26: it drove the old Hermes TUI over a PTY, an architecture superseded by the Node daemon. The Electron app is the only client.
