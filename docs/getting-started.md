# Getting started

You need Homey Pro with Homey 12.4.5 or newer, a supported XPENG vehicle, and your XPENG login. Homey Cloud is not supported by this app. End users do not need developer credentials; the app's shared Enode connection capacity must have space for a new connection.

1. Install XPENG Car Manager from the Homey App Store.
2. In Devices, choose Add Device, then XPENG Car Manager.
3. Generate a connection link and sign in to XPENG on the Enode connection page.
4. Return to Homey, press Continue, and choose your car.
5. In the device settings, choose your distance unit and update interval. You can also add the XPENG dashboard widget and select the car it should show.

Battery, range, location, charging status and charging controls depend on what XPENG supplies through Enode. Updates are periodic, not real-time. The idle interval is at least ten minutes; charging polls run every five minutes. A widget refresh displays the Homey device's stored values. The Refresh Vehicle Data Flow action requests the latest API data, but cannot guarantee newer measurements from the car.

## Reconnect an existing car

Use the device's Repair option and follow the Enode connection link. This preserves the Homey device, its Flows, and its history. Keep the existing device rather than deleting it and attempting a new connection when capacity is full.

## Troubleshooting

- **Shared capacity is full:** a seat or another approved production account is needed. Repeated pairing attempts and reinstalling do not increase the allowance.
- **Old readings:** compare Last Seen with the XPENG app. Enode can return old charging fields even when other fields update. XPENG vehicles observed in the audit do not support Enode's forced refresh capability.
- **No odometer:** this capability is hidden when Enode reports it unsupported.
- **Charging limit:** displayed when reported by Enode; setting it is not implemented. Use the XPENG app to change it.
- **Homey Cloud download error:** this release supports Homey Pro only.
- **Widget's selected car was removed:** select the correct car again. Charging commands will not fall back to a different car.

For maintainers adding a production client, see the [account configuration guide](../client-distribution-guide.md). For support, see the [community topic](https://community.homey.app/t/app-pro-xpeng-car-manager-for-homey/123375) or [GitHub issues](https://github.com/decline27/Xpeng/issues).
