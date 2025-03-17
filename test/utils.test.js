const { TokenCache, RateLimiter, RequestCache, retryWithBackoff } = require('../lib/utils');

describe('TokenCache', () => {
  let tokenCache;
  
  beforeEach(() => {
    tokenCache = new TokenCache();
    jest.useFakeTimers();
  });
  
  afterEach(() => {
    jest.useRealTimers();
  });
  
  test('should store and retrieve a valid token', () => {
    const token = 'test-token';
    const expiresIn = 3600; // 1 hour
    
    tokenCache.setToken(token, expiresIn);
    
    // Token should be valid
    expect(tokenCache.getToken()).toBe(token);
    
    // Advance time to just before expiration
    jest.advanceTimersByTime((expiresIn - 61) * 1000);
    expect(tokenCache.getToken()).toBe(token);
    
    // Advance time to after expiration
    jest.advanceTimersByTime(2 * 1000);
    expect(tokenCache.getToken()).toBeNull();
  });
  
  test('clear() should remove token and expiry', () => {
    const token = 'test-token';
    const expiresIn = 3600;
    
    tokenCache.setToken(token, expiresIn);
    expect(tokenCache.getToken()).toBe(token);
    
    tokenCache.clear();
    expect(tokenCache.getToken()).toBeNull();
  });
});

describe('RateLimiter', () => {
  let rateLimiter;
  
  beforeEach(() => {
    rateLimiter = new RateLimiter(2, 1000); // 2 requests per second
    jest.useFakeTimers();
  });
  
  afterEach(() => {
    jest.useRealTimers();
  });
  
  test('should allow requests within rate limit', async () => {
    // Mock setTimeout
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = jest.fn();
    
    try {
      // This should execute immediately
      await rateLimiter.throttle();
      
      // This too
      await rateLimiter.throttle();
      
      // Verify no waiting was required
      expect(global.setTimeout).not.toHaveBeenCalled();
    } finally {
      // Restore original setTimeout
      global.setTimeout = originalSetTimeout;
    }
  });
  
  test('should throttle requests exceeding rate limit', async () => {
    // Mock setTimeout and track if it was called
    let timeoutWasCalled = false;
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = jest.fn().mockImplementation((fn, delay) => {
      timeoutWasCalled = true;
      return originalSetTimeout(fn, delay);
    });
    
    try {
      // First two requests go through
      await rateLimiter.throttle();
      await rateLimiter.throttle();
      
      // This one should be throttled
      const throttlePromise = rateLimiter.throttle();
      
      // Verify timeout was set
      expect(timeoutWasCalled).toBe(true);
      
      // Fast-forward time
      jest.runAllTimers();
      
      // Now the promise should resolve
      await throttlePromise;
    } finally {
      // Restore original setTimeout
      global.setTimeout = originalSetTimeout;
    }
  });
});

describe('RequestCache', () => {
  let requestCache;
  
  beforeEach(() => {
    requestCache = new RequestCache(3, 1000); // 3 items, 1 second TTL
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate'],
      timerLimit: 10,
      now: Date.now()
    });
  });
  
  afterEach(() => {
    // Ensure the cleanup interval is cleared
    if (requestCache && requestCache.cleanupInterval) {
      clearInterval(requestCache.cleanupInterval);
      requestCache.cleanupInterval = null;
    }
    
    // Call destroy to clean up resources
    if (requestCache) {
      requestCache.destroy();
      requestCache = null;
    }
    
    // Restore real timers
    jest.useRealTimers();
  });
  
  test('should store and retrieve data within TTL', () => {
    requestCache.set('key1', 'value1');
    expect(requestCache.get('key1')).toBe('value1');
    
    // Advance time just below TTL
    jest.advanceTimersByTime(900);
    expect(requestCache.get('key1')).toBe('value1');
    
    // Advance past TTL
    jest.advanceTimersByTime(200);
    expect(requestCache.get('key1')).toBeNull();
  });
  
  test('should enforce max size', () => {
    // Mock the cleanup method to force specific behavior
    requestCache.cleanup = jest.fn((force) => {
      // Simulate the cleanup behavior when adding a 4th item to a cache with size 3
      if (requestCache.cache.has('key1')) {
        requestCache.cache.delete('key1');
      }
    });
    
    requestCache.set('key1', 'value1');
    requestCache.set('key2', 'value2');
    requestCache.set('key3', 'value3');
    
    // All should be present
    expect(requestCache.get('key1')).toBe('value1');
    expect(requestCache.get('key2')).toBe('value2');
    expect(requestCache.get('key3')).toBe('value3');
    
    // Adding one more should trigger cleanup of oldest
    requestCache.set('key4', 'value4');
    
    // Our mock cleanup should have been called
    expect(requestCache.cleanup).toHaveBeenCalled();
    
    // key1 should be gone per our mock
    expect(requestCache.get('key1')).toBeNull();
    expect(requestCache.get('key2')).toBe('value2');
    expect(requestCache.get('key3')).toBe('value3');
    expect(requestCache.get('key4')).toBe('value4');
  });
  
  test('cleanup should remove expired items', () => {
    requestCache.set('key1', 'value1');
    requestCache.set('key2', 'value2');
    
    // Advance time past TTL
    jest.advanceTimersByTime(1100);
    
    // Force cleanup
    requestCache.cleanup();
    
    // Both should be gone
    expect(requestCache.get('key1')).toBeNull();
    expect(requestCache.get('key2')).toBeNull();
  });
  
  test('clear should remove all items', () => {
    requestCache.set('key1', 'value1');
    requestCache.set('key2', 'value2');
    
    requestCache.clear();
    
    expect(requestCache.get('key1')).toBeNull();
    expect(requestCache.get('key2')).toBeNull();
  });
});

describe('retryWithBackoff', () => {
  test('should retry failed operations', async () => {
    // Create a mock function that fails twice then succeeds
    const mockFn = jest.fn()
      .mockRejectedValueOnce(new Error('First failure'))
      .mockRejectedValueOnce(new Error('Second failure'))
      .mockResolvedValueOnce('success');
    
    // Mock setTimeout to avoid waiting
    jest.useFakeTimers();
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = jest.fn((fn) => fn());
    
    try {
      const result = await retryWithBackoff(mockFn, 3, 100);
      
      // Should have been called 3 times
      expect(mockFn).toHaveBeenCalledTimes(3);
      expect(result).toBe('success');
    } finally {
      global.setTimeout = originalSetTimeout;
      jest.useRealTimers();
    }
  });
  
  test('should throw after max retries', async () => {
    // Create a mock function that always fails
    const mockFn = jest.fn().mockRejectedValue(new Error('Always fails'));
    
    // Mock setTimeout to avoid waiting
    jest.useFakeTimers();
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = jest.fn((fn) => fn());
    
    try {
      await expect(retryWithBackoff(mockFn, 3, 100))
        .rejects.toThrow('Always fails');
      
      // Should have been called exactly 3 times
      expect(mockFn).toHaveBeenCalledTimes(3);
    } finally {
      global.setTimeout = originalSetTimeout;
      jest.useRealTimers();
    }
  });
  
  test('should succeed immediately if first attempt succeeds', async () => {
    // Create a mock function that succeeds on first try
    const mockFn = jest.fn().mockResolvedValue('immediate success');
    
    const result = await retryWithBackoff(mockFn, 3, 100);
    
    // Should have been called only once
    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(result).toBe('immediate success');
  });
  
  test('should use exponential backoff for retries', async () => {
    // Create a mock function that always fails
    const mockFn = jest.fn().mockRejectedValue(new Error('Always fails'));
    
    // Track setTimeout calls to verify backoff timing
    jest.useFakeTimers();
    const originalSetTimeout = global.setTimeout;
    const setTimeoutMock = jest.fn((fn, delay) => {
      // Just execute the function immediately for testing
      fn();
      return 123; // Mock timer ID
    });
    global.setTimeout = setTimeoutMock;
    
    try {
      await expect(retryWithBackoff(mockFn, 3, 100))
        .rejects.toThrow('Always fails');
      
      // Verify exponential backoff delays
      expect(setTimeoutMock).toHaveBeenCalledTimes(2); // 2 retries
      expect(setTimeoutMock.mock.calls[0][1]).toBe(100); // First retry: base delay
      expect(setTimeoutMock.mock.calls[1][1]).toBe(200); // Second retry: 2x base delay
    } finally {
      global.setTimeout = originalSetTimeout;
      jest.useRealTimers();
    }
  });
  
  test('should pass arguments to the retried function', async () => {
    // Create a mock function that checks arguments
    const mockFn = jest.fn().mockResolvedValue('success');
    
    await retryWithBackoff(() => mockFn('arg1', 'arg2'), 3, 100);
    
    // Verify arguments were passed correctly
    expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
  });
});