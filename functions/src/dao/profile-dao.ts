import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { Collections, Documents } from '../models/constants.js';
import { InsightsDoc, ProfileDoc, insightsConverter, profileConverter } from '../models/firestore/index.js';
import { NotFoundError } from '../utils/errors.js';
import { BaseDAO } from './base-dao.js';

/**
 * Data Access Object for Profile documents with Firestore operations
 * Handles conversion between Firestore documents and TypeScript models
 */
export class ProfileDAO extends BaseDAO<ProfileDoc, InsightsDoc> {
  constructor() {
    super(Collections.PROFILES, profileConverter, Collections.INSIGHTS, insightsConverter);
  }

  /**
   * Creates a new profile with transaction support for insights
   */
  async create(userId: string, profileData: Partial<ProfileDoc>): Promise<ProfileDoc> {
    return await this.db.runTransaction(async (transaction) => {
      // Create the main profile document
      const now = Timestamp.now();
      const profileRef = this.getRef(userId);
      const profileDoc = {
        ...profileData,
        created_at: now,
        updated_at: now,
      } as ProfileDoc;
      transaction.set(profileRef, profileDoc);

      // Create the default insights document
      const insightsRef = profileRef
        .collection(this.subcollection!)
        .withConverter(this.subconverter!)
        .doc(Documents.DEFAULT_INSIGHTS);
      const defaultInsights: InsightsDoc = {
        emotional_overview: '',
        key_moments: '',
        recurring_themes: '',
        progress_and_growth: '',
      };
      transaction.set(insightsRef, defaultInsights);

      // Return the created profile (with server timestamps resolved)
      // Since we can't get the actual server timestamp values within the transaction,
      // we'll return the profile data as it would be after the transaction commits
      return {
        ...profileDoc,
        user_id: userId,
        // These will be replaced by actual server timestamps after transaction commits
        created_at: profileDoc.created_at as Timestamp,
        updated_at: profileDoc.updated_at as Timestamp,
      } as ProfileDoc;
    });
  }

  /**
   * Gets a profile by ID including insights from subcollection
   */
  async get(userId: string): Promise<(ProfileDoc & { insights?: InsightsDoc }) | null> {
    const profileRef = this.getRef(userId);
    const profileSnapshot = await profileRef.get();
    if (!profileSnapshot.exists) {
      return null;
    }

    const profileData = profileSnapshot.data() as ProfileDoc;

    // Get insights from subcollection
    try {
      const insightsRef = profileRef
        .collection(this.subcollection!)
        .withConverter(this.subconverter!)
        .doc(Documents.DEFAULT_INSIGHTS);
      const insightsDoc = await insightsRef.get();

      let insights: InsightsDoc | undefined;
      if (insightsDoc.exists) {
        insights = insightsDoc.data() as InsightsDoc;
      }

      return {
        ...profileData,
        insights,
      };
    } catch {
      // If insights retrieval fails, return profile without insights
      return profileData;
    }
  }

  /**
   * Deletes a profile and all its subcollections recursively
   */
  async delete(userId: string): Promise<void> {
    const profileRef = this.getRef(userId);

    // Use Firestore's recursiveDelete to delete the document and all subcollections
    await this.db.recursiveDelete(profileRef);
  }

  /**
   * Fetches multiple profiles by their IDs
   */
  async getAll(userIds: string[]): Promise<ProfileDoc[]> {
    if (userIds.length === 0) return [];

    const docRefs = userIds.map((id) => this.db.collection(this.collection).withConverter(this.converter).doc(id));
    const docs = await this.db.getAll(...docRefs);

    return docs.filter((doc) => doc.exists).map((doc) => doc.data()! as ProfileDoc);
  }

  /**
   * Updates a profile with the given data using a batch
   * Returns the merged profile data without extra reads
   * @param batch Optional batch to add the update operation to. If not provided, creates and commits its own batch
   * @param insights Optional insights data to update in subcollection
   */
  async updateProfile(
    userId: string,
    updates: Partial<ProfileDoc>,
    batch?: FirebaseFirestore.WriteBatch,
    insights?: InsightsDoc,
  ): Promise<ProfileDoc> {
    const shouldCommitBatch = !batch;
    const workingBatch = batch || this.db.batch();

    // First get the existing profile to merge with updates
    const existing = await this.get(userId);
    if (!existing) {
      throw new NotFoundError('Profile not found');
    }

    // Prepare update data with timestamp
    const updateData = {
      ...updates,
      updated_at: Timestamp.now(),
    };

    // Add update to batch
    const docRef = this.db.collection(this.collection).withConverter(this.converter).doc(userId);
    workingBatch.update(docRef, updateData);

    // Update insights if provided
    if (insights) {
      const insightsRef = docRef
        .collection(this.subcollection!)
        .withConverter(this.subconverter!)
        .doc(Documents.DEFAULT_INSIGHTS);
      workingBatch.set(insightsRef, insights, { merge: true });
    }

    // Commit batch if we created it
    if (shouldCommitBatch) {
      await workingBatch.commit();
    }

    // Return the merged data - no extra read!
    return { ...existing, ...updateData } as ProfileDoc;
  }

  /**
   * Increments the friend count for a profile by 1
   * @param userId The user ID of the profile to update
   * @param batch The batch to add the update operation to
   */
  incrementFriendCount(userId: string, batch: FirebaseFirestore.WriteBatch): void {
    const docRef = this.getRef(userId);
    batch.update(docRef, {
      friend_count: FieldValue.increment(1),
      updated_at: Timestamp.now(),
    });
  }

  /**
   * Decrements the friend count for a profile by 1
   * @param userId The user ID of the profile to update
   * @param batch The batch to add the update operation to
   */
  decrementFriendCount(userId: string, batch: FirebaseFirestore.WriteBatch): void {
    const docRef = this.getRef(userId);
    batch.update(docRef, {
      friend_count: FieldValue.increment(-1),
      updated_at: Timestamp.now(),
    });
  }

  /**
   * Extracts analytics data from a profile for tracking purposes
   */
  extractAnalyticsData(profile: ProfileDoc): Record<string, string | number | boolean> {
    return {
      has_name: !!profile.name,
      has_avatar: !!profile.avatar,
      has_location: !!profile.location,
      has_birthday: !!profile.birthday,
      has_notification_settings: profile.notification_settings.length > 0,
      nudging_occurrence: profile.nudging_settings.occurrence,
      has_gender: !!profile.gender,
      goal: profile.goal,
      connect_to: profile.connect_to,
      personality: profile.personality,
      tone: profile.tone,
    };
  }
}
