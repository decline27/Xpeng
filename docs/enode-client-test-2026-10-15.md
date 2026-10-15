# Additional Enode clients — 15 October 2026

The private configuration contains ten distinct production client IDs: the original primary, secondary, 3, 4 and 5, plus new clients 7, 8, 9, 10 and 11. The missing suffix 6 is supported and did not require a code change.

## Production checks

| Client | Production authentication/read | Connected vehicle records | New connection link |
| --- | --- | ---: | --- |
| Primary | Passed | 25 | Capacity rejection during fallback test |
| Secondary | Passed | 25 | Capacity rejection during fallback test |
| 3 | Passed | 25 | Capacity rejection during fallback test |
| 4 | Passed | 25 | Capacity rejection during fallback test |
| 5 | Passed | 25 | Capacity rejection during fallback test |
| 7 | Passed | 0 | Passed |
| 8 | Passed | 0 | Passed |
| 9 | Passed | 0 | Passed |
| 10 | Passed | 0 | Passed |
| 11 | Passed | 2 | Passed |

Each new client successfully generated a production connection link with the app's data, location and charging scopes. The automatic-selection test used the actual EnodeAPI implementation: primary, secondary, 3, 4 and 5 returned HTTP 403, then client 7 returned HTTP 200 and a link.

Tests used a newly generated synthetic user ID. No XPENG login was completed. The five empty test users were removed after checking that they had no linked vendors and owned no vehicles. The old clients did not create the test user. Existing customers and connections were not deleted or moved.

## Homey verification

The running Homey initially had only five registered clients. Version 1.3.3 was reinstalled with the updated private environment, preserving the paired G6. Its registry now contains all ten clients and the app reports running without a crash. The existing vehicle's manual Refresh Vehicle Data Flow completed successfully and the device remained available.

The full regression suite passed 446 tests across 27 suites. Homey validation passed at the verified level. No application code change was needed for the additional clients, and credentials remain in the ignored private environment file.

## What remains unverified

- Successful link generation is not a completed XPENG authorization. A consenting user must finish the login and confirm vehicle discovery on a new client to complete the end-to-end pairing check.
- Vehicle counts are measured usage, not an API-reported maximum allowance. If each new client has a 25-vehicle allowance, the five new clients would have 123 remaining slots, but the allowance must be confirmed in Enode.
- Only the maintainer's Homey was updated in this test. Existing App Store users need a release carrying the new credential pairs. Public publication remains on hold; this test did not publish or change the App Store release.
- This account test did not repeat the unresolved live charging-control test from 14 October or establish any improvement in upstream data freshness.


## Subsequent cleanup and release submission

After this test, the owner authorized removing the stale, duplicate, and re-link-required groups. Those groups overlapped: 43 unique connections were removed, leaving 84. A fresh inventory verified that every unselected vehicle remained. All five new clients are now empty. Detailed identifiers are retained only in the ignored private audit directory.

Version 1.3.4 was subsequently uploaded as Homey App Store build 67. Its review-state check on 15 October confirmed `in_review` and the environment contained all ten configured client pairs, including clients 7–11. Version 1.3.1 was still the live release at that check. The account tests above do not constitute a successful live charging-control test.
