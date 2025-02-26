module.exports = {
  // The test environment that will be used for testing
  testEnvironment: 'node',
  
  // The glob patterns Jest uses to detect test files
  testMatch: [
    '**/test/**/*.test.js',
    '**/?(*.)+test.js'
  ],
  
  // An array of regexp pattern strings that are matched against all test paths
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.homeybuild/'
  ],
  
  // Indicates whether each individual test should be reported during the run
  verbose: true,
  
  // Automatically clear mock calls and instances between every test
  clearMocks: true,
  
  // Collect coverage information
  collectCoverage: true,
  
  // The directory where Jest should output its coverage files
  coverageDirectory: 'coverage',
  
  // Coverage configuration
  coverageReporters: ['text', 'lcov'],
  
  // Setup files
  setupFiles: ['./test/setup.js'],
  
  // Module mocking
  moduleNameMapper: {
    '^homey$': '<rootDir>/test/mocks/homey.js'
  }
};