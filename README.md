# XPENG Car Manager for Homey

Transform your XPENG electric vehicle into an integral part of your smart home ecosystem. This app seamlessly connects your car with Homey, enabling intelligent automation and real-time monitoring that enhances both your driving and home automation experience.

## Key Features

### Comprehensive Vehicle Monitoring
- **Battery Management**: Real-time battery level tracking with customizable alerts
- **Charging Intelligence**: Monitor charging status, power delivery, and set charging notifications
- **Location Awareness**: Keep track of your vehicle's location and create location-based automations
- **Vehicle Analytics**: Access detailed information including range, odometer, and charging efficiency

### Smart Home Integration
- **Automated Routines**: Create flows that react to your car's status (e.g., turn on home heating when car is approaching)
- **Energy Management**: Optimize charging times based on your home's energy usage
- **Intelligent Notifications**: Get alerts for critical events like low battery or completed charging
- **Custom Triggers**: Build complex automations using multiple car-related conditions
- **VIN-Based Identification**: Automatic deduplication ensures each physical car appears only once

### Charging Optimization
- **Power Monitoring**: Track charging power and efficiency
- **Status Tracking**: Know exactly when your car starts and stops charging
- **Smart Alerts**: Get notified about charging events and battery levels
- **Range Monitoring**: Stay informed about your vehicle's current range

## Requirements
- XPENG Electric Vehicle (Compatible with all models)
- Homey Pro

## Setup Guide
1. Install the XPENG Car Manager app on your Homey
2. Add your vehicle through the Homey app:
   - Click "+ Add Device" in Homey
   - Select "XPENG Car Manager"
   - Click "Generate Connection Link"
   - Open the link in your browser to connect your XPENG account
   - Return to Homey and click "Continue"
   - Your vehicle will be added automatically
3. Configure your preferred monitoring settings and alerts

> **Note for Developers**: The app uses pre-configured Enode API credentials that are securely encrypted and stored. End users don't need to create an Enode account or configure any credentials.

## Project Improvements and Setup

### Naming and Schema Conventions
- Use consistent properties such as "readable" and "writable" in configuration files.
- Validate JSON configurations against a JSON schema where applicable.

### Code Quality
- Linting is enforced via ESLint. Run `npm run lint` to check for style issues.
- Code formatting is standardized with Prettier.

### Testing and CI
- Unit and integration tests are set up using Jest.
- Use `npm run test` for local testing.
- CI is configured to run linting and tests on each commit.

### Development Workflow
- Follow commit message guidelines and code review processes.

## Contribution Guidelines
- Fork the repository and create a feature branch.
- Follow the ESLint and Prettier code style guidelines.
- Submit pull requests with a clear description of your changes.

## Troubleshooting & FAQ
- Verify Node version (>=12.0.0).
- Run `npm run lint` and `npm run test` before pushing code.
- Report issues via [GitHub Issues](https://github.com/decline27/Xpeng/issues).

## Support
For questions, feature requests, or support:
- GitHub Issues: [Report a bug](https://github.com/decline27/Xpeng/issues)
- Email: decline27@gmail.com

## Privacy & Security
- All credentials are securely stored within Homey
- Enode API credentials are securely encrypted and stored by the Homey App Store
- No personal data is collected or stored outside your Homey
- Communication with XPENG servers is encrypted
- OAuth2 authentication ensures each user only sees their own vehicles
- Each user's vehicle data is isolated from other users, even though the app uses shared developer credentials
- VIN-based deduplication ensures each physical car appears only once in your Homey

## Advanced Features

### VIN-Based Deduplication
- The app uses the vehicle's VIN (Vehicle Identification Number) to identify unique cars
- If multiple entries for the same physical car exist, the app automatically selects the most recently seen one
- This prevents duplicate devices in your Homey and ensures you always see the most up-to-date data
- Device names include part of the VIN for easy identification

### Adaptive Polling
- The app automatically adjusts polling frequency based on vehicle state
- When your car is charging, data is refreshed more frequently
- This provides more accurate charging status while preserving battery life when idle

### Health Monitoring
- Periodic health checks verify connectivity with your vehicle
- Automatic recovery attempts if connection issues are detected
- Notifications for persistent connectivity problems