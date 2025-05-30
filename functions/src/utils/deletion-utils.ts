import { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { MAX_BATCH_OPERATIONS } from '../models/constants.js';
import { fileURLToPath } from 'url';
import { getLogger } from './logging-utils.js';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Helper functions to stream and process a collection with batched writings.
 *
 * @param query - Firestore query to stream
 * @param processDocument - Function to process each document
 * @param db - Firestore instance
 * @param operationName - Name of the operation for logging
 * @param finalOperation - Optional function to run after all documents are processed
 * @param useBatch - Whether to use batch processing (default: true)
 * @returns Total number of documents processed
 */
export const streamAndProcessCollection = async (
  query: FirebaseFirestore.Query,
  processDocument: (
    doc: QueryDocumentSnapshot,
    batch: FirebaseFirestore.WriteBatch,
    db: FirebaseFirestore.Firestore,
  ) => void | Promise<void>,
  db: FirebaseFirestore.Firestore,
  operationName: string,
  finalOperation?: () => Promise<void>,
  useBatch: boolean = true,
): Promise<number> => {
  let batch = db.batch();
  let batchCount = 0;
  let totalProcessed = 0;

  try {
    // Stream the documents using for-await loop
    for await (const doc of query.stream()) {
      const docSnapshot = doc as unknown as QueryDocumentSnapshot;

      try {
        if (useBatch) {
          await processDocument(docSnapshot, batch, db);
          batchCount++;
          totalProcessed++;

          // Commit the batch if it reaches the maximum size
          if (batchCount >= MAX_BATCH_OPERATIONS) {
            await batch.commit();
            logger.info(`Committed batch with ${batchCount} ${operationName}`);
            batchCount = 0;
            // Create a new batch
            batch = db.batch();
          }
        } else {
          // Process without batching
          await processDocument(docSnapshot, batch, db);
          totalProcessed++;
        }
      } catch (error) {
        logger.error(`Error processing document: ${error}`);
        throw error;
      }
    }

    // Commit any remaining documents if using batch
    if (useBatch && batchCount > 0) {
      await batch.commit();
      logger.info(`Committed final batch with ${batchCount} ${operationName}`);
    }

    // Run the final operation if provided
    if (finalOperation) {
      await finalOperation();
    }

    logger.info(`Processed ${totalProcessed} ${operationName}`);
  } catch (error) {
    logger.error(`Error streaming ${operationName}: ${error}`);
    throw error;
  }

  return totalProcessed;
};
