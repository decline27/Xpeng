const ErrorHandler = require('../lib/errorHandler');

describe('ErrorHandler', () => {
  beforeEach(() => {
    // Reset any mocked functions
    jest.clearAllMocks();
  });
  
  test('should categorize API errors correctly', () => {
    const apiError = new Error('API rate limit exceeded');
    apiError.status = 429;
    
    const result = ErrorHandler.translateError(apiError, 'testContext');
    
    expect(result.type).toBe(ErrorHandler.ErrorTypes.API);
    expect(result.message).toContain('service');
    expect(result.suggestion).toContain('try again');
  });
  
  test('should categorize permission errors correctly', () => {
    const permError = new Error('Insufficient permissions');
    permError.status = 403;
    
    const result = ErrorHandler.translateError(permError, 'testContext');
    
    expect(result.type).toBe(ErrorHandler.ErrorTypes.PERMISSION);
    expect(result.message).toContain('permission');
    expect(result.suggestion).toContain('access');
  });
  
  test('should handle reporter function throwing an error', () => {
    const error = new Error('Test error');
    const failingReporter = jest.fn().mockImplementation(() => {
      throw new Error('Reporter failed');
    });
    
    const result = ErrorHandler.handleError(error, 'testContext', failingReporter, false);
    
    expect(result).toBeDefined();
    expect(failingReporter).toHaveBeenCalled();
  });
  
  test('should include timestamp in translated error', () => {
    const error = new Error('Test error');
    const result = ErrorHandler.translateError(error, 'testContext');
    
    expect(result.timestamp).toBeDefined();
    expect(new Date(result.timestamp).getTime()).not.toBeNaN();
  });

  test('should categorize network errors correctly', () => {
    const networkError = new Error('Failed to fetch data');
    networkError.name = 'AbortError';
    
    const result = ErrorHandler.translateError(networkError, 'testContext');
    
    expect(result.type).toBe(ErrorHandler.ErrorTypes.NETWORK);
    expect(result.message).toContain('connect');
    expect(result.suggestion).toContain('internet connection');
  });
  
  test('should categorize authentication errors correctly', () => {
    const authError = new Error('Invalid token');
    authError.status = 401;
    
    const result = ErrorHandler.translateError(authError, 'testContext');
    
    expect(result.type).toBe(ErrorHandler.ErrorTypes.AUTHENTICATION);
    expect(result.message).toContain('credentials');
    expect(result.suggestion).toContain('reconnect');
  });
  
  test('should categorize vehicle state errors correctly', () => {
    const pluggedInError = new Error('Vehicle is not plugged in');
    
    const result = ErrorHandler.translateError(pluggedInError, 'testContext');
    
    expect(result.type).toBe(ErrorHandler.ErrorTypes.VEHICLE_STATE);
    expect(result.message).toContain('charger');
    expect(result.suggestion).toContain('plug in');
  });
  
  test('should categorize configuration errors correctly', () => {
    const configError = new Error('Missing required settings');
    
    const result = ErrorHandler.translateError(configError, 'testContext');
    
    expect(result.type).toBe(ErrorHandler.ErrorTypes.CONFIGURATION);
    expect(result.message).toContain('configuration');
  });
  
  test('should use default message for unknown errors', () => {
    const unknownError = new Error('Some weird error');
    
    const result = ErrorHandler.translateError(unknownError, 'testContext');
    
    expect(result.type).toBe(ErrorHandler.ErrorTypes.UNKNOWN);
    expect(result.message).toContain('Something went wrong');
  });
  
  test('should handle errors with undefined message', () => {
    const emptyError = new Error();
    
    const result = ErrorHandler.translateError(emptyError, 'testContext');
    
    expect(result.original).toBe('Unknown error');
    expect(result.type).toBe(ErrorHandler.ErrorTypes.UNKNOWN);
  });
  
  test('should format error messages correctly', () => {
    const translatedError = {
      message: 'Test error message',
      suggestion: 'Test suggestion'
    };
    
    const formatted = ErrorHandler.formatErrorMessage(translatedError);
    
    expect(formatted).toBe('Test error message Test suggestion');
  });
  
  test('should call reporter function when provided', () => {
    const error = new Error('Test error');
    const reporter = jest.fn();
    
    ErrorHandler.handleError(error, 'testContext', reporter, false);
    
    expect(reporter).toHaveBeenCalledWith(expect.objectContaining({
      type: expect.any(String),
      message: expect.any(String),
      suggestion: expect.any(String)
    }));
  });
  
  test('should rethrow errors when requested', () => {
    const error = new Error('Original error');
    
    expect(() => {
      ErrorHandler.handleError(error, 'testContext', null, true);
    }).toThrow();
  });
});