# System audit — 14 October 2026

Release candidate: **1.3.2**. This audit covers the Homey Pro app, account selection, pairing and repair, vehicle updates, Flows, dashboard controls, packaging, and the path to adding an approved production account. It does not establish that every vehicle works in production.

## Verified findings

- The original automated suite passed 414 tests. The revised suite passes **444 tests across 27 suites**, including regression coverage for the issues below. Lint has zero errors (14 existing warnings in development/test helpers). Homey build and strict `verified` validation pass. The runtime dependency audit reports zero known vulnerabilities; a scan of the generated package found no configured client secrets or `env.json`.
- Read-only production authentication and vehicle enumeration succeeded for all five configured clients. Each returned 25 records, with no further page: **125 connected vehicle records**. Credentials, tokens, VINs, locations, and user IDs are not included in this report.
- The updated discovery and deduplication code was also checked against the live read-only inventory: all 125 observed owner identities received exactly their own records. This checks filtering against real response shapes, not commands on each owner's Homey.
- A live XPENG sample reported odometer and forced refresh unsupported; charging start/stop were supported. This is a sample, not a guarantee for every car. No charging command was sent.
- The connected Homey reported an XPENG G6 with Last Seen on 14 October 2026. This observation was from the installed app, before this candidate was deployed.
- No users were disconnected, no account was transferred, no extra seats were created, and no app update was installed or published during the audit.

## Fixes in the candidate

| Area | Corrected behavior |
| --- | --- |
| Several cars in one household | Existing authorized VINs no longer hide a newly linked second car. The owner's copy takes precedence over another user's copy of the same VIN. |
| Additional accounts | Registered accounts beyond primary/secondary work with the legacy mapping wrapper. Pairing and startup retain or correct the vehicle's hosting account. |
| Credential loading | A saved default no longer prevents reloading credentials. Numbered accounts can have gaps and exceed ten. Secrets are isolated by Homey instance and kept out of the registry. |
| Token rotation | Replaced credentials do not reuse the old machine token or share its pending request. |
| Pairing and repair | Empty users left by abandoned attempts do not pin future attempts to a full client. Account lookup has bounded requests and does not treat outages as proof of a new user. Repair retains the existing user identity and client where available. |
| Errors | Connection-limit failures are explained as shared capacity, including HTTP 403 responses. Authentication failures and malformed inventories no longer silently mean an empty garage. |
| Updates | Data age comes from Enode's timestamps rather than the time an HTTP poll succeeded. Manual refresh bypasses cached vehicle readings, and unsupported wake requests are skipped after capabilities are known. |
| Startup | Failure to read initial data leaves the device unavailable while polling retries continue. |
| Widget | A missing selected car cannot redirect charging to another car. Range labels follow the chosen km/miles unit. |
| Duplicate cleanup | Missing VINs protect the owner's other vehicles; missing ownership or incomplete pagination prevents cleanup. No live cleanup was executed. |
| CI | Validation and publication workflows run lint and regression tests before their Homey action. |

## External limits and unresolved release checks

- **Seats:** all five clients were at the stated 25-vehicle allowance. Adding a configuration key does not create capacity. No entitlement to a further free production account was established.
- **Data delays:** a successful read can still contain old XPENG measurements, including independently stale charging fields. The app cannot manufacture newer data or enable an unsupported Enode wake capability. GPS is not a real-time garage-opening signal.
- **Unsupported features:** the current app targets Homey Pro, not Homey Cloud. Odometer is hidden where unavailable. Charging-limit changes are not implemented.
- **Production smoke test:** after candidate installation, verify startup, the selected widget car, a manual refresh, and existing Flow conditions. Test charging only with a consenting user and a plugged-in car. New-user pairing requires an available approved seat. A mock-based pass is not a live-car command test.
- **Release:** candidate installation and public App Store publication remain pending. Version 1.3.2 is prepared in the source and changelog.
- **Account offer:** the user authorized emailing the person who offered an account. Gmail access and the recipient thread must be available before sending; at the time of writing the integration was unconnected and no browser connection was available. No message has been sent.

## Additional production account

The [account configuration guide](../client-distribution-guide.md) describes preserving existing clients and adding an approved pair as `ENODE_CLIENT_ID_6` / `ENODE_CLIENT_SECRET_6`. `npm run accounts:check -- 6` provides a read-only access/count check. Confirm transfer authorization, XPENG production access, limits, current usage, and charges with the owner and Enode before treating it as extra capacity.

Enode's public [contact form](https://enode.com/contact) includes production-access inquiries; its public documentation and API-reference links redirect to sign-in. The material available publicly does not promise free production access or automatically transferable account allowances.

## Reported issues reviewed

- [Homey community, recent reports](https://community.homey.app/t/app-pro-xpeng-car-manager-for-homey/123375?page=8): pairing errors, delays in charging fields, capacity, charging-limit control, and data freezing after an update.
- [GitHub #8](https://github.com/decline27/Xpeng/issues/8): generic connection-link errors.
- [GitHub #7](https://github.com/decline27/Xpeng/issues/7): updates stopping after pairing.
- [GitHub #9](https://github.com/decline27/Xpeng/issues/9): installing on Homey Cloud, outside the supported platform.

The corresponding source fixes and tests reduce the app-side failure modes. These reports were not closed, and the authors were not told their live issues had been resolved.
