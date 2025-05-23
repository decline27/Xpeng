# Device Capabilities

This document provides a detailed explanation of the device capabilities implemented in the XPENG Car Manager Homey application.

## Overview

The XPENG Car Manager implements a set of device capabilities that represent the state and functionality of XPENG vehicles. These capabilities are used to display vehicle information in the Homey app and to trigger flows based on vehicle state changes.

## Capability Types

Homey supports several types of capabilities:

- **Sensor Capabilities**: Read-only capabilities that represent sensor values (e.g., battery level)
- **Actuator Capabilities**: Capabilities that can be controlled (e.g., charging state)
- **Boolean Capabilities**: Capabilities that represent on/off states (e.g., is plugged in)
- **Numeric Capabilities**: Capabilities that represent numeric values (e.g., range in km)
- **String Capabilities**: Capabilities that represent text values (e.g., vehicle model)
- **Enum Capabilities**: Capabilities that represent a set of predefined values (e.g., charging state)

## Implemented Capabilities

The XPENG Car Manager implements the following capabilities:

### Standard Capabilities

| Capability | Type | Description | Unit |
|------------|------|-------------|------|
| `measure_battery` | Numeric | Battery level | % |
| `alarm_battery` | Boolean | Low battery alarm | - |
| `locked` | Boolean | Vehicle lock state | - |
| `meter_power` | Numeric | Charging power | kW |
| `measure_temperature` | Numeric | Interior temperature | °C |

### Custom Capabilities

| Capability | Type | Description | Unit |
|------------|------|-------------|------|
| `xpeng_range` | Numeric | Estimated range | km |
| `xpeng_charging_state` | Enum | Charging state | - |
| `xpeng_plugged_in` | Boolean | Plugged in state | - |
| `xpeng_climate_on` | Boolean | Climate control state | - |
| `xpeng_location` | String | Vehicle location | - |
| `xpeng_odometer` | Numeric | Odometer reading | km |
| `xpeng_last_update` | String | Last update timestamp | - |

## Capability Implementation

The capabilities are implemented in the `XpengCarDevice` class in `drivers/cars/device.js`. The class registers the capabilities during initialization and updates them based on vehicle data.

```javascript
async onInit() {
  // Register capabilities
  this.registerCapabilities();
  
  // Set up polling
  this.setupPolling();
}

registerCapabilities() {
  // Register standard capabilities
  this.registerCapability('measure_battery', 'battery');
  this.registerCapability('alarm_battery', 'battery');
  this.registerCapability('locked', 'lock');
  this.registerCapability('meter_power', 'power');
  this.registerCapability('measure_temperature', 'temperature');
  
  // Register custom capabilities
  this.registerCapability('xpeng_range', 'range');
  this.registerCapability('xpeng_charging_state', 'charging');
  this.registerCapability('xpeng_plugged_in', 'plugged_in');
  this.registerCapability('xpeng_climate_on', 'climate');
  this.registerCapability('xpeng_location', 'location');
  this.registerCapability('xpeng_odometer', 'odometer');
  this.registerCapability('xpeng_last_update', 'last_update');
}
```

## Capability Mapping

The capabilities are mapped to vehicle data in the `updateCapabilities` method of the `XpengCarDevice` class.

```javascript
async updateCapabilities(data) {
  // Update standard capabilities
  this.setCapabilityValue('measure_battery', data.batteryLevel);
  this.setCapabilityValue('alarm_battery', data.batteryLevel < 20);
  this.setCapabilityValue('locked', data.locked);
  this.setCapabilityValue('meter_power', data.chargingPower || 0);
  this.setCapabilityValue('measure_temperature', data.interiorTemperature);
  
  // Update custom capabilities
  this.setCapabilityValue('xpeng_range', data.range);
  this.setCapabilityValue('xpeng_charging_state', data.chargingState);
  this.setCapabilityValue('xpeng_plugged_in', data.pluggedIn);
  this.setCapabilityValue('xpeng_climate_on', data.climateOn);
  this.setCapabilityValue('xpeng_location', this.formatLocation(data.location));
  this.setCapabilityValue('xpeng_odometer', data.odometer);
  this.setCapabilityValue('xpeng_last_update', new Date().toISOString());
}
```

## Flow Triggers

The capabilities are used to trigger flows based on vehicle state changes. The flow triggers are registered in the `XpengDriver` class in `drivers/cars/driver.js`.

```javascript
onInit() {
  // Register flow triggers
  this.registerFlowTriggers();
}

registerFlowTriggers() {
  // Battery level triggers
  this.batteryLevelChangedTrigger = this.homey.flow.getDeviceTriggerCard('battery_level_changed');
  this.batteryLevelBelowTrigger = this.homey.flow.getDeviceTriggerCard('battery_level_below');
  
  // Charging state triggers
  this.chargingStartedTrigger = this.homey.flow.getDeviceTriggerCard('charging_started');
  this.chargingStoppedTrigger = this.homey.flow.getDeviceTriggerCard('charging_stopped');
  this.chargingCompletedTrigger = this.homey.flow.getDeviceTriggerCard('charging_completed');
  
  // Vehicle state triggers
  this.vehiclePluggedInTrigger = this.homey.flow.getDeviceTriggerCard('vehicle_plugged_in');
  this.vehicleUnpluggedTrigger = this.homey.flow.getDeviceTriggerCard('vehicle_unplugged');
  this.vehicleLockedTrigger = this.homey.flow.getDeviceTriggerCard('vehicle_locked');
  this.vehicleUnlockedTrigger = this.homey.flow.getDeviceTriggerCard('vehicle_unlocked');
  
  // Climate control triggers
  this.climateOnTrigger = this.homey.flow.getDeviceTriggerCard('climate_on');
  this.climateOffTrigger = this.homey.flow.getDeviceTriggerCard('climate_off');
}
```

## Flow Actions

The capabilities are also used to implement flow actions. The flow actions are registered in the `XpengDriver` class in `drivers/cars/driver.js`.

```javascript
registerFlowActions() {
  // Charging actions
  this.homey.flow.getActionCard('start_charging')
    .registerRunListener(async (args, state) => {
      return await args.device.startCharging();
    });
  
  this.homey.flow.getActionCard('stop_charging')
    .registerRunListener(async (args, state) => {
      return await args.device.stopCharging();
    });
  
  // Climate control actions
  this.homey.flow.getActionCard('start_climate')
    .registerRunListener(async (args, state) => {
      return await args.device.startClimate(args.temperature);
    });
  
  this.homey.flow.getActionCard('stop_climate')
    .registerRunListener(async (args, state) => {
      return await args.device.stopClimate();
    });
  
  // Vehicle actions
  this.homey.flow.getActionCard('lock_vehicle')
    .registerRunListener(async (args, state) => {
      return await args.device.lockVehicle();
    });
  
  this.homey.flow.getActionCard('unlock_vehicle')
    .registerRunListener(async (args, state) => {
      return await args.device.unlockVehicle();
    });
  
  // Data actions
  this.homey.flow.getActionCard('refresh_data')
    .registerRunListener(async (args, state) => {
      return await args.device.refreshData();
    });
}
```

## Capability Definitions

The custom capabilities are defined in the `.homeycompose/capabilities` directory. Each capability has a JSON definition file that specifies its properties.

```json
// Example: xpeng_charging_state.json
{
  "type": "enum",
  "title": {
    "en": "Charging State"
  },
  "getable": true,
  "setable": false,
  "uiComponent": "sensor",
  "values": [
    {
      "id": "CHARGING",
      "title": {
        "en": "Charging"
      }
    },
    {
      "id": "NOT_CHARGING",
      "title": {
        "en": "Not Charging"
      }
    },
    {
      "id": "COMPLETE",
      "title": {
        "en": "Complete"
      }
    },
    {
      "id": "WAITING",
      "title": {
        "en": "Waiting"
      }
    },
    {
      "id": "ERROR",
      "title": {
        "en": "Error"
      }
    }
  ]
}
```

## Capability Insights

The capabilities are configured to provide insights in the Homey app. Insights allow users to view historical data for capabilities.

```json
// Example: measure_battery.json
{
  "type": "number",
  "title": {
    "en": "Battery"
  },
  "getable": true,
  "setable": false,
  "uiComponent": "sensor",
  "units": {
    "en": "%"
  },
  "decimals": 0,
  "min": 0,
  "max": 100,
  "insights": true,
  "chartType": "stepLine"
}
```

## Conclusion

The device capabilities in the XPENG Car Manager Homey application provide a comprehensive representation of XPENG vehicles. They enable users to monitor vehicle state, control vehicle functions, and create automations based on vehicle state changes.
