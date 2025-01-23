# Dependencies

This document outlines the key dependencies used in the Xpeng Homey integration.

## Core Dependencies

### Homey SDK
- **Purpose**: Core framework for Homey app development
- **Version**: As specified in package.json
- **Documentation**: [Homey Apps SDK](https://apps.developer.homey.app/)
- **Usage**: Provides the foundation for device communication and app functionality

### Enode API
- **Purpose**: Vehicle communication and control
- **Integration**: Used for all vehicle-related operations
- **Documentation**: [Enode API Documentation](https://docs.enode.io/)
- **Features Used**:
  - Vehicle authentication
  - Status monitoring
  - Command execution
  - Real-time updates

## Development Dependencies

### ESLint
- **Purpose**: Code quality and style enforcement
- **Configuration**: `.eslintrc.json`
- **Usage**: Maintains consistent code style and catches potential issues

## Runtime Dependencies

These are specified in `package.json` and include:
- Core Node.js modules
- Homey-specific packages
- Utility libraries

## Security Notes

- All dependencies are regularly updated for security
- Version pinning is used for stability
- Security audits are performed regularly

## Updating Dependencies

1. Review package.json for current versions
2. Test updates in development environment
3. Follow semantic versioning guidelines
4. Document any breaking changes

## Version Management

- Dependencies are locked in package-lock.json
- Major version updates require thorough testing
- Security updates are prioritized

## Troubleshooting

If you encounter dependency-related issues:
1. Check package versions
2. Verify compatibility
3. Review changelog for breaking changes
4. Clear node_modules and reinstall if needed
