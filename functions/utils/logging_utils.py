import logging

def get_logger(name):
    """
    Creates and returns a logger with the specified name.
    
    This utility function provides a standardized way to create loggers
    across the application, ensuring consistent formatting and behavior.
    
    Args:
        name: The name for the logger, typically __name__ from the calling module
        
    Returns:
        A configured logger instance
    """
    logger = logging.getLogger(name)
    
    # Only configure handlers if they haven't been added yet
    if not logger.handlers:
        # Set the logging level
        logger.setLevel(logging.INFO)
        
        # Create a handler for console output
        handler = logging.StreamHandler()
        
        # Create a formatter and set it for the handler
        formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        handler.setFormatter(formatter)
        
        # Add the handler to the logger
        logger.addHandler(handler)
    
    return logger
