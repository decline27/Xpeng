/**
 * Test script for file logging functionality
 */
// Set the log level to debug for testing
process.env.XPENG_LOG_LEVEL = 'debug';
process.env.FORCE_FILE_LOGGING = 'true';

const logger = require('./lib/logger');

// Enable file logging
logger.enableFileLogging(true);

// Log at different levels
console.log('--- Testing logger file output ---');

logger.debug('This is a debug message', { detail: 'Debug details', timestamp: new Date() });
logger.info('This is an info message', { status: 'ok' });
logger.warn('This is a warning message', { warning: 'Something might be wrong' });

try {
    throw new Error('Test error for logging');
} catch (error) {
    logger.error('This is an error message', error);
}

// Create an object with circular reference for testing
const circularObj = { name: 'Circular Object Test' };
circularObj.self = circularObj;

logger.debug('Testing circular reference handling', circularObj);

// End the session
logger.shutdown();

console.log('--- File logging test complete ---');
console.log('Log files are available in the logs/ directory');