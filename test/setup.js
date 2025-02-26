// Global test setup
const homeyMock = require('./mocks/homey');

// Set up global Homey object for tests that need direct access
global.Homey = homeyMock;

// Mock node-fetch globally for all tests
jest.mock('node-fetch', () => jest.fn());

// Increase Jest timeout for async tests
jest.setTimeout(10000);