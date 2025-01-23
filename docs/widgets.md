# Widgets Documentation

## Xpeng Vehicle Widget

The Xpeng integration includes a custom widget that provides at-a-glance information about your vehicle's status on the Homey dashboard.

### Features

- Real-time vehicle status display
- Battery level and range information
- Charging status and control
- Vehicle location (if available)
- Key vehicle metrics

### Widget Configuration

The widget is configured through `widget.compose.json`:
- Supports both light and dark themes
- Responsive design for different dashboard sizes
- Configurable refresh intervals

### API Integration

The widget communicates with the vehicle through `api.js`, which handles:
- Data fetching and updates
- Command execution
- Error handling
- State management

### User Interface

The widget interface is built using HTML/CSS/JavaScript and provides:
- Clean, modern design
- Intuitive controls
- Clear status indicators
- Touch-friendly interface

### Installation

1. The widget is automatically installed with the Xpeng app
2. Add it to your dashboard through the Homey interface:
   - Click "Add Widget"
   - Select "Xpeng Vehicle"
   - Choose your vehicle
   - Configure any available options

### Customization

Users can customize:
- Widget size on dashboard
- Update frequency
- Display preferences
- Visible metrics

### Preview Images

The widget includes preview images for both light and dark themes:
- `preview-light.png`
- `preview-dark.png`

### Technical Details

- Built on Homey's widget framework
- Uses real-time websocket updates
- Optimized for low resource usage
- Cached data management for quick loading

### Troubleshooting

Common issues and solutions:
1. Widget not updating
   - Check internet connection
   - Verify Enode API credentials
   - Refresh Homey dashboard

2. Missing data
   - Ensure vehicle is connected
   - Check app permissions
   - Verify data availability through Enode API

3. Display issues
   - Clear browser cache
   - Check Homey app version
   - Verify widget compatibility
