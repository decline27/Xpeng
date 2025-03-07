/**
 * Simple logging test that doesn't rely on any Homey-specific code
 * Can be used to quickly test the logging functionality
 */

// Configure logging environment
process.env.XPENG_LOG_LEVEL = 'debug'; 
process.env.FORCE_FILE_LOGGING = 'true';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Create log directory
const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Set up log files
const logFiles = {
  all: path.join(logDir, 'app.log'),
  terminal: path.join(logDir, 'terminal.log'),
  debug: path.join(logDir, 'debug.log'),
  info: path.join(logDir, 'info.log'),
  warn: path.join(logDir, 'warnings.log'),
  error: path.join(logDir, 'exceptions.log')
};

// Create/truncate all log files
Object.values(logFiles).forEach(file => {
  fs.writeFileSync(file, '');
});

// Utility to format timestamp
const timestamp = () => new Date().toISOString();

// Log levels
const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

// ANSI colors
const colors = {
  DEBUG: '\x1b[36m', // Cyan
  INFO: '\x1b[32m',  // Green
  WARN: '\x1b[33m',  // Yellow
  ERROR: '\x1b[31m', // Red
  reset: '\x1b[0m'
};

// Simple log function
function log(level, message, data = null) {
  const time = timestamp();
  
  // Format data if provided
  let dataStr = '';
  if (data) {
    try {
      // Handle circular references by using a custom replacer
      const seen = new WeakSet();
      dataStr = JSON.stringify(data, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[Circular]';
          seen.add(value);
        }
        if (typeof value === 'function') return '[Function]';
        return value;
      }, 2);
    } catch (e) {
      dataStr = `[Data could not be stringified: ${e.message}]`;
    }
  }
  
  // Format the log entry
  const entry = `[${level}] [${time}] ${message} ${dataStr}`;
  
  // Write to console with color
  console.log(`${colors[level]}${entry}${colors.reset}`);
  
  // Write to appropriate log files
  fs.appendFileSync(logFiles.terminal, entry + os.EOL);
  fs.appendFileSync(logFiles.all, entry + os.EOL);
  
  // Write to level-specific log file
  const levelFile = level === 'DEBUG' ? logFiles.debug : 
                   level === 'INFO' ? logFiles.info :
                   level === 'WARN' ? logFiles.warn :
                   logFiles.error;
  
  fs.appendFileSync(levelFile, entry + os.EOL);
}

// Start testing
console.log('=== Simple Logging Test ===');
log('INFO', 'Starting simple logging test');

// Test all log levels
log('DEBUG', 'This is a debug message', { component: 'test', detail: 'Testing debug level' });
log('INFO', 'This is an info message', { status: 'running' });
log('WARN', 'This is a warning message', { warning: 'Something to watch out for' });
log('ERROR', 'This is an error message', new Error('Test error'));

// Test with circular reference
const circularObj = { name: 'Circular Test' };
circularObj.self = circularObj;
log('DEBUG', 'Testing with circular reference', circularObj);

// Test with complex data
log('INFO', 'Complex data test', {
  user: {
    name: 'Test User',
    roles: ['admin', 'user'],
    settings: {
      theme: 'dark',
      notifications: true
    }
  },
  stats: {
    uptime: 1234567,
    requests: 42,
    errors: 0
  }
});

// Log completion
log('INFO', 'Simple logging test completed');

// Display log locations
console.log('\nLog files have been written to:');
Object.entries(logFiles).forEach(([type, file]) => {
  console.log(`- ${type}: ${file}`);
});

console.log('\nTest completed successfully!');