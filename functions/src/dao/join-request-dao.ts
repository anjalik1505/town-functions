import { DocumentReference, Query, Timestamp, WriteBatch } from 'firebase-admin/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { Collections, MAX_BATCH_OPERATIONS, QueryOperators } from '../models/constants.js';
import { JoinRequestDoc, SimpleProfile, joinRequestConverter, jrf } from '../models/firestore/index.js';
import { getLogger } from '../utils/logging-utils.js';
import { applyPagination, generateNextCursor, processQueryStream } from '../utils/pagination-utils.js';
import { BaseDAO } from './base-dao.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Data Access Object for Join Request documents
 * Manages join_requests subcollection under invitations
 */
export class JoinRequestDAO extends BaseDAO<JoinRequestDoc> {
  constructor() {
    super(Collections.INVITATIONS, joinRequestConverter, Collections.JOIN_REQUESTS);
  }

  /**
   * Creates a new join request
   * @param invitationId The invitation ID this request belongs to
   * @param requestData The join request data with denormalized profiles
   * @returns The created request document with ID
   */
  async create(invitationId: string, requestData: Omit<JoinRequestDoc, 'request_id'>): Promise<JoinRequestDoc> {
    const requestRef = this.db
      .collection(this.collection)
      .doc(invitationId)
      .collection(this.subcollection!)
      .withConverter(this.converter)
      .doc();

    const now = Timestamp.now();
    const fullRequestData: JoinRequestDoc = {
      ...requestData,
      created_at: now,
      updated_at: now,
    } as JoinRequestDoc;

    await requestRef.set(fullRequestData);
    return {
      ...fullRequestData,
      request_id: requestRef.id,
    };
  }

  /**
   * Gets join requests for an invitation owner (received requests)
   * @param invitationId The invitation ID to get requests for
   * @param pagination Pagination options
   * @returns Paginated join requests
   */
  async getByInvitation(
    invitationId: string,
    pagination?: { limit?: number; afterCursor?: string },
  ): Promise<{ requests: JoinRequestDoc[]; nextCursor: string | null }> {
    const limit = pagination?.limit || 20;

    let query: Query = this.db
      .collection(Collections.INVITATIONS)
      .doc(invitationId)
      .collection(this.subcollection!)
      .withConverter(this.converter)
      .orderBy(jrf('created_at'), QueryOperators.DESC);

    // Apply pagination
    const paginatedQuery = await applyPagination(query, pagination?.afterCursor, limit);

    // Process the query stream
    const { items, lastDoc } = await processQueryStream(
      paginatedQuery,
      (doc) => {
        const data = doc.data()! as JoinRequestDoc;
        return {
          ...data,
          request_id: doc.id, // Return simple ID
        };
      },
      limit,
    );

    // Generate next cursor
    const nextCursor = generateNextCursor(lastDoc, items.length, limit);

    return {
      requests: items,
      nextCursor,
    };
  }

  /**
   * Gets join requests sent by a user across all invitations
   * @param userId The user ID who sent the requests
   * @param pagination Pagination options
   * @returns Paginated join requests
   */
  async getByUser(
    userId: string,
    pagination?: { limit?: number; afterCursor?: string },
  ): Promise<{ requests: JoinRequestDoc[]; nextCursor: string | null }> {
    const limit = pagination?.limit || 20;

    // This requires a collection group query
    let query: Query = this.db
      .collectionGroup(this.subcollection!)
      .withConverter(this.converter)
      .where(jrf('requester_id'), QueryOperators.EQUALS, userId)
      .orderBy(jrf('created_at'), QueryOperators.DESC);

    // Apply pagination
    const paginatedQuery = await applyPagination(query, pagination?.afterCursor, limit);

    // Process the query stream
    const { items, lastDoc } = await processQueryStream(
      paginatedQuery,
      (doc) => {
        const data = doc.data()! as JoinRequestDoc;
        const invitationId = doc.ref.parent.parent?.id || data.invitation_id;
        return {
          ...data,
          request_id: doc.id, // Return simple ID
          invitation_id: invitationId,
        };
      },
      limit,
    );

    // Generate next cursor
    const nextCursor = generateNextCursor(lastDoc, items.length, limit);

    return {
      requests: items,
      nextCursor,
    };
  }

  /**
   * Gets a specific join request by invitation ID and request ID
   * Following the pattern from getJoinRequestDoc in invitation-utils.ts
   * @param invitationId The invitation ID containing the join request
   * @param requestId The join request ID
   * @returns The join request document, or null if not found
   */
  async getByInvitationAndRequest(invitationId: string, requestId: string): Promise<JoinRequestDoc | null> {
    const requestRef = this.db
      .collection(this.collection)
      .doc(invitationId)
      .collection(this.subcollection!)
      .withConverter(this.converter)
      .doc(requestId);

    const requestDoc = await requestRef.get();

    if (!requestDoc.exists) {
      return null;
    }

    const data = requestDoc.data();
    if (!data) {
      return null;
    }

    return {
      ...data,
      request_id: requestDoc.id,
      invitation_id: invitationId,
    } as JoinRequestDoc;
  }

  /**
   * Updates the status of a join request
   * @param invitationId The invitation ID
   * @param requestId The join request ID
   * @param status The new status
   * @returns The updated join request document
   */
  async updateStatus(invitationId: string, requestId: string, status: string): Promise<JoinRequestDoc> {
    const requestRef = this.db
      .collection(this.collection)
      .doc(invitationId)
      .collection(this.subcollection!)
      .withConverter(this.converter)
      .doc(requestId);

    await requestRef.update({
      status,
      updated_at: Timestamp.now(),
    });

    // Get the updated document
    const updatedDoc = await requestRef.get();
    if (!updatedDoc.exists) {
      throw new Error('Join request not found after update');
    }

    const data = updatedDoc.data();
    if (!data) {
      throw new Error('Join request data is undefined');
    }

    return { ...data, request_id: updatedDoc.id } as JoinRequestDoc; // Return simple ID
  }

  /**
   * Deletes a join request using a batch
   * @param invitationId The invitation ID
   * @param requestId The join request ID
   * @param batch The batch to add the delete operation to
   */
  delete(invitationId: string, requestId: string, batch: FirebaseFirestore.WriteBatch): void {
    const requestRef = this.db
      .collection(this.collection)
      .doc(invitationId)
      .collection(this.subcollection!)
      .doc(requestId);

    batch.delete(requestRef);
  }

  /**
   * Deletes all join requests for an invitation using a batch
   * @param invitationId The invitation ID
   * @param batch The batch to add the delete operations to
   * @returns The number of join requests deleted
   */
  async deleteAll(invitationId: string, batch: FirebaseFirestore.WriteBatch): Promise<number> {
    let deletedCount = 0;

    // Stream all join requests for this invitation and add them to the batch
    for await (const { requestRef } of this.streamJoinRequestsByInvitation(invitationId)) {
      batch.delete(requestRef);
      deletedCount++;
    }

    logger.info(`Added ${deletedCount} join request deletions to batch for invitation ${invitationId}`);
    return deletedCount;
  }

  /**
   * Checks if a join request exists for a specific user and invitation
   * Optionally filters by status
   * @param invitationId The invitation ID
   * @param requesterId The requester's user ID
   * @param status Optional status filter
   * @returns The existing join request or null
   */
  async get(invitationId: string, requesterId: string, status?: string | string[]): Promise<JoinRequestDoc | null> {
    let query: Query = this.db
      .collection(this.collection)
      .doc(invitationId)
      .collection(this.subcollection!)
      .withConverter(this.converter)
      .where(jrf('requester_id'), QueryOperators.EQUALS, requesterId);

    if (status) {
      if (Array.isArray(status)) {
        query = query.where(jrf('status'), QueryOperators.IN, status);
      } else {
        query = query.where(jrf('status'), QueryOperators.EQUALS, status);
      }
    }

    query = query.limit(1);
    const snapshot = await query.get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0]!;
    const data = doc.data();
    if (!data) {
      return null;
    }

    return {
      ...data,
      request_id: doc.id,
      invitation_id: invitationId,
    } as JoinRequestDoc;
  }

  /**
   * Updates the requester profile fields in a join request document
   * @param invitationId The invitation ID containing the join request
   * @param requestId The join request ID
   * @param newProfile The new requester profile data
   * @param batch Optional WriteBatch to add the operation to
   */
  async updateRequesterProfile(
    invitationId: string,
    requestId: string,
    newProfile: SimpleProfile,
    batch?: WriteBatch,
  ): Promise<void> {
    const shouldCommitBatch = !batch;
    const workingBatch = batch || this.db.batch();

    const requestRef = this.db
      .collection(this.collection)
      .doc(invitationId)
      .collection(this.subcollection!)
      .doc(requestId);

    workingBatch.update(requestRef, {
      requester_username: newProfile.username,
      requester_name: newProfile.name,
      requester_avatar: newProfile.avatar,
      updated_at: Timestamp.now(),
    });

    if (shouldCommitBatch) {
      await workingBatch.commit();
    }

    logger.info(`Updated requester profile for join request ${requestId} in invitation ${invitationId}`);
  }

  /**
   * Updates the receiver profile fields in a join request document
   * @param invitationId The invitation ID containing the join request
   * @param requestId The join request ID
   * @param newProfile The new receiver profile data
   * @param batch Optional WriteBatch to add the operation to
   */
  async updateReceiverProfile(
    invitationId: string,
    requestId: string,
    newProfile: SimpleProfile,
    batch?: WriteBatch,
  ): Promise<void> {
    const shouldCommitBatch = !batch;
    const workingBatch = batch || this.db.batch();

    const requestRef = this.db
      .collection(this.collection)
      .doc(invitationId)
      .collection(this.subcollection!)
      .doc(requestId);

    workingBatch.update(requestRef, {
      receiver_username: newProfile.username,
      receiver_name: newProfile.name,
      receiver_avatar: newProfile.avatar,
      updated_at: Timestamp.now(),
    });

    if (shouldCommitBatch) {
      await workingBatch.commit();
    }

    logger.info(`Updated receiver profile for join request ${requestId} in invitation ${invitationId}`);
  }

  /**
   * Streams all join requests made by a specific user (requester) with streaming support
   * @param userId The user ID who made the join requests
   * @returns AsyncIterable of { doc: JoinRequestDoc, invitationRef: DocumentReference, requestRef: DocumentReference }
   */
  async *streamJoinRequestsByRequester(
    userId: string,
  ): AsyncIterable<{ doc: JoinRequestDoc; invitationRef: DocumentReference; requestRef: DocumentReference }> {
    logger.info(`Streaming join requests by requester: ${userId}`);

    try {
      // Use collection group query to search across all join request subcollections
      const query = this.db
        .collectionGroup(this.subcollection!)
        .withConverter(this.converter)
        .where(jrf('requester_id'), QueryOperators.EQUALS, userId)
        .orderBy(jrf('created_at'), QueryOperators.DESC);

      // Stream the query results
      const stream = query.stream() as AsyncIterable<FirebaseFirestore.QueryDocumentSnapshot<JoinRequestDoc>>;

      for await (const docSnapshot of stream) {
        const joinRequestData = docSnapshot.data();
        if (joinRequestData) {
          // Extract the parent invitation reference from the document reference path
          // Path structure: /invitations/{invitationId}/join_requests/{requestId}
          const invitationRef = docSnapshot.ref.parent.parent;
          if (invitationRef) {
            yield {
              doc: { ...joinRequestData, request_id: docSnapshot.id },
              invitationRef,
              requestRef: docSnapshot.ref,
            };
          }
        }
      }
    } catch (error) {
      logger.error(`Error streaming join requests by requester ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Streams all join requests for a specific invitation with streaming support
   * @param invitationId The invitation ID to get join requests for
   * @returns AsyncIterable of { doc: JoinRequestDoc, requestRef: DocumentReference }
   */
  async *streamJoinRequestsByInvitation(
    invitationId: string,
  ): AsyncIterable<{ doc: JoinRequestDoc; requestRef: DocumentReference }> {
    logger.info(`Streaming join requests for invitation: ${invitationId}`);

    try {
      const query = this.db
        .collection(this.collection)
        .doc(invitationId)
        .collection(this.subcollection!)
        .withConverter(this.converter)
        .orderBy(jrf('created_at'), QueryOperators.DESC);

      // Stream the query results
      const stream = query.stream() as AsyncIterable<FirebaseFirestore.QueryDocumentSnapshot<JoinRequestDoc>>;

      for await (const docSnapshot of stream) {
        const joinRequestData = docSnapshot.data();
        if (joinRequestData) {
          yield {
            doc: { ...joinRequestData, request_id: docSnapshot.id },
            requestRef: docSnapshot.ref,
          };
        }
      }
    } catch (error) {
      logger.error(`Error streaming join requests for invitation ${invitationId}:`, error);
      throw error;
    }
  }

  /**
   * Updates requester profile denormalization for all join requests made by a user
   * Uses streaming to handle large datasets efficiently with batch operations
   * @param userId The user ID whose profile needs updating
   * @param newProfile The new profile data to apply
   * @returns The number of join requests updated
   */
  async updateRequesterProfileDenormalization(userId: string, newProfile: SimpleProfile): Promise<number> {
    logger.info(`Updating requester profile denormalization for user: ${userId}`);

    let totalUpdates = 0;
    let currentBatch = this.db.batch();
    let currentBatchSize = 0;

    try {
      // Stream join requests by requester
      for await (const { requestRef } of this.streamJoinRequestsByRequester(userId)) {
        // Add update to batch
        currentBatch.update(requestRef, {
          requester_username: newProfile.username,
          requester_name: newProfile.name,
          requester_avatar: newProfile.avatar,
          updated_at: Timestamp.now(),
        });

        currentBatchSize++;
        totalUpdates++;

        // Commit batch if it reaches the size limit
        if (currentBatchSize >= MAX_BATCH_OPERATIONS) {
          await currentBatch.commit();
          logger.info(`Committed batch of ${currentBatchSize} requester profile updates`);
          currentBatch = this.db.batch();
          currentBatchSize = 0;
        }
      }

      // Commit any remaining operations
      if (currentBatchSize > 0) {
        await currentBatch.commit();
        logger.info(`Committed final batch of ${currentBatchSize} requester profile updates`);
      }

      logger.info(`Updated requester profile denormalization for ${totalUpdates} join requests`);
      return totalUpdates;
    } catch (error) {
      logger.error(`Error updating requester profile denormalization for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Updates receiver profile denormalization for all join requests on a specific invitation
   * Uses streaming to handle large datasets efficiently with batch operations
   * @param invitationId The invitation ID whose join requests need profile updates
   * @param newProfile The new profile data to apply
   * @returns The number of join requests updated
   */
  async updateReceiverProfileDenormalization(invitationId: string, newProfile: SimpleProfile): Promise<number> {
    logger.info(`Updating receiver profile denormalization for invitation: ${invitationId}`);

    let totalUpdates = 0;
    let currentBatch = this.db.batch();
    let currentBatchSize = 0;

    try {
      // Stream join requests by invitation
      for await (const { requestRef } of this.streamJoinRequestsByInvitation(invitationId)) {
        // Add update to batch
        currentBatch.update(requestRef, {
          receiver_username: newProfile.username,
          receiver_name: newProfile.name,
          receiver_avatar: newProfile.avatar,
          updated_at: Timestamp.now(),
        });

        currentBatchSize++;
        totalUpdates++;

        // Commit batch if it reaches the size limit
        if (currentBatchSize >= MAX_BATCH_OPERATIONS) {
          await currentBatch.commit();
          logger.info(`Committed batch of ${currentBatchSize} receiver profile updates`);
          currentBatch = this.db.batch();
          currentBatchSize = 0;
        }
      }

      // Commit any remaining operations
      if (currentBatchSize > 0) {
        await currentBatch.commit();
        logger.info(`Committed final batch of ${currentBatchSize} receiver profile updates`);
      }

      logger.info(`Updated receiver profile denormalization for ${totalUpdates} join requests`);
      return totalUpdates;
    } catch (error) {
      logger.error(`Error updating receiver profile denormalization for invitation ${invitationId}:`, error);
      throw error;
    }
  }
}
