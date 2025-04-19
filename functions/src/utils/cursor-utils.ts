import {DocumentSnapshot} from "firebase-admin/firestore";

/**
 * Encodes a document snapshot into a cursor string for pagination
 * @param doc The document snapshot to encode
 * @returns A base64 encoded string containing the document path
 */
export const encodeCursor = (doc: DocumentSnapshot): string => {
  return Buffer.from(doc.ref.path).toString('base64');
};

/**
 * Decodes a cursor string back into a document path
 * @param cursor The base64 encoded cursor string
 * @returns The decoded document path
 */
export const decodeCursor = (cursor: string): string => {
  return Buffer.from(cursor, 'base64').toString('utf-8');
}; 