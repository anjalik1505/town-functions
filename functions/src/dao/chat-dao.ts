import { Collections, QueryOperators } from '../models/constants.js';
import { ChatMessage, ChatResponse } from '../models/data-models.js';
import { ChatDoc, chatConverter, chf } from '../models/firestore/index.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';
import { BaseDAO } from './base-dao.js';

/**
 * Data Access Object for Chat documents
 * Manages chats subcollection under groups
 */
export class ChatDAO extends BaseDAO<ChatDoc> {
  constructor() {
    super(Collections.GROUPS, chatConverter, Collections.CHATS);
  }

  /**
   * Creates a new chat message in a group
   * @param groupId The group ID to create the chat in
   * @param messageData The chat message data
   * @returns The created chat document with ID
   */
  async create(groupId: string, messageData: ChatDoc): Promise<{ id: string; data: ChatDoc }> {
    const chatRef = this.db
      .collection(this.collection)
      .doc(groupId)
      .collection(this.subcollection!)
      .withConverter(this.converter)
      .doc();

    await chatRef.set(messageData);

    return {
      id: chatRef.id,
      data: messageData,
    };
  }

  /**
   * Gets chat messages from a group with pagination
   * @param groupId The group ID to get chats from
   * @param pagination Pagination options
   * @returns Paginated chat messages
   */
  async get(groupId: string, pagination?: { limit?: number; afterCursor?: string }): Promise<ChatResponse> {
    const limit = pagination?.limit || 20;

    let query = this.db
      .collection(this.collection)
      .doc(groupId)
      .collection(this.subcollection!)
      .withConverter(this.converter)
      .orderBy(chf('created_at'), QueryOperators.DESC)
      .limit(limit + 1);

    if (pagination?.afterCursor) {
      const cursorDoc = await this.db
        .collection(this.collection)
        .doc(groupId)
        .collection(this.subcollection!)
        .withConverter(this.converter)
        .doc(pagination.afterCursor)
        .get();

      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snapshot = await query.get();
    const chats: ChatMessage[] = [];
    let nextCursor: string | undefined;

    snapshot.docs.slice(0, limit).forEach((doc) => {
      const data = doc.data();
      chats.push({
        message_id: doc.id,
        sender_id: data.sender_id,
        text: data.text,
        created_at: formatTimestamp(data.created_at),
        attachments: data.attachments.map((a) => a.url),
      });
    });

    if (snapshot.docs.length > limit) {
      nextCursor = snapshot.docs[limit - 1]!.id;
    }

    return { messages: chats, next_cursor: nextCursor || null };
  }
}
