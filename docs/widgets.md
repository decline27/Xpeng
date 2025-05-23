# Widgets Documentation

## XPENG Vehicle Widget

The XPENG Car Manager includes a custom widget that provides at-a-glance information about your vehicle's status on the Homey dashboard.

### Features

- Real-time vehicle status display
- Battery level and range information
- Charging status and control
- Vehicle location (if available)
- Key vehicle metrics
- Adaptive polling to minimize API calls

### Widget Architecture

The widget follows a modular architecture with clear separation of concerns:

```
widgets/
└── vehicle-status/
    ├── assets/
    │   ├── icon.svg
    │   ├── preview-dark.png
    │   └── preview-light.png
    ├── widget.compose.json
    ├── widget.html
    ├── widget.css
    └── widget.js
```

### Widget Configuration

The widget is configured through `widget.compose.json`:

```json
{
  "id": "vehicle-status",
  "name": {
    "en": "XPENG Vehicle Status"
  },
  "description": {
    "en": "Display your XPENG vehicle status and control charging"
  },
  "images": {
    "small": "assets/icon.svg",
    "large": "assets/icon.svg"
  },
  "preview": {
    "light": "assets/preview-light.png",
    "dark": "assets/preview-dark.png"
  },
  "settings": [
    {
      "id": "device",
      "type": "device",
      "filter": "driver_id=cars",
      "label": {
        "en": "XPENG Vehicle"
      }
    },
    {
      "id": "refresh_interval",
      "type": "dropdown",
      "label": {
        "en": "Refresh Interval"
      },
      "values": [
        {
          "id": "30",
          "label": {
            "en": "30 seconds"
          }
        },
        {
          "id": "60",
          "label": {
            "en": "1 minute"
          }
        },
        {
          "id": "300",
          "label": {
            "en": "5 minutes"
          }
        }
      ],
      "default": "60"
    }
  ]
}
```

### API Integration

The widget communicates with the vehicle through the Homey API, which provides:

- **Device Capabilities**: Access to vehicle capabilities like battery level, charging status, etc.
- **Device Actions**: Ability to execute actions like start/stop charging
- **Real-time Updates**: Subscription to capability changes for real-time updates

```javascript
// Example of API integration in widget.js
Homey.api('GET', `/device/${this.settings.device}`)
  .then(device => {
    // Update widget with device data
    this.updateWidgetData(device);
  })
  .catch(error => {
    // Handle error
    this.showError(error);
  });
```

### User Interface

The widget interface is built using HTML/CSS/JavaScript and provides:

```html
<!-- Example of widget.html structure -->
<div class="vehicle-status-widget">
  <div class="header">
    <img class="vehicle-icon" data-src="{{vehicle_icon}}" />
    <div class="vehicle-info">
      <div class="vehicle-name">{{vehicle_name}}</div>
      <div class="vehicle-model">{{vehicle_model}}</div>
    </div>
  </div>

  <div class="battery-section">
    <div class="battery-icon" style="width: {{battery_percentage}}%"></div>
    <div class="battery-info">
      <div class="battery-percentage">{{battery_percentage}}%</div>
      <div class="battery-range">{{battery_range}} km</div>
    </div>
  </div>

  <div class="charging-section {{charging_status}}">
    <div class="charging-status">{{charging_status_text}}</div>
    <div class="charging-controls">
      <button class="start-charging" data-action="start-charging">Start</button>
      <button class="stop-charging" data-action="stop-charging">Stop</button>
    </div>
  </div>

  <div class="location-section">
    <div class="location-icon"></div>
    <div class="location-info">{{location_text}}</div>
  </div>

  <div class="footer">
    <div class="last-updated">Updated: {{last_updated}}</div>
    <button class="refresh-button" data-action="refresh">Refresh</button>
  </div>
</div>
```

The widget provides:
- Clean, modern design with responsive layout
- Intuitive controls for charging and data refresh
- Clear status indicators for battery, charging, and vehicle state
- Touch-friendly interface with large tap targets
- Real-time updates through Homey's capability system

### Data Handling

The widget handles data through a combination of:

1. **Initial Load**: Fetches all vehicle data when the widget is first loaded
2. **Capability Subscriptions**: Subscribes to capability changes for real-time updates
3. **Periodic Refresh**: Refreshes data at the configured interval
4. **Manual Refresh**: Allows user to manually refresh data

```javascript
// Example of data handling in widget.js
class VehicleStatusWidget extends Homey.Widget {
  onInit() {
    // Initial data load
    this.loadVehicleData();

    // Subscribe to capability changes
    this.homey.devices.subscribe(this.settings.device, 'measure_battery', this.onBatteryChange.bind(this));
    this.homey.devices.subscribe(this.settings.device, 'charging_state', this.onChargingStateChange.bind(this));

    // Set up periodic refresh
    const refreshInterval = parseInt(this.settings.refresh_interval) * 1000;
    this.refreshTimer = setInterval(this.loadVehicleData.bind(this), refreshInterval);

    // Set up manual refresh button
    document.querySelector('.refresh-button').addEventListener('click', this.onRefreshClick.bind(this));

    // Set up charging control buttons
    document.querySelector('.start-charging').addEventListener('click', this.onStartChargingClick.bind(this));
    document.querySelector('.stop-charging').addEventListener('click', this.onStopChargingClick.bind(this));
  }

  // Other methods...
}
```

### Installation

1. The widget is automatically installed with the XPENG Car Manager app
2. Add it to your dashboard through the Homey interface:
   - Click "Add Widget"
   - Select "XPENG Vehicle Status"
   - Choose your vehicle from the dropdown
   - Configure the refresh interval
   - Click "Save"

### Customization

Users can customize:
- Widget size on dashboard (1x1, 2x1, 2x2)
- Update frequency (30 seconds, 1 minute, 5 minutes)
- Vehicle selection (if multiple XPENG vehicles are available)
- Widget position on the dashboard

### Performance Considerations

The widget is designed with performance in mind:

- **Efficient DOM Updates**: Only updates the parts of the widget that have changed
- **Throttled API Calls**: Limits the frequency of API calls to reduce load
- **Capability Subscriptions**: Uses Homey's capability system for efficient updates
- **Cached Data**: Stores and reuses data when appropriate
- **Adaptive Refresh**: Adjusts refresh frequency based on vehicle state

### Troubleshooting

Common issues and solutions:

1. **Widget not updating**
   - Check internet connection
   - Verify that the XPENG Car Manager app is running
   - Check if the vehicle is online in the Homey app
   - Try manually refreshing the widget
   - Restart the Homey app

2. **Missing data**
   - Ensure the vehicle is connected to Enode
   - Check if the vehicle is online
   - Verify that all required capabilities are supported
   - Try removing and re-adding the widget

3. **Charging controls not working**
   - Verify that the vehicle is plugged in
   - Check if the vehicle supports remote charging control
   - Ensure you have the necessary permissions
   - Try refreshing the vehicle data first
