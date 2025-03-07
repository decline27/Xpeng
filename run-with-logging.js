/**
 * Enhanced script to run the Homey app with improved file logging
 * This script manages log directories and provides a summary of logging after execution
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Set up log directory and files
const logDir = path.join(process.cwd(), 'logs');
const logFiles = {
  terminal: path.join(logDir, 'terminal.log'),
  debug: path.join(logDir, 'debug.log'),
  app: path.join(logDir, 'app.log'),
  info: path.join(logDir, 'info.log'),
  exceptions: path.join(logDir, 'exceptions.log'),
  warnings: path.join(logDir, 'warnings.log')
};

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',   // DEBUG
  green: '\x1b[32m',  // INFO
  yellow: '\x1b[33m', // WARN
  red: '\x1b[31m',    // ERROR
};

// Create timestamp function
const timestamp = () => new Date().toISOString();

// Create log directory if it doesn't exist
function ensureLogDirectory() {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

// Reset or backup log files
function resetLogs(backup = false) {
  ensureLogDirectory();
  
  if (backup) {
    // Create backup directory with timestamp
    const backupDir = path.join(logDir, `backup_${new Date().toISOString().replace(/[:.]/g, '_')}`);
    fs.mkdirSync(backupDir, { recursive: true });
    
    // Move existing logs to backup directory
    Object.values(logFiles).forEach(logFile => {
      if (fs.existsSync(logFile)) {
        const backupPath = path.join(backupDir, path.basename(logFile));
        fs.copyFileSync(logFile, backupPath);
        console.log(`Backed up ${path.basename(logFile)} to backup directory`);
      }
    });
  }
  
  // Create/truncate log files
  Object.values(logFiles).forEach(logFile => {
    fs.writeFileSync(logFile, '');
    console.log(`Reset log file: ${path.basename(logFile)}`);
  });
}

// Function to filter and route logs by level
function processLogLine(line) {
  // Always write the full log to the terminal log and app log
  fs.appendFileSync(logFiles.terminal, line + '\n');
  fs.appendFileSync(logFiles.app, line + '\n');
  
  // Categorize logs by level and write to appropriate files
  if (line.includes('[DEBUG]')) {
    fs.appendFileSync(logFiles.debug, line + '\n');
    console.log(`${colors.cyan}${line}${colors.reset}`);
  } else if (line.includes('[ERROR]') || line.includes('[ERROR_STACK]')) {
    fs.appendFileSync(logFiles.exceptions, line + '\n');
    console.log(`${colors.red}${line}${colors.reset}`);
  } else if (line.includes('[WARN]')) {
    fs.appendFileSync(logFiles.warnings, line + '\n');
    console.log(`${colors.yellow}${line}${colors.reset}`);
  } else if (line.includes('[INFO]')) {
    fs.appendFileSync(logFiles.info, line + '\n');
    console.log(`${colors.green}${line}${colors.reset}`);
  } else {
    console.log(line);
  }
}

// Function to display log files
function showLogs(logFile, lines = 10) {
  console.log('');
  console.log(`--- Last ${lines} lines of ${path.basename(logFile)} ---`);
  
  if (fs.existsSync(logFile) && fs.statSync(logFile).size > 0) {
    const content = fs.readFileSync(logFile, 'utf8');
    const allLines = content.split('\n');
    const lastLines = allLines.slice(-lines);
    lastLines.forEach(line => console.log(line));
  } else {
    console.log(`Log file is empty or does not exist: ${logFile}`);
  }
  console.log('--------------------------------');
}

// Function to count log entries by type
function countLogEntries() {
  const content = fs.readFileSync(logFiles.app, 'utf8');
  const infoCount = (content.match(/\[INFO\]/g) || []).length;
  const warnCount = (content.match(/\[WARN\]/g) || []).length;
  const errorCount = (content.match(/\[ERROR\]/g) || []).length;
  const debugCount = (content.match(/\[DEBUG\]/g) || []).length;
  
  return { infoCount, warnCount, errorCount, debugCount };
}

// Main function to run the app with logging
async function runWithLogging() {
  console.log('====== Xpeng Enhanced Logging Script ======');
  
  // Ask if user wants to backup or clear logs
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const backupChoice = await new Promise(resolve => {
    rl.question('Do you want to backup existing logs? (y/n): ', answer => {
      resolve(answer.toLowerCase() === 'y');
    });
  });
  
  resetLogs(backupChoice);
  
  // First, run the test script to verify file logging
  console.log('Running file logging test...');
  require('./test-file-logging');
  
  // Ask the user if they want to continue with running the Homey app
  const runApp = await new Promise(resolve => {
    rl.question('Do you want to run the Homey app with enhanced logging? (y/n): ', answer => {
      resolve(answer.toLowerCase() === 'y');
    });
  });
  
  if (!runApp) {
    rl.close();
    console.log('Skipping Homey app run.');
    return;
  }
  
  // Set up timestamp for this run
  const startTimestamp = timestamp();
  const logHeader = `====== Xpeng Session Started at ${startTimestamp} ======`;
  fs.appendFileSync(logFiles.terminal, logHeader + '\n');
  fs.appendFileSync(logFiles.app, logHeader + '\n');
  console.log(logHeader);
  
  // Ask if user wants to filter log output
  const filterChoice = await new Promise(resolve => {
    rl.question('Do you want to filter log output? (all/info/warn/error/debug/none): ', answer => {
      resolve(answer.toLowerCase());
      rl.close();
    });
  });
  
  console.log('Running Homey app with enhanced logging...');
  console.log('Press Ctrl+C to stop the app');
  
  // Set environment variable to force file logging
  process.env.FORCE_FILE_LOGGING = 'true';
  
  // Check if homey CLI is installed
  let homeyInstalled = false;
  try {
    const homeyCheck = spawn('homey', ['--version'], { stdio: 'pipe' });
    homeyInstalled = true;
  } catch (error) {
    console.warn('Homey CLI not found. Will attempt to use "npm run build" instead.');
  }
  
  // Run the Homey app or use npm as fallback
  const homeyApp = homeyInstalled ? 
    spawn('homey', ['app', 'run'], {
      env: { ...process.env, FORCE_FILE_LOGGING: 'true' },
      stdio: 'pipe'
    }) : 
    spawn('npm', ['run', 'build'], {
      env: { ...process.env, FORCE_FILE_LOGGING: 'true' },
      stdio: 'pipe'
    });
  
  // Process output
  homeyApp.stdout.on('data', data => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        processLogLine(line);
      }
    });
  });
  
  homeyApp.stderr.on('data', data => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        // Mark stderr output as errors if they don't already have a level
        const logLine = line.includes('[ERROR]') || line.includes('[WARN]') || 
                      line.includes('[INFO]') || line.includes('[DEBUG]') ? 
                      line : `[ERROR] ${line}`;
        processLogLine(logLine);
      }
    });
  });
  
  // Handle app termination
  homeyApp.on('close', code => {
    const endTimestamp = timestamp();
    const logFooter = `====== Xpeng Session Completed at ${endTimestamp} ======`;
    fs.appendFileSync(logFiles.terminal, logFooter + '\n');
    fs.appendFileSync(logFiles.app, logFooter + '\n');
    console.log(logFooter);
    
    // Summary of logs
    console.log('');
    console.log('=== LOG SUMMARY ===');
    
    // Show terminal log
    showLogs(logFiles.terminal, 10);
    
    // Show separated logs
    showLogs(logFiles.info, 5);
    showLogs(logFiles.warnings, 5);
    showLogs(logFiles.exceptions, 5);
    showLogs(logFiles.debug, 5);
    
    // Count entries in each log
    const { infoCount, warnCount, errorCount, debugCount } = countLogEntries();
    
    console.log('');
    console.log('=== LOG STATISTICS ===');
    console.log(`INFO messages: ${infoCount}`);
    console.log(`WARNING messages: ${warnCount}`);
    console.log(`ERROR messages: ${errorCount}`);
    console.log(`DEBUG messages: ${debugCount}`);
    
    console.log('');
    console.log('Log files are located at:');
    console.log(`- Full Log: ${logFiles.app}`);
    console.log(`- Terminal Log: ${logFiles.terminal}`);
    console.log(`- Info Log: ${logFiles.info}`);
    console.log(`- Warning Log: ${logFiles.warnings}`);
    console.log(`- Error Log: ${logFiles.exceptions}`);
    console.log(`- Debug Log: ${logFiles.debug}`);
    
    console.log('');
    console.log('Quick log analysis commands:');
    console.log(`- View all errors: grep '\\[ERROR\\]' ${logFiles.app}`);
    console.log(`- View warnings: grep '\\[WARN\\]' ${logFiles.app}`);
    console.log(`- Monitor logs in real-time: tail -f ${logFiles.app}`);
    console.log(`- Count log entries by type: grep -c '\\[INFO\\]' ${logFiles.app}`);
    
    console.log('');
    console.log('Enhanced logging session complete.');
  });
}

// Run the main function
runWithLogging().catch(error => {
  console.error('Error in runWithLogging:', error);
});