# Flow Actions

This document details the available flow actions in the Xpeng Homey integration. Flow actions allow users to automate various vehicle functions through Homey's flow system.

## Available Actions

### Start Charging
- **Action ID**: `start_charging`
- **Description**: Initiates the charging process for your Xpeng vehicle
- **Requirements**: Vehicle must be plugged in to a charging station
- **Usage**: Use in flows to automatically start charging at specific times or based on conditions

### Stop Charging
- **Action ID**: `stop_charging`
- **Description**: Stops the current charging session
- **Usage**: Can be used to stop charging based on various triggers (e.g., energy price thresholds)

### Refresh Data
- **Action ID**: `refresh_data`
- **Description**: Forces an immediate update of vehicle data
- **Usage**: Useful when you need the most current vehicle status
- **Note**: Regular updates happen automatically, this is for manual refresh

## Using Flow Actions

1. Open the Homey app
2. Go to Flow creation
3. Add an action card
4. Select your Xpeng vehicle
5. Choose the desired action

## Best Practices

- Avoid creating flows that rapidly start/stop charging
- Consider adding conditions to your flows (e.g., battery level checks)
- Use refresh_data sparingly to avoid unnecessary API calls

## Examples

### Night Charging Flow
```
When: Time is 23:00
And: Vehicle is connected to charger
Then: Start charging
```

### Peak Hours Flow
```
When: Energy price exceeds threshold
Then: Stop charging
```

## Troubleshooting

If flow actions fail:
1. Check vehicle connectivity
2. Verify Enode API credentials
3. Ensure vehicle is in appropriate state for action
4. Check Homey app logs for detailed error messages

## Updated Car Location Flow Card

The flow card **Car location matches coordinate** has been revised to handle GPS coordinates instead of addresses. Users can now either enter an address, which will automatically be converted to GPS coordinates using the integrated address conversion service, or directly input GPS coordinates (latitude and longitude) to ensure consistency with the Enode API output.

When using this flow card, specify the following parameters:
- **Latitude**: GPS coordinate in decimal degrees.
- **Longitude**: GPS coordinate in decimal degrees.
- **Radius (meters)**: The proximity threshold around the coordinates.

This update aligns the flow card with the GPS-based output from the Enode API, improving precision and reliability.
