# Town Functions - GenKit Integration Guide

This guide explains how to integrate and deploy the Town application's AI flows using Firebase and GenKit.

## Setup Steps

### 1. Set up API Key for Development

The application uses the Gemini API for generating insights. For local development, you can set the API key as an
environment variable:

```bash
# For Windows
set GEMINI_API_KEY=your-api-key-here

# For Mac/Linux
export GEMINI_API_KEY=your-api-key-here
```

You can obtain a Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).

### 2. Set up API Key for Production

Before deploying to Firebase, set up the API key in Firebase Secret Manager:

```bash
firebase functions:secrets:set GEMINI_API_KEY
```

When prompted, enter your Gemini API key.

### 3. Deploy to Firebase

Deploy your functions to Firebase:

```bash
firebase deploy --only functions
```

## Implementation Details

The GenKit flows are integrated with the existing Firestore triggers following these principles:

1. **Atomic Database Operations**: All related Firestore operations are grouped in a single batch for atomicity,
   following the Town application's best practices.

2. **Validation Before Writes**: All validations are performed before starting any database write operations.

3. **Efficient Data Fetching**: The implementation uses batch fetching for related documents when possible instead of
   individual queries.

4. **Proper Error Handling**: The flows include retry logic and proper error handling to ensure robustness.

5. **Comprehensive Logging**: Detailed logging is implemented to track the success and failure of AI generation
   processes.

## Architecture

The application uses Firestore trigger functions that internally use GenKit flows:

- **Firestore Trigger Function**: The `process_update_creation` function is triggered when a new update is created in
  Firestore. It processes the update using GenKit flows to generate AI insights for the creator and their friends.

- **AI Flows**: The flows are defined in the `flows.ts` file and are used internally by the Firestore trigger function.

## Troubleshooting

If you encounter issues with the API key:

1. Make sure the API key is correctly set in Firebase Secret Manager.
2. Check that the region you're deploying to has access to the Gemini API.
3. Verify that your Firebase project is on the Blaze plan, which is required for external API calls.

If you encounter issues with the functions:

1. Check the Firebase Functions logs in the Firebase console.
2. Ensure that the Vertex AI API is enabled in your Google Cloud project.
