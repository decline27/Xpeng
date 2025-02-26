'use strict';

const Logger = require('./logger');

/**
 * Central error handling service for the XPENG Car Manager app
 * Provides consistent error handling, logging, and user-friendly error messages
 */
class ErrorHandler {
  /**
   * Categorized error types to help identify the source of errors
   */
  static ErrorTypes = {
    NETWORK: 'network',
    AUTHENTICATION: 'authentication',
    VEHICLE_STATE: 'vehicle_state',
    CONFIGURATION: 'configuration',
    API: 'api',
    PERMISSION: 'permission',
    UNKNOWN: 'unknown'
  };

  /**
   * Translates technical error messages to user-friendly messages with recovery suggestions
   * @param {Error} error - The original error object
   * @param {string} context - Optional context where the error occurred
   * @returns {Object} An object with error type, message, and suggestion
   */
  static translateError(error, context = '') {
    // Default values
    let errorType = this.ErrorTypes.UNKNOWN;
    let userMessage = 'Something went wrong. Please try again later.';
    let recoverySuggestion = 'If the problem persists, check your vehicle status or restart the app.';
    
    // Original error message
    const origMessage = error.message || 'Unknown error';
    
    // Network errors
    if (error.name === 'AbortError' || error.code === 'ETIMEDOUT' || 
        origMessage.includes('fetch') || origMessage.includes('timeout') ||
        origMessage.includes('network')) {
      errorType = this.ErrorTypes.NETWORK;
      userMessage = 'Unable to connect to the XPENG services.';
      recoverySuggestion = 'Please check your internet connection and try again.';
    }
    
    // Authentication errors
    else if (error.status === 401 || error.status === 403 || 
            origMessage.includes('token') || origMessage.includes('credentials') ||
            origMessage.includes('auth') || origMessage.includes('unauthorized')) {
      errorType = this.ErrorTypes.AUTHENTICATION;
      userMessage = 'Your account credentials need to be updated.';
      recoverySuggestion = 'Please reconnect your Enode account in the settings.';
    }
    
    // Vehicle state errors
    else if (origMessage.includes('plugged in')) {
      errorType = this.ErrorTypes.VEHICLE_STATE;
      userMessage = 'Your vehicle needs to be connected to a charger.';
      recoverySuggestion = 'Please plug in your vehicle and try again.';
    }
    else if (origMessage.includes('full')) {
      errorType = this.ErrorTypes.VEHICLE_STATE;
      userMessage = 'Your vehicle\'s battery is already at 100%.';
      recoverySuggestion = 'No charging needed at this time.';
    }
    else if (origMessage.includes('not charging')) {
      errorType = this.ErrorTypes.VEHICLE_STATE;
      userMessage = 'Your vehicle is not currently charging.';
      recoverySuggestion = 'No action needed to stop charging.';
    }
    else if (origMessage.includes('not found')) {
      errorType = this.ErrorTypes.VEHICLE_STATE;
      userMessage = 'We couldn\'t find your vehicle.';
      recoverySuggestion = 'Please ensure your vehicle is turned on and properly linked to your Enode account.';
    }
    
    // Configuration errors
    else if (origMessage.includes('missing') || origMessage.includes('not set') || 
             origMessage.includes('Missing') || origMessage.includes('required settings')) {
      errorType = this.ErrorTypes.CONFIGURATION;
      userMessage = 'There is a configuration issue with your XPENG setup.';
      recoverySuggestion = 'Please check your app settings and ensure all required information is provided.';
    }
    
    // Log the error with context and mapping info
    Logger.error(`Error occurred [${errorType}]: ${origMessage}`, {
      context,
      originalMessage: origMessage,
      translatedMessage: userMessage,
      suggestion: recoverySuggestion
    });
    
    // Return a structured error object for use in the app
    return {
      type: errorType,
      message: userMessage,
      suggestion: recoverySuggestion,
      original: origMessage,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Handles an error in a standardized way
   * @param {Error} error - The error object
   * @param {string} context - Context where the error occurred
   * @param {Function} reporter - Function to report error to the user (optional)
   * @param {boolean} rethrow - Whether to rethrow the error after handling
   * @returns {Object} Translated error information
   */
  static handleError(error, context, reporter = null, rethrow = false) {
    // Translate the error to a user-friendly message
    const translatedError = this.translateError(error, context);
    
    // If a reporter function is provided, use it to show the error to the user
    if (typeof reporter === 'function') {
      try {
        reporter(translatedError);
      } catch (reporterError) {
        Logger.error('Error in error reporter:', reporterError);
      }
    }
    
    // Rethrow if requested (usually for critical errors that should stop execution)
    if (rethrow) {
      throw new Error(`${translatedError.message} ${translatedError.suggestion}`);
    }
    
    return translatedError;
  }

  /**
   * Creates a user-friendly error message from a translated error object
   * @param {Object} translatedError - Error object from translateError
   * @returns {string} Formatted error message for display
   */
  static formatErrorMessage(translatedError) {
    return `${translatedError.message} ${translatedError.suggestion}`;
  }
}

module.exports = ErrorHandler;