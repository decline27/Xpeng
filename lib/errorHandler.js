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

    // Prefer the HTTP status; fall back to one embedded in the message text
    const statusMatch = origMessage.match(/status:? (\d{3})/);
    const status = error.status || (statusMatch ? parseInt(statusMatch[1], 10) : undefined);
    const lower = origMessage.toLowerCase();

    if (status === 429 || lower.includes('rate limit')) {
      errorType = this.ErrorTypes.API;
      userMessage = 'The service is temporarily unavailable due to high demand.';
      recoverySuggestion = 'Please wait a moment and try again.';
    } else if (status === 401 || lower.includes('unauthorized') || lower.includes('invalid_client')
      || lower.includes('credentials')) {
      errorType = this.ErrorTypes.AUTHENTICATION;
      userMessage = 'The connection to Enode needs to be renewed.';
      recoverySuggestion = 'Use Repair on the device to reconnect your car.';
    } else if (status === 403 || lower.includes('permission') || lower.includes('access denied')) {
      errorType = this.ErrorTypes.PERMISSION;
      userMessage = 'You don\'t have permission to perform this action.';
      recoverySuggestion = 'Please check your access rights and try again.';
    } else if (!status && (error.name === 'AbortError' || error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET'
      || lower.includes('timeout') || lower.includes('network') || lower.includes('fetch failed')
      || lower.includes('econnreset') || lower.includes('socket hang up'))) {
      errorType = this.ErrorTypes.NETWORK;
      userMessage = 'Unable to connect to the XPENG services.';
      recoverySuggestion = 'Please check your internet connection and try again.';
    } else if (lower.includes('plugged in')) {
      errorType = this.ErrorTypes.VEHICLE_STATE;
      userMessage = 'Your vehicle needs to be connected to a charger.';
      recoverySuggestion = 'Please plug in your vehicle and try again.';
    } else if (/\b(already full|battery is full|fully charged)\b/.test(lower)) {
      errorType = this.ErrorTypes.VEHICLE_STATE;
      userMessage = 'Your vehicle\'s battery is already at its charge limit.';
      recoverySuggestion = 'No charging needed at this time.';
    } else if (lower.includes('not charging')) {
      errorType = this.ErrorTypes.VEHICLE_STATE;
      userMessage = 'Your vehicle is not currently charging.';
      recoverySuggestion = 'No action needed to stop charging.';
    } else if (status === 404 || lower.includes('not found')) {
      errorType = this.ErrorTypes.VEHICLE_STATE;
      userMessage = 'We couldn\'t find your vehicle.';
      recoverySuggestion = 'Use Repair on the device to reconnect your car.';
    } else if (lower.includes('missing') || lower.includes('not set') || lower.includes('required settings')) {
      errorType = this.ErrorTypes.CONFIGURATION;
      userMessage = 'There is a configuration issue with your XPENG setup.';
      recoverySuggestion = 'Please check your app settings and ensure all required information is provided.';
    } else if (status >= 500) {
      errorType = this.ErrorTypes.API;
      userMessage = 'Enode is having problems right now.';
      recoverySuggestion = 'Please try again in a few minutes.';
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