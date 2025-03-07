#!/bin/bash
# Wrapper script for running the Node.js enhanced logging script

# Set executable permission for this script if needed
if [ ! -x "$0" ]; then
  chmod +x "$0"
  echo "Set executable permission for this script"
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
  echo "Error: Node.js is not installed. Please install Node.js to use this script."
  exit 1
fi

# Set environment variable to force file logging
export FORCE_FILE_LOGGING=true

echo "Starting Xpeng enhanced logging..."
node run-with-logging.js

# Clean up
unset FORCE_FILE_LOGGING