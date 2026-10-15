# Dependencies

Use Node.js 22 for development and CI; the package requires Node.js 18 or newer. The Homey app requires Homey 12.4.5 or newer and uses SDK v3 supplied by Homey.

## Runtime

`node-fetch` 2.x provides CommonJS HTTP requests. Node's built-in modules provide hashing and other utilities. Enode is an external production service, not an installed SDK; see its [platform documentation](https://platform.enode.com/docs).

## Development

- Jest 30 runs the regression suite. See the [Jest 30 upgrade guide](https://jestjs.io/docs/upgrading-to-jest30).
- ESLint 8 uses `.eslintrc.json`. The unused Athom ESLint configuration and Homey ESLint plugin were removed because their peer dependencies conflicted with ESLint 8.
- Homey SDK type definitions, Prettier, and rimraf support development and packaging.
- The Homey CLI is installed separately for `homey app build` and validation. GitHub Actions uses the Homey validation/publication actions.

`package-lock.json` pins the resolved dependency tree. Use `npm ci` for a clean installation, followed by `npm run ci` and `homey app validate --level verified`.

Run `npm audit --omit=dev` for shipped dependencies and `npm audit` for the complete development tree. The [system audit](system-audit-2026-10-14.md) records the results and remaining development-tool findings for this release. Do not use automatic major upgrades or downgrades without checking compatibility and rerunning the suite.
