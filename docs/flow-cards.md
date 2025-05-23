# Flow Cards

This document provides a detailed explanation of the flow cards implemented in the XPENG Car Manager Homey application.

## Overview

The XPENG Car Manager implements a set of flow cards that allow users to create automations based on vehicle state changes and to control vehicle functions. Flow cards are defined in the `.homeycompose/flow` directory and implemented in the `XpengDriver` class.

## Flow Card Types

Homey supports three types of flow cards:

- **Triggers**: Events that can start a flow (e.g., "When the battery level drops below 20%")
- **Conditions**: Checks that determine if a flow should continue (e.g., "If the vehicle is plugged in")
- **Actions**: Commands that perform an action (e.g., "Start charging")

## Implemented Flow Cards

### Trigger Cards

| Card ID | Title | Description |
|---------|-------|-------------|
| `battery_level_changed` | Battery level changed | Triggered when the battery level changes |
| `battery_level_below` | Battery level below | Triggered when the battery level drops below a threshold |
| `charging_started` | Charging started | Triggered when charging starts |
| `charging_stopped` | Charging stopped | Triggered when charging stops |
| `charging_completed` | Charging completed | Triggered when charging completes |
| `vehicle_plugged_in` | Vehicle plugged in | Triggered when the vehicle is plugged in |
| `vehicle_unplugged` | Vehicle unplugged | Triggered when the vehicle is unplugged |
| `vehicle_locked` | Vehicle locked | Triggered when the vehicle is locked |
| `vehicle_unlocked` | Vehicle unlocked | Triggered when the vehicle is unlocked |
| `climate_on` | Climate control on | Triggered when climate control is turned on |
| `climate_off` | Climate control off | Triggered when climate control is turned off |

### Condition Cards

| Card ID | Title | Description |
|---------|-------|-------------|
| `is_charging` | Is charging | Checks if the vehicle is charging |
| `is_plugged_in` | Is plugged in | Checks if the vehicle is plugged in |
| `is_locked` | Is locked | Checks if the vehicle is locked |
| `is_climate_on` | Is climate control on | Checks if climate control is on |
| `battery_level_above` | Battery level above | Checks if the battery level is above a threshold |
| `battery_level_below` | Battery level below | Checks if the battery level is below a threshold |

### Action Cards

| Card ID | Title | Description |
|---------|-------|-------------|
| `start_charging` | Start charging | Starts charging the vehicle |
| `stop_charging` | Stop charging | Stops charging the vehicle |
| `start_climate` | Start climate control | Starts climate control with a specified temperature |
| `stop_climate` | Stop climate control | Stops climate control |
| `lock_vehicle` | Lock vehicle | Locks the vehicle |
| `unlock_vehicle` | Unlock vehicle | Unlocks the vehicle |
| `refresh_data` | Refresh data | Refreshes vehicle data |

## Flow Card Implementation

### Trigger Cards

Trigger cards are registered in the `registerFlowTriggers` method of the `XpengDriver` class and triggered in the `handleFlowTriggers` method of the `XpengCarDevice` class.

```javascript
// In XpengDriver.js
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

// In XpengCarDevice.js
handleFlowTriggers(changedCapabilities) {
  // Handle battery level triggers
  if (changedCapabilities.includes('measure_battery')) {
    const batteryLevel = this.getCapabilityValue('measure_battery');
    
    // Trigger battery level changed
    this.driver.batteryLevelChangedTrigger.trigger(this, { battery_level: batteryLevel });
    
    // Trigger battery level below if applicable
    if (batteryLevel < 20) {
      this.driver.batteryLevelBelowTrigger.trigger(this, { battery_level: batteryLevel });
    }
  }
  
  // Handle charging state triggers
  if (changedCapabilities.includes('xpeng_charging_state')) {
    const chargingState = this.getCapabilityValue('xpeng_charging_state');
    
    if (chargingState === 'CHARGING') {
      this.driver.chargingStartedTrigger.trigger(this);
    } else if (chargingState === 'NOT_CHARGING') {
      this.driver.chargingStoppedTrigger.trigger(this);
    } else if (chargingState === 'COMPLETE') {
      this.driver.chargingCompletedTrigger.trigger(this);
    }
  }
  
  // Handle plugged in state triggers
  if (changedCapabilities.includes('xpeng_plugged_in')) {
    const pluggedIn = this.getCapabilityValue('xpeng_plugged_in');
    
    if (pluggedIn) {
      this.driver.vehiclePluggedInTrigger.trigger(this);
    } else {
      this.driver.vehicleUnpluggedTrigger.trigger(this);
    }
  }
  
  // Handle lock state triggers
  if (changedCapabilities.includes('locked')) {
    const locked = this.getCapabilityValue('locked');
    
    if (locked) {
      this.driver.vehicleLockedTrigger.trigger(this);
    } else {
      this.driver.vehicleUnlockedTrigger.trigger(this);
    }
  }
  
  // Handle climate control triggers
  if (changedCapabilities.includes('xpeng_climate_on')) {
    const climateOn = this.getCapabilityValue('xpeng_climate_on');
    
    if (climateOn) {
      this.driver.climateOnTrigger.trigger(this);
    } else {
      this.driver.climateOffTrigger.trigger(this);
    }
  }
}
```

### Condition Cards

Condition cards are registered in the `registerFlowConditions` method of the `XpengDriver` class.

```javascript
registerFlowConditions() {
  // Charging conditions
  this.homey.flow.getConditionCard('is_charging')
    .registerRunListener(async (args, state) => {
      return args.device.getCapabilityValue('xpeng_charging_state') === 'CHARGING';
    });
  
  this.homey.flow.getConditionCard('is_plugged_in')
    .registerRunListener(async (args, state) => {
      return args.device.getCapabilityValue('xpeng_plugged_in');
    });
  
  // Vehicle state conditions
  this.homey.flow.getConditionCard('is_locked')
    .registerRunListener(async (args, state) => {
      return args.device.getCapabilityValue('locked');
    });
  
  this.homey.flow.getConditionCard('is_climate_on')
    .registerRunListener(async (args, state) => {
      return args.device.getCapabilityValue('xpeng_climate_on');
    });
  
  // Battery level conditions
  this.homey.flow.getConditionCard('battery_level_above')
    .registerRunListener(async (args, state) => {
      return args.device.getCapabilityValue('measure_battery') > args.battery_level;
    });
  
  this.homey.flow.getConditionCard('battery_level_below')
    .registerRunListener(async (args, state) => {
      return args.device.getCapabilityValue('measure_battery') < args.battery_level;
    });
}
```

### Action Cards

Action cards are registered in the `registerFlowActions` method of the `XpengDriver` class.

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

## Flow Card Definitions

Flow cards are defined in JSON files in the `.homeycompose/flow` directory. Each flow card has a JSON definition file that specifies its properties.

```json
// Example: battery_level_below.json (trigger)
{
  "id": "battery_level_below",
  "title": {
    "en": "Battery level dropped below"
  },
  "hint": {
    "en": "Triggered when the battery level drops below the specified percentage."
  },
  "args": [
    {
      "name": "battery_level",
      "type": "number",
      "title": {
        "en": "Battery Level"
      },
      "min": 0,
      "max": 100,
      "step": 1,
      "placeholder": {
        "en": "20"
      }
    }
  ]
}

// Example: is_charging.json (condition)
{
  "id": "is_charging",
  "title": {
    "en": "Vehicle !{{is|is not}} charging"
  },
  "hint": {
    "en": "Checks if the vehicle is currently charging."
  }
}

// Example: start_charging.json (action)
{
  "id": "start_charging",
  "title": {
    "en": "Start charging"
  },
  "hint": {
    "en": "Starts charging the vehicle. The vehicle must be plugged in."
  }
}
```

## Flow Card Examples

Here are some examples of flows that can be created with the flow cards:

1. **Notify when charging completes**:
   - Trigger: "When charging completes"
   - Action: "Send a notification" with message "Your XPENG is fully charged"

2. **Start charging when electricity is cheap**:
   - Trigger: "When electricity price drops below X"
   - Condition: "Vehicle is plugged in"
   - Condition: "Vehicle is not charging"
   - Action: "Start charging"

3. **Preheat vehicle in the morning**:
   - Trigger: "When it's 7:00 AM"
   - Condition: "It's a weekday"
   - Condition: "Vehicle is plugged in"
   - Action: "Start climate control" with temperature 22°C

4. **Notify when battery is low**:
   - Trigger: "When battery level drops below 20%"
   - Action: "Send a notification" with message "Your XPENG battery is low"

5. **Lock vehicle when leaving home**:
   - Trigger: "When no one is home"
   - Condition: "Vehicle is not locked"
   - Action: "Lock vehicle"

## Conclusion

The flow cards in the XPENG Car Manager Homey application provide a powerful way for users to create automations based on vehicle state changes and to control vehicle functions. They enable users to integrate their XPENG vehicles with other smart home devices and services.
