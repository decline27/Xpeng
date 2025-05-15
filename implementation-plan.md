# Implementation Plan: Supporting Multiple Enode Clients

## Overview

This document outlines the implementation plan for supporting multiple Enode clients in the Xpeng Car Manager app. The goal is to overcome the 25-vehicle limit per client by allowing the app to use multiple client credentials while maintaining backward compatibility and security.

## Background

Enode API imposes a limit of 25 connected vehicles per client. As our user base grows, we need to support more than 25 vehicles without requiring users to create their own developer accounts. The solution is to use multiple client credentials (client ID/secret pairs) under a single developer account.

## Requirements

1. Maintain current functionality for existing users (primary client)
2. Add support for secondary (and additional) clients for new vehicle connections
3. Preserve VIN-based security to ensure users only see their own vehicles
4. Ensure seamless pairing regardless of which client is used
5. Allow users to remove and re-add vehicles without issues
6. Maintain backward compatibility with existing connected vehicles

## Technical Approach

### 1. Client Management System

We'll create a new `ClientManager` class to replace the current `AccountManager`. This class will:

- Store and manage multiple client credentials
- Track which vehicles are associated with which clients
- Select appropriate clients for new vehicle connections
- Handle client capacity management

### 2. Credential Storage

Client credentials will be stored in:

1. **env.json** - Primary secure storage (encrypted when app is published)
2. **Homey settings** - Fallback storage and for runtime management

The env.json file should be structured as follows:

```json
{
  "ENODE_CLIENT_ID": "primary-client-id",
  "ENODE_CLIENT_SECRET": "primary-client-secret",
  "ENODE_CLIENT_ID_SECONDARY": "secondary-client-id",
  "ENODE_CLIENT_SECRET_SECONDARY": "secondary-client-secret"
}
```

**Important**: The env.json file is automatically encrypted when the app is published to the Homey App Store. This ensures credentials remain secure and are not exposed to end users.

### 3. Vehicle-to-Client Mapping

We'll maintain a mapping between vehicle VINs and client IDs to ensure:

- Vehicles always use the same client they were initially connected with
- API requests use the correct credentials for each vehicle
- Backward compatibility is maintained for existing vehicles

## Implementation Steps

### Step 1: Create ClientManager Class

Replace the current `AccountManager` with a more flexible `ClientManager` that supports multiple clients:

```javascript
class ClientManager {
  constructor(homey) {
    this.homey = homey;
    this.logger = homey.log || console.log;

    // Settings keys
    this.SETTINGS_KEYS = {
      // Client credentials
      CLIENTS: 'enode_clients',
      
      // Vehicle client mapping
      VEHICLE_CLIENT_MAPPING: 'vehicle_client_mapping',
      
      // Default client for new vehicles
      DEFAULT_CLIENT: 'default_client'
    };

    // Initialize client list and mapping
    this._initialize();
  }

  // Methods for managing clients and vehicle mappings
  // ...
}
```

### Step 2: Update API Client

Modify the `EnodeAPI` class to work with the new `ClientManager`:

- Update token management to handle multiple clients
- Ensure API requests use the correct client credentials based on the vehicle
- Implement client selection logic for new vehicle connections

### Step 3: Update Pairing Process

Modify the pairing process to:

- Select an available client that hasn't reached capacity
- Associate newly paired vehicles with the selected client
- Maintain the VIN-based security system

### Step 4: Implement Migration Logic

Create a migration process to:

- Convert existing account mappings to the new client mapping system
- Ensure existing vehicles continue to work without disruption

## Testing Plan

### Unit Tests

1. Test ClientManager functionality:
   - Client credential storage and retrieval
   - Vehicle-to-client mapping
   - Client selection logic
   - Capacity management

2. Test EnodeAPI with multiple clients:
   - Token management
   - API request routing
   - Vehicle filtering

### Integration Tests

1. Test pairing process with multiple clients:
   - New vehicle connections
   - Re-adding existing vehicles
   - Handling client capacity limits

2. Test vehicle operations across clients:
   - Vehicle data retrieval
   - Vehicle control commands
   - Error handling

### Security Tests

1. Verify VIN-based security:
   - Users can only see their own vehicles
   - Vehicle filtering works correctly across clients

2. Verify credential security:
   - Client credentials are not exposed to users
   - Token management is secure

## Deployment Plan

1. Implement changes in a feature branch
2. Conduct thorough testing
3. Create a beta release for limited user testing
4. Deploy to production with careful monitoring

## Monitoring and Maintenance

1. Add logging to track:
   - Client usage and capacity
   - Vehicle-to-client associations
   - API errors related to client management

2. Create admin tools to:
   - View client status and capacity
   - Manually reassign vehicles between clients if needed
   - Add new clients when needed

## Security Considerations

1. **Credential Storage**: All client credentials must be stored in the env.json file, which is encrypted when published to the Homey App Store.

2. **VIN-based Security**: The existing VIN-based security system will be maintained and enhanced to work with multiple clients.

3. **User Isolation**: Users should only see and control their own vehicles, regardless of which client those vehicles use.

## Conclusion

This implementation plan provides a robust solution for supporting more than 25 vehicles in the Xpeng Car Manager app while maintaining security and backward compatibility. By using multiple client credentials under a single developer account, we can scale the app to support a growing user base without requiring users to create their own developer accounts.
