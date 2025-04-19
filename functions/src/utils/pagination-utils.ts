import { Query, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { decodeCursor, encodeCursor } from "./cursor-utils";
import { BadRequestError } from "./errors";
import { getLogger } from "./logging-utils";

const logger = getLogger(__filename);

/**
 * Applies cursor-based pagination to a Firestore query.
 * If there's an error decoding the cursor, it throws a BadRequestError.
 *
 * @param query - The Firestore query to apply pagination to
 * @param afterCursor - The cursor string for pagination
 * @param limit - Optional maximum number of items to return
 * @returns The modified query with pagination applied
 */
export const applyPagination = async (
  query: Query,
  afterCursor: string | undefined,
  limit: number
): Promise<Query> => {
  if (!afterCursor) {
    return limit ? query.limit(limit + 1) : query;
  }

  try {
    const docPath = decodeCursor(afterCursor);
    const docRef = query.firestore.doc(docPath);
    const doc = await docRef.get();
    if (doc.exists) {
      const paginatedQuery = query.startAfter(doc);
      return limit ? paginatedQuery.limit(limit + 1) : paginatedQuery;
    }
    return limit ? query.limit(limit + 1) : query;
  } catch (error) {
    logger.error(`Error decoding cursor: ${error}`);
    throw new BadRequestError("Invalid request parameters");
  }
};

/**
 * Generates the next cursor for pagination.
 *
 * @param lastDoc - The last document from the current query
 * @param itemsLength - The number of items in the current page
 * @param limit - The maximum number of items per page
 * @returns The next cursor string or null if there are no more results
 */
export const generateNextCursor = (
  lastDoc: QueryDocumentSnapshot | null,
  itemsLength: number,
  limit: number
): string | null => {
  if (!lastDoc || itemsLength !== limit) {
    return null;
  }

  const nextCursor = encodeCursor(lastDoc);
  logger.info(`More results available, next_cursor: ${nextCursor}`);
  return nextCursor;
};

/**
 * Processes a Firestore query stream and collects items.
 *
 * @param query - The Firestore query to stream
 * @param processDoc - Function to process each document
 * @param limit - Maximum number of items to process
 * @returns Array of processed items and the last document
 */
export const processQueryStream = async <T>(
  query: Query,
  processDoc: (doc: QueryDocumentSnapshot) => T,
  limit: number,
): Promise<{ items: T[]; lastDoc: QueryDocumentSnapshot | null }> => {
  let items: T[] = [];
  let docs: QueryDocumentSnapshot[] = [];
  let lastDoc: QueryDocumentSnapshot | null = null;

  for await (const doc of query.stream()) {
    const queryDoc = doc as unknown as QueryDocumentSnapshot;
    items.push(processDoc(queryDoc));
    docs.push(queryDoc);
  }

  if (limit && items.length > limit) {
    items = items.slice(0, limit);
    docs = docs.slice(0, limit);
    lastDoc = docs[docs.length - 1];
  }

  return {items, lastDoc};
}; 