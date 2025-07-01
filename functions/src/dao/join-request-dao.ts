import { Query, Timestamp } from 'firebase-admin/firestore';
import { Collections, QueryOperators } from '../models/constants.js';
import { JoinRequestDoc, joinRequestConverter, jrf } from '../models/firestore/index.js';
import { applyPagination, generateNextCursor, processQueryStream } from '../utils/pagination-utils.js';
import { BaseDAO } from './base-dao.js';

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
  deleteRequestWithBatch(invitationId: string, requestId: string, batch: FirebaseFirestore.WriteBatch): void {
    const requestRef = this.db
      .collection(this.collection)
      .doc(invitationId)
      .collection(this.subcollection!)
      .doc(requestId);

    batch.delete(requestRef);
  }

  /**
   * Checks if a join request exists for a specific user and invitation
   * Optionally filters by status
   * @param invitationId The invitation ID
   * @param requesterId The requester's user ID
   * @param status Optional status filter
   * @returns The existing join request or null
   */
  async findExistingRequest(
    invitationId: string,
    requesterId: string,
    status?: string | string[],
  ): Promise<JoinRequestDoc | null> {
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
   * Deletes all join requests for a given invitation
   * @param invitationId The invitation ID
   * @param batch Optional batch to include this operation in
   * @returns The number of deleted join requests
   */
  async deleteAllByInvitation(invitationId: string, batch?: FirebaseFirestore.WriteBatch): Promise<number> {
    const joinRequestsSnapshot = await this.db
      .collection(this.collection)
      .doc(invitationId)
      .collection(this.subcollection!)
      .withConverter(this.converter)
      .get();

    if (joinRequestsSnapshot.empty) {
      return 0;
    }

    const shouldCommitBatch = !batch;
    const workingBatch = batch || this.db.batch();

    joinRequestsSnapshot.docs.forEach((doc) => {
      workingBatch.delete(doc.ref);
    });

    if (shouldCommitBatch) {
      await workingBatch.commit();
    }

    return joinRequestsSnapshot.size;
  }
}
