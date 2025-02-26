// Enhanced logger module for consistent logging
const Homey = require('homey');

class Logger {
  constructor() {
    this.logLevel = process.env.XPENG_LOG_LEVEL || 'info';
    // Log levels: debug, info, warn, error
    this.levels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    };
  }

  setLogLevel(level) {
    if (this.levels[level] !== undefined) {
      this.logLevel = level;
    }
  }
  
  shouldLog(level) {
    return this.levels[level] >= this.levels[this.logLevel];
  }
  
  formatMessage(message, data) {
    const timestamp = new Date().toISOString();
    
    let formattedData = '';
    if (data) {
      try {
        // Keep track of objects we've seen to handle circular references
        const seen = new WeakSet();
        formattedData = JSON.stringify(data, (key, value) => {
          // Handle circular references
          if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
              return '[Circular]';
            }
            seen.add(value);
          }
          // Handle function values
          if (typeof value === 'function') {
            return '[Function]';
          }
          return value;
        }, 2);
      } catch (error) {
        formattedData = `[Object could not be stringified: ${error.message}]`;
      }
    }
    
    return `[${timestamp}] ${message} ${formattedData}`;
  }

  debug(message, data) {
    if (this.shouldLog('debug')) {
      console.log('[DEBUG]', this.formatMessage(message, data));
    }
  }
  
  log(message, data) {
    if (this.shouldLog('info')) {
      console.log('[INFO]', this.formatMessage(message, data));
    }
  }
  
  info(message, data) {
    this.log(message, data);
  }
  
  warn(message, data) {
    if (this.shouldLog('warn')) {
      console.warn('[WARN]', this.formatMessage(message, data));
    }
  }
  
  error(message, data) {
    if (this.shouldLog('error')) {
      console.error('[ERROR]', this.formatMessage(message, data));
      
      // If data is an Error object, log the stack trace
      if (data instanceof Error) {
        console.error('[ERROR_STACK]', data.stack);
      }
    }
  }
}

// Create and export a singleton instance
module.exports = new Logger();
