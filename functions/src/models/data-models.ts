import { Timestamp } from 'firebase-admin/firestore';
import { FriendSummaryEventParams } from './analytics-events.js';

/**
 * Interface for profile data
 */
export interface ProfileData {
  name: string;
  gender: string;
  location: string;
  age: string;
}

/**
 * Interface for summary context data
 */
export interface SummaryContext {
  summaryId: string;
  summaryRef: FirebaseFirestore.DocumentReference;
  existingSummary: string;
  existingSuggestions: string;
  updateCount: number;
  isNewSummary: boolean;
  existingCreatedAt?: Timestamp;
  creatorProfile: ProfileData;
  friendProfile: ProfileData;
}

/**
 * Interface for summary result data
 */
export interface SummaryResult {
  summary: string;
  suggestions: string;
  updateId: string;
  analytics: FriendSummaryEventParams;
}
