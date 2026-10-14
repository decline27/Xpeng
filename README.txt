XPENG Car Manager for Homey

This app allows you to integrate your XPENG electric vehicle with Homey, providing periodic monitoring and control of your car.

Setup Instructions:
1. Install the XPENG Car Manager app on your Homey
2. Add your vehicle:
   - Click "+ Add Device" in Homey
   - Select "XPENG Car Manager"
   - Click "Generate Connection Link"
   - Open the link in your browser to connect your XPENG account
   - Return to Homey and click "Continue"
   - Your vehicle will be added automatically

Features:
- Periodic battery level monitoring
- Charging status and control
- Location tracking
- Range monitoring
- Plug status detection
- Automated workflows with Homey Flow
- VIN-based deduplication (prevents duplicate devices)
- Adaptive polling based on vehicle state
- Health monitoring and automatic recovery

Advanced Features:
- VIN-Based Deduplication: The app uses the vehicle's VIN to identify unique cars and prevent duplicates
- OAuth2 Authentication: Secure token-based authentication ensures each user only sees their own vehicles
- Adaptive Polling: More frequent updates when your car is charging, less frequent when idle
- Health Monitoring: Automatic recovery attempts if connection issues are detected

Note: The app uses Enode's API to securely communicate with your XPENG vehicle. All necessary credentials are pre-configured, and you don't need to create an Enode account. Enode processes the vehicle connection and data. The dashboard widget uses OpenStreetMap Nominatim to look up addresses from rounded vehicle coordinates.

For support or questions, visit the Homey Community topic: https://community.homey.app/t/123375
Or contact: decline27@gmail.com

Requires Homey Pro with Homey 12.4.5 or newer. Homey Cloud is not supported.
New connections depend on available shared Enode capacity. Reinstalling does not add seats; use Repair on an existing car to preserve its Flows and history. Updates depend on XPENG and Enode and may be delayed. Odometer and forced vehicle refresh are unavailable when Enode does not support them. The charging limit is read-only.
