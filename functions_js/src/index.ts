import { defineSecret } from 'firebase-functions/params';
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { app } from "./app";
import { Collections } from "./models/constants";
import { onUpdateCreated } from "./updates/on-creation";

// Define the API key secret for Gemini
const geminiApiKey = defineSecret("GEMINI_API_KEY");

// Export the main HTTP API function with proper configuration
export const api = onRequest({
  secrets: [geminiApiKey],
}, app);

// Export the Firestore trigger function for new updates
export const process_update_creation = onDocumentCreated(
  `${Collections.UPDATES}/{id}`,
  (event) => onUpdateCreated(event)
);
