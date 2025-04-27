const Homey = require('homey');
const EnodeAPI = require('../lib/enode-api');
const EnodeOAuth2 = require('../lib/enode-oauth');
const { getMachineToken } = require('../lib/enode-machine-token');

// Mock Homey environment
global.Homey = {
  env: {
    ENODE_CLIENT_ID: process.env.ENODE_CLIENT_ID,
    ENODE_CLIENT_SECRET: process.env.ENODE_CLIENT_SECRET
  }
};

// Simple logger
const logger = {
  log: (...args) => console.log('[LOG]', ...args),
  error: (...args) => console.error('[ERROR]', ...args)
};

async function testMachineToken() {
  console.log('Testing machine token...');
  try {
    const token = await getMachineToken();
    console.log('Machine token obtained successfully:', token.substring(0, 10) + '...');
    return true;
  } catch (error) {
    console.error('Failed to get machine token:', error);
    return false;
  }
}

async function testEnodeAPI() {
  console.log('Testing Enode API...');
  try {
    const api = new EnodeAPI(logger);
    
    // Test vehicle link generation
    const userId = `test-${Date.now()}`;
    const linkUrl = await api.generateVehicleLink(userId);
    console.log('Vehicle link generated successfully:', linkUrl);
    
    // Test vehicle listing
    const vehicles = await api.getVehicles();
    console.log('Vehicles retrieved successfully:', vehicles.map(v => ({ id: v.id, name: v.name })));
    
    if (vehicles.length > 0) {
      // Test vehicle data retrieval
      const vehicleId = vehicles[0].id;
      const vehicleData = await api.getVehicleData(vehicleId);
      console.log('Vehicle data retrieved successfully for', vehicleId);
    }
    
    return true;
  } catch (error) {
    console.error('Failed to test Enode API:', error);
    return false;
  }
}

async function testOAuth2() {
  console.log('Testing OAuth2 client...');
  try {
    const oauth2 = new EnodeOAuth2({
      clientId: Homey.env.ENODE_CLIENT_ID,
      clientSecret: Homey.env.ENODE_CLIENT_SECRET,
      redirectUri: 'https://callback.athom.com/oauth2/callback',
      logger
    });
    
    // Test machine token generation
    const machineToken = await oauth2.getMachineToken();
    console.log('OAuth2 machine token obtained successfully:', machineToken.substring(0, 10) + '...');
    
    // Test auth URL generation
    const userId = `test-${Date.now()}`;
    const authUrl = await oauth2.generateAuthUrl(userId);
    console.log('OAuth2 auth URL generated successfully:', authUrl);
    
    return true;
  } catch (error) {
    console.error('Failed to test OAuth2 client:', error);
    return false;
  }
}

async function runTests() {
  console.log('Starting tests...');
  
  // Check environment
  if (!Homey.env.ENODE_CLIENT_ID || !Homey.env.ENODE_CLIENT_SECRET) {
    console.error('Missing environment variables. Please set ENODE_CLIENT_ID and ENODE_CLIENT_SECRET.');
    process.exit(1);
  }
  
  // Run tests
  const machineTokenTest = await testMachineToken();
  const enodeAPITest = await testEnodeAPI();
  const oauth2Test = await testOAuth2();
  
  // Report results
  console.log('\nTest Results:');
  console.log('Machine Token Test:', machineTokenTest ? 'PASSED' : 'FAILED');
  console.log('Enode API Test:', enodeAPITest ? 'PASSED' : 'FAILED');
  console.log('OAuth2 Test:', oauth2Test ? 'PASSED' : 'FAILED');
  
  // Exit with appropriate code
  if (machineTokenTest && enodeAPITest && oauth2Test) {
    console.log('\nAll tests passed!');
    process.exit(0);
  } else {
    console.error('\nSome tests failed!');
    process.exit(1);
  }
}

// Run the tests
runTests().catch(error => {
  console.error('Unhandled error in tests:', error);
  process.exit(1);
});
