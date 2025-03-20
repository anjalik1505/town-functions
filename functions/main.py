# This file re-exports the functions from functions.py and triggers.py
# to maintain compatibility with Firebase's expected structure

# Import and re-export the Firestore trigger function
from triggers import process_update_creation

# Import and re-export the HTTP API function
from functions import api

# These exports allow Firebase to find the functions in their expected location
__all__ = ["api", "process_update_creation"]
