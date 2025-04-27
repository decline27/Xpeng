XPENG Car Manager for Homey

This app allows you to integrate your XPENG electric vehicle with Homey, providing real-time monitoring and control of your car.

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
- Real-time battery level monitoring
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

Note: The app uses Enode's API to securely communicate with your XPENG vehicle. All necessary credentials are pre-configured, and you don't need to create an Enode account. No personal data is shared with third parties.

For support or questions, visit the Homey Community topic: https://community.homey.app/t/123375
Or contact: decline27@gmail.com
