# Error Handling

This document provides a detailed explanation of the error handling mechanisms implemented in the XPENG Car Manager Homey application.

## Overview

The XPENG Car Manager implements a centralized error handling system through the `ErrorHandler` class. This class provides consistent error messages and recovery suggestions for various error scenarios.

## Key Components

### ErrorHandler

The `ErrorHandler` class is the core component of the error handling system. It is responsible for:

- Translating technical error messages to user-friendly messages
- Categorizing errors by type
- Providing recovery suggestions
- Logging errors with context

```javascript
class ErrorHandler {
  constructor(logger) {
    this.logger = logger;
    
    // Error categories
    this.ERROR_TYPES = {
      AUTHENTICATION: 'authentication',
      NETWORK: 'network',
      API: 'api',
      VEHICLE: 'vehicle',
      UNKNOWN: 'unknown'
    };
    
    // Error messages by category
    this.ERROR_MESSAGES = {
      [this.ERROR_TYPES.AUTHENTICATION]: 'Authentication failed. Please check your credentials.',
      [this.ERROR_TYPES.NETWORK]: 'Network error. Please check your internet connection.',
      [this.ERROR_TYPES.API]: 'API error. The Enode API returned an error.',
      [this.ERROR_TYPES.VEHICLE]: 'Vehicle error. The vehicle is not responding.',
      [this.ERROR_TYPES.UNKNOWN]: 'Unknown error. Please try again later.'
    };
    
    // Recovery suggestions by category
    this.RECOVERY_SUGGESTIONS = {
      [this.ERROR_TYPES.AUTHENTICATION]: 'Try removing and re-adding your vehicle.',
      [this.ERROR_TYPES.NETWORK]: 'Check your internet connection and try again.',
      [this.ERROR_TYPES.API]: 'Wait a few minutes and try again.',
      [this.ERROR_TYPES.VEHICLE]: 'Make sure your vehicle is online and try again.',
      [this.ERROR_TYPES.UNKNOWN]: 'Restart the app and try again.'
    };
  }

  // Translate error message to user-friendly message
  translateError(error) {
    // Extract error message
    const errorMessage = error.message || error.toString();
    
    // Determine error type
    let errorType = this.ERROR_TYPES.UNKNOWN;
    
    if (errorMessage.includes('authentication') || errorMessage.includes('unauthorized') || errorMessage.includes('401')) {
      errorType = this.ERROR_TYPES.AUTHENTICATION;
    } else if (errorMessage.includes('network') || errorMessage.includes('timeout') || errorMessage.includes('ECONNREFUSED')) {
      errorType = this.ERROR_TYPES.NETWORK;
    } else if (errorMessage.includes('api') || errorMessage.includes('500') || errorMessage.includes('400')) {
      errorType = this.ERROR_TYPES.API;
    } else if (errorMessage.includes('vehicle') || errorMessage.includes('car') || errorMessage.includes('offline')) {
      errorType = this.ERROR_TYPES.VEHICLE;
    }
    
    // Return user-friendly message and recovery suggestion
    return {
      message: this.ERROR_MESSAGES[errorType],
      suggestion: this.RECOVERY_SUGGESTIONS[errorType],
      type: errorType,
      originalError: errorMessage
    };
  }

  // Handle error and return formatted message
  handleError(error, context = {}) {
    // Log error
    this.logger.error(`Error in ${context.component || 'unknown component'}:`, error);
    
    // Translate error
    const translatedError = this.translateError(error);
    
    // Format error message
    return this.formatErrorMessage(translatedError, context);
  }

  // Format error message with context
  formatErrorMessage(translatedError, context = {}) {
    let message = translatedError.message;
    
    // Add context-specific information
    if (context.action) {
      message = `Failed to ${context.action}: ${message}`;
    }
    
    // Add recovery suggestion
    if (translatedError.suggestion) {
      message += ` ${translatedError.suggestion}`;
    }
    
    return message;
  }
}
```

### Error Handling in API Requests

The `EnodeAPI` class includes error handling for all API requests. It uses the `makeRequest` method to make API requests and handle errors.

```javascript
async makeRequest(url, options = {}) {
  try {
    // Apply rate limiting
    await this.rateLimiter.throttle();
    
    // Make request
    const response = await fetch(url, options);
    
    // Check for HTTP errors
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`HTTP error ${response.status}: ${errorData.message || response.statusText}`);
    }
    
    return response;
  } catch (error) {
    // Handle network errors
    if (error.name === 'AbortError') {
      throw new Error('Request timed out');
    } else if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
      throw new Error('Network error: Failed to fetch');
    }
    
    // Handle other errors
    throw error;
  }
}
```

### Error Handling in Device Methods

The `XpengCarDevice` class includes error handling for device methods. It uses the `ErrorHandler` to handle errors and provide user-friendly error messages.

```javascript
async startCharging() {
  try {
    // Start charging
    await this.api.startCharging(this.getData().id);
    
    // Update device data
    await this.refreshData();
    
    return true;
  } catch (error) {
    // Handle error
    const errorMessage = this.errorHandler.handleError(error, {
      component: 'XpengCarDevice',
      action: 'start charging'
    });
    
    // Log error
    this.error(errorMessage);
    
    // Throw error with user-friendly message
    throw new Error(errorMessage);
  }
}
```

## Error Categories

The error handling system categorizes errors into the following types:

- **Authentication Errors**: Errors related to authentication, such as invalid credentials or expired tokens.
- **Network Errors**: Errors related to network connectivity, such as timeouts or connection failures.
- **API Errors**: Errors returned by the Enode API, such as rate limiting or server errors.
- **Vehicle Errors**: Errors related to the vehicle, such as offline status or command failures.
- **Unknown Errors**: Errors that don't fit into any of the above categories.

## Recovery Suggestions

The error handling system provides recovery suggestions for each error category:

- **Authentication Errors**: "Try removing and re-adding your vehicle."
- **Network Errors**: "Check your internet connection and try again."
- **API Errors**: "Wait a few minutes and try again."
- **Vehicle Errors**: "Make sure your vehicle is online and try again."
- **Unknown Errors**: "Restart the app and try again."

## Logging

The error handling system logs all errors with context information. This helps with debugging and troubleshooting.

```javascript
this.logger.error(`Error in ${context.component || 'unknown component'}:`, error);
```

## Retry Mechanism

The application includes a retry mechanism for handling transient errors. The `retryWithBackoff` function in the `utils.js` module implements an exponential backoff strategy for retrying failed operations.

```javascript
async function retryWithBackoff(operation, maxRetries = 3, initialDelay = 1000) {
  let retries = 0;
  let delay = initialDelay;
  
  while (true) {
    try {
      return await operation();
    } catch (error) {
      // Check if we've reached the maximum number of retries
      if (retries >= maxRetries) {
        throw error;
      }
      
      // Check if the error is retryable
      if (!isRetryableError(error)) {
        throw error;
      }
      
      // Increment retry count
      retries++;
      
      // Wait for the delay
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Increase delay for next retry
      delay *= 2;
    }
  }
}

function isRetryableError(error) {
  // Network errors are retryable
  if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
    return true;
  }
  
  // Timeout errors are retryable
  if (error.name === 'AbortError') {
    return true;
  }
  
  // Some HTTP errors are retryable
  if (error.message.includes('HTTP error 429') || error.message.includes('HTTP error 500')) {
    return true;
  }
  
  return false;
}
```

## Conclusion

The error handling system in the XPENG Car Manager Homey application provides a robust mechanism for handling errors and providing user-friendly error messages. It categorizes errors, provides recovery suggestions, and includes a retry mechanism for handling transient errors. This helps improve the user experience and makes the application more resilient to failures.
