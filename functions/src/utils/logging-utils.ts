/**
 * Log levels in order of severity
 */
const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
} as const;

// Set minimum log level here
const MIN_LOG_LEVEL = LogLevel.WARN;

/**
 * Creates and returns a logger with the specified name.
 *
 * This utility function provides a standardized way to create loggers
 * across the application, ensuring consistent formatting and behavior.
 *
 * @param name - The name for the logger, typically __filename from the calling module
 * @returns A configured logger instance with consistent formatting
 */
export const getLogger = (name: string) => {
  // Format the name to be more readable (remove file extension and path)
  const formattedName = name.split('/').pop()?.replace('.ts', '') || name;

  return {
    info: (message: string, ...args: any[]) => {
      if (MIN_LOG_LEVEL <= LogLevel.INFO) {
        const timestamp = new Date().toISOString();
        console.log(
          `[${timestamp}] [${formattedName}] [INFO] ${message}`,
          ...args,
        );
      }
    },
    warn: (message: string, ...args: any[]) => {
      if (MIN_LOG_LEVEL <= LogLevel.WARN) {
        const timestamp = new Date().toISOString();
        console.warn(
          `[${timestamp}] [${formattedName}] [WARN] ${message}`,
          ...args,
        );
      }
    },
    error: (message: string, ...args: any[]) => {
      if (MIN_LOG_LEVEL <= LogLevel.ERROR) {
        const timestamp = new Date().toISOString();
        console.error(
          `[${timestamp}] [${formattedName}] [ERROR] ${message}`,
          ...args,
        );
      }
    },
    debug: (message: string, ...args: any[]) => {
      if (MIN_LOG_LEVEL <= LogLevel.DEBUG) {
        const timestamp = new Date().toISOString();
        console.debug(
          `[${timestamp}] [${formattedName}] [DEBUG] ${message}`,
          ...args,
        );
      }
    },
  };
};
