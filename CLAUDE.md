# XPENG Car Manager Development Guide

## Build & Test Commands
- Build app: `npm run build`
- Production build: `npm run build:production`
- Run linting: `npm run lint`
- Run all tests: `npm run test`
- Run single test: `npx jest test/configValidation.test.js`
- Format code: `npm run format`
- Validate app: `npm run validate`
- Install locally: `npm run install:local`
- CI checks: `npm run ci`

## Code Style Guidelines
- Indentation: 4 spaces
- Quotes: Single quotes
- Semicolons: Required
- Line length: Keep under 100 characters
- Naming: camelCase for variables/functions, PascalCase for classes
- Error handling: Use try/catch for async operations
- Imports: Group by external modules, internal modules, then components
- API calls: Use the enode-api.js library for all Enode API interactions
- Schema validation: Use JSON schema for capability configurations
- Documentation: Add JSDoc comments for all functions

Homey app specifications: Follow Athom Homey guidelines for app structure.