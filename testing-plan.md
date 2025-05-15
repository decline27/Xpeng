# Testing Plan: Multiple Enode Clients Support

This document outlines the testing strategy for validating the implementation of multiple Enode clients in the Xpeng Car Manager app.

## Test Environment Setup

1. Configure env.json with both primary and secondary client credentials
2. Set up test Homey environment with:
   - Clean installation (no existing vehicles)
   - Installation with vehicles on primary client
   - Installation with vehicles on secondary client
   - Installation with vehicles on both clients

## Unit Tests

### ClientManager Tests

1. **Client Initialization**
   - Test that ClientManager correctly initializes with primary and secondary clients
   - Verify default client is set correctly

2. **Client Credentials**
   - Test getClientCredentials() returns correct credentials for each client
   - Test error handling for invalid client IDs

3. **Vehicle-Client Mapping**
   - Test setVehicleClient() correctly associates vehicles with clients
   - Test getVehicleClient() returns the correct client for a vehicle
   - Test getVehicleCredentials() returns the correct credentials for a vehicle

4. **Client Selection Logic**
   - Test findAvailableClient() returns the default client when it has capacity
   - Test findAvailableClient() returns an alternative client when default is at capacity
   - Test findAvailableClient() returns null when all clients are at capacity

5. **Migration Logic**
   - Test migrateFromAccountManager() correctly migrates vehicle mappings
   - Test migration handles empty or invalid old mappings

### EnodeAPI Tests

1. **Token Management**
   - Test getAccessToken() uses the correct client credentials
   - Test token caching works correctly for multiple clients
   - Test token refresh works correctly for each client

2. **Vehicle Link Generation**
   - Test generateVehicleLink() uses the specified client
   - Test generateVehicleLink() selects an available client when none specified
   - Test error handling when all clients are at capacity

3. **Vehicle Retrieval**
   - Test getVehicles() retrieves vehicles from all clients when getAllClients=true
   - Test getVehicles() retrieves vehicles only from specified client when getAllClients=false
   - Test vehicle filtering works correctly across multiple clients

## Integration Tests

### Pairing Process

1. **New Vehicle Pairing**
   - Test pairing a new vehicle when primary client has capacity
   - Test pairing a new vehicle when primary client is at capacity
   - Test error handling when all clients are at capacity

2. **Vehicle Re-pairing**
   - Test re-pairing a vehicle previously on primary client
   - Test re-pairing a vehicle previously on secondary client
   - Verify vehicle remains associated with original client after re-pairing

3. **Multiple Vehicle Pairing**
   - Test pairing multiple vehicles in sequence
   - Verify client selection logic distributes vehicles correctly

### Vehicle Operations

1. **Vehicle Data Retrieval**
   - Test retrieving data for vehicles on primary client
   - Test retrieving data for vehicles on secondary client
   - Test retrieving data for all vehicles across clients

2. **Vehicle Control Commands**
   - Test sending control commands to vehicles on primary client
   - Test sending control commands to vehicles on secondary client
   - Test error handling for control commands

### Security Tests

1. **User Isolation**
   - Test that users only see their own vehicles
   - Test that VIN-based filtering works correctly across clients
   - Test that users cannot access vehicles from other users

2. **Credential Security**
   - Verify client credentials are not exposed in the UI
   - Verify client credentials are not exposed in API responses
   - Verify token management is secure

## Edge Cases and Error Handling

1. **Client Capacity**
   - Test behavior when approaching client capacity (24 vehicles)
   - Test behavior when at client capacity (25 vehicles)
   - Test behavior when exceeding client capacity (26+ vehicles)

2. **Client Failures**
   - Test behavior when primary client credentials are invalid
   - Test behavior when secondary client credentials are invalid
   - Test fallback mechanisms when a client is unavailable

3. **Migration Scenarios**
   - Test upgrading from a version without multiple client support
   - Test behavior with mixed vehicle mappings
   - Test behavior when adding a new client after initial setup

## Performance Tests

1. **Response Time**
   - Measure response time for vehicle operations across clients
   - Compare performance between primary and secondary clients
   - Test performance with large numbers of vehicles

2. **Memory Usage**
   - Monitor memory usage with multiple clients
   - Test for memory leaks during extended operation

## Regression Tests

1. **Existing Functionality**
   - Verify all existing app features work correctly with multiple clients
   - Test backward compatibility with existing vehicles
   - Ensure no regression in core functionality

## User Experience Tests

1. **Pairing Flow**
   - Test the user experience during pairing
   - Verify error messages are clear and helpful
   - Test the flow when adding a vehicle to a full client

2. **Vehicle Management**
   - Test removing and re-adding vehicles
   - Test vehicle discovery and selection
   - Test vehicle control and monitoring

## Test Documentation

For each test case, document:

1. Test ID and description
2. Prerequisites and setup
3. Test steps
4. Expected results
5. Actual results
6. Pass/Fail status

## Test Reporting

Create a test report that includes:

1. Summary of test results
2. Detailed test case outcomes
3. Identified issues and their severity
4. Recommendations for fixes or improvements

## Continuous Testing

Implement automated tests where possible to enable:

1. Continuous integration testing
2. Regression testing for future updates
3. Performance monitoring over time

## Final Acceptance Criteria

The implementation will be considered successful when:

1. All test cases pass
2. No high-severity issues are identified
3. Performance meets or exceeds baseline measurements
4. User experience is seamless across clients
5. Security requirements are fully met
