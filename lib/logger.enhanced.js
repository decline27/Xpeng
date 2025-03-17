// Enhanced logger module with file logging and color-coded output
const Homey = require('homey');
const fs = require('fs');
const path = require('path');
const os = require('os');

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
    
    // ANSI colors for console output
    this.colors = {
      debug: '\x1b[36m', // Cyan
      info: '\x1b[32m',  // Green
      warn: '\x1b[33m',  // Yellow
      error: '\x1b[31m', // Red
      reset: '\x1b[0m'
    };
    
    this.logDir = process.env.XPENG_LOG_DIR || path.join(process.cwd(), 'logs');
    this.fileLoggingEnabled = process.env.FORCE_FILE_LOGGING === 'true';
    
    // Set up log file paths
    this.setupLogFiles();
    
    // Initialize log files if file logging is enabled
    if (this.fileLoggingEnabled) {
      this.initializeLogFiles();
    }
  }

  setupLogFiles() {
    // Set up log file paths
    this.logFiles = {
      all: path.join(this.logDir, 'app.log'),
      terminal: path.join(this.logDir, 'terminal.log'),
      debug: path.join(this.logDir, 'debug.log'),
      info: path.join(this.logDir, 'info.log'),
      warn: path.join(this.logDir, 'warnings.log'),
      error: path.join(this.logDir, 'exceptions.log')
    };
  }

  appendToAllLogFiles(message) {
    if (!this.fileLoggingEnabled) return;
    
    try {
      fs.appendFileSync(this.logFiles.all, message + os.EOL);
      fs.appendFileSync(this.logFiles.terminal, message + os.EOL);
    } catch (error) {
      console.error('Failed to write to log files:', error);
    }
  }
  
  appendToLogFile(level, message) {
    if (!this.fileLoggingEnabled) return;
    
    try {
      // Always append to terminal and all logs
      fs.appendFileSync(this.logFiles.terminal, message + os.EOL);
      fs.appendFileSync(this.logFiles.all, message + os.EOL);
      
      // Append to specific log file based on level
      let logFile;
      if (level === 'debug') {
        logFile = this.logFiles.debug;
      } else if (level === 'info') {
        logFile = this.logFiles.info;
      } else if (level === 'warn') {
        logFile = this.logFiles.warn;
      } else {
        logFile = this.logFiles.error;
      }
      
      fs.appendFileSync(logFile, message + os.EOL);
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  initializeLogFiles() {
    try {
      // Create log directory if it doesn't exist
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      
      // Log session start
      const sessionHeader = `====== Xpeng Session Started at ${new Date().toISOString()} ======`;
      
      // Write session header to log files
      fs.appendFileSync(this.logFiles.all, sessionHeader + os.EOL);
      fs.appendFileSync(this.logFiles.terminal, sessionHeader + os.EOL);
      
      console.log(`File logging enabled. Log files will be stored in: ${this.logDir}`);
    } catch (error) {
      console.error('Failed to initialize log files:', error);
      this.fileLoggingEnabled = false;
    }
  }

  setLogLevel(level) {
    if (this.levels[level] !== undefined) {
      this.logLevel = level;
    }
  }
  
  enableFileLogging(enabled = true) {
    this.fileLoggingEnabled = enabled;
    if (enabled) {
      this.initializeLogFiles();
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
      const formattedMessage = this.formatMessage(message, data);
      const logEntry = `[DEBUG] ${formattedMessage}`;
      
      console.log(this.colors.debug + logEntry + this.colors.reset);
      
      if (this.fileLoggingEnabled) {
        this.appendToLogFile('debug', logEntry);
      }
    }
  }
  
  log(message, data) {
    if (this.shouldLog('info')) {
      const formattedMessage = this.formatMessage(message, data);
      const logEntry = `[INFO] ${formattedMessage}`;
      
      console.log(this.colors.info + logEntry + this.colors.reset);
      
      if (this.fileLoggingEnabled) {
        this.appendToLogFile('info', logEntry);
      }
    }
  }
  
  info(message, data) {
    this.log(message, data);
  }
  
  warn(message, data) {
    if (this.shouldLog('warn')) {
      const formattedMessage = this.formatMessage(message, data);
      const logEntry = `[WARN] ${formattedMessage}`;
      
      console.warn(this.colors.warn + logEntry + this.colors.reset);
      
      if (this.fileLoggingEnabled) {
        this.appendToLogFile('warn', logEntry);
      }
    }
  }
  
  error(message, data) {
    if (this.shouldLog('error')) {
      const formattedMessage = this.formatMessage(message, data);
      const logEntry = `[ERROR] ${formattedMessage}`;
      
      console.error(this.colors.error + logEntry + this.colors.reset);
      
      if (this.fileLoggingEnabled) {
        this.appendToLogFile('error', logEntry);
      }
      
      // If data is an Error object, log the stack trace separately
      if (data instanceof Error) {
        const stackEntry = `[ERROR_STACK] ${data.stack}`;
        console.error(this.colors.error + stackEntry + this.colors.reset);
        
        if (this.fileLoggingEnabled) {
          this.appendToLogFile('error', stackEntry);
        }
      }
    }
  }
  
  shutdown() {
    if (this.fileLoggingEnabled) {
      const sessionFooter = `====== Xpeng Session Ended at ${new Date().toISOString()} ======`;
      try {
        fs.appendFileSync(this.logFiles.all, sessionFooter + os.EOL);
        fs.appendFileSync(this.logFiles.terminal, sessionFooter + os.EOL);
        console.log('Logger session ended.');
      } catch (error) {
        console.error('Failed to write session footer:', error);
      }
    }
  }
}

// Create and export a singleton instance
module.exports = new Logger();