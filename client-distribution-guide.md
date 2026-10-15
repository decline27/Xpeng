# Enode account configuration

The app supports several Enode production clients. Adding credentials does not grant production access or increase an account's plan limit. Capacity is enforced by Enode and shared across Homey installations.

## How selection works

- A returning user is linked through the client that already has their linked vendor. Empty users left by abandoned pairing attempts do not pin later attempts to that client.
- Repair reuses the existing car's user ID and client where available, including legacy user IDs.
- New users start with the configured default, or the first configured client, and try the other configured clients if link creation fails.
- Vehicle IDs and VINs are mapped to their hosting client. These local mappings are not a count of the global fleet or of available seats.
- A failed account lookup is not treated as proof that the user is new.

## Add an approved production client

1. Confirm that the owner is willing and authorized to grant access or transfer the account. Confirm the process with Enode, along with production access, XPENG support, connection allowance, existing usage, and any costs. Do not assume an existing free allowance transfers to another owner.
2. Keep all existing credential pairs and their suffixes unchanged. Use the next unused suffix, for example `ENODE_CLIENT_ID_6` and `ENODE_CLIENT_SECRET_6`, in the private `env.json` used for the release. Never commit credentials.
3. Run `npm run accounts:check -- 6`. This obtains a machine token and reads production vehicles, printing only the count and access result. It does not link or disconnect users, send charging commands, or verify the client's maximum allowance.
4. Confirm the new credentials are also configured in the Homey App Store's environment for the next release. A local file alone does not update an already published app.
5. Run `npm run ci` and `homey app validate --level verified`, then test pairing, repair, and charging using a consenting test user's vehicle before general release.

Numbered clients can have gaps and extend beyond client 10. Restarted installations reload credentials even if they have a previously saved default. Secrets stay in memory rather than the client registry; rotated credentials use a new token cache entry.

`npm run accounts:check` checks all configured clients. A successful production read does not prove available seats, transfer approval, or charging permission for every car.

## Capacity and cleanup

The read-only audit on 14 October 2026 found five configured clients with 25 vehicles each, for 125 records. This is a snapshot, not a current availability promise.

Automatic duplicate cleanup is limited to this Homey's own identities and only removes a user when all their vehicles are identified as stale duplicates. Incomplete ownership information or pagination stops cleanup; a vehicle without a VIN protects its owner's other vehicles. No production links were removed during the audit.

Deleting a Homey device currently stops its local polling; it does not by itself unlink the Enode user. Do not promise that deletion immediately frees a shared seat. A user-level unlink can affect multiple cars and requires checking ownership and all vehicles first.

Enode's public [contact form](https://enode.com/contact) accepts production-access requests. The public information reviewed does not guarantee a new free production account or permit account transfers automatically.
