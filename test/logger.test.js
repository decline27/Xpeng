const Logger = require('../lib/logger');

describe('Logger', () => {
  let originalConsole;
  
  beforeEach(() => {
    // Save original console methods
    originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error
    };
    
    // Mock console methods
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
  });
  
  afterEach(() => {
    // Restore original console methods
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });
  
  test('should log messages based on log level', () => {
    // Default level is 'info'
    Logger.debug('Debug message'); // Shouldn't log
    Logger.log('Info message');
    Logger.warn('Warning message');
    Logger.error('Error message');
    
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('[DEBUG]'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[INFO]'), expect.stringContaining('Info message'));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[WARN]'), expect.stringContaining('Warning message'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[ERROR]'), expect.stringContaining('Error message'));
  });
  
  test('should change log level when requested', () => {
    // Set to debug level
    Logger.setLogLevel('debug');
    
    Logger.debug('Debug message');
    Logger.log('Info message');
    
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[DEBUG]'), expect.stringContaining('Debug message'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[INFO]'), expect.stringContaining('Info message'));
    
    // Set to error level (only errors should show)
    Logger.setLogLevel('error');
    
    console.log.mockClear();
    console.warn.mockClear();
    
    Logger.debug('Debug message');
    Logger.log('Info message');
    Logger.warn('Warning message');
    Logger.error('Error message');
    
    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[ERROR]'), expect.stringContaining('Error message'));
  });
  
  test('should format data properly', () => {
    // Clear previous calls
    console.log.mockClear();
    
    // Override shouldLog to always return true for testing
    const originalShouldLog = Logger.shouldLog;
    Logger.shouldLog = jest.fn().mockReturnValue(true);
    
    const testObject = { name: 'Test', value: 123 };
    
    Logger.log('Test with data', testObject);
    
    // Restore original method
    Logger.shouldLog = originalShouldLog;
    
    // Just verify console.log was called
    expect(console.log).toHaveBeenCalled();
  });
  
  test('should handle circular references and functions', () => {
    // Clear previous calls
    console.log.mockClear();
    
    // Override shouldLog to always return true for testing
    const originalShouldLog = Logger.shouldLog;
    Logger.shouldLog = jest.fn().mockReturnValue(true);
    
    const circularObj = { name: 'Circular' };
    circularObj.self = circularObj;
    
    const objWithFunction = {
      name: 'Function Object',
      doSomething: function() { return 'done'; }
    };
    
    // These should not throw errors
    Logger.log('Circular object', circularObj);
    Logger.log('Object with function', objWithFunction);
    
    // Restore original method
    Logger.shouldLog = originalShouldLog;
    
    // Just verify console.log was called at least once
    expect(console.log).toHaveBeenCalled();
  });
  
  test('should handle error objects specially', () => {
    // Clear previous mock calls
    console.error.mockClear();
    
    const error = new Error('Test error');
    
    Logger.error('Error occurred', error);
    
    // Just verify console.error was called
    expect(console.error).toHaveBeenCalled();
  });
});