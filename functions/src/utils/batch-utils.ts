import path from 'path';
import { fileURLToPath } from 'url';
import { MAX_BATCH_OPERATIONS } from '../models/constants.js';
import { getLogger } from './logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

export const commitBatch = async (
  db: FirebaseFirestore.Firestore,
  batch: FirebaseFirestore.WriteBatch,
  batchCount: number,
): Promise<{ batch: FirebaseFirestore.WriteBatch; batchCount: number }> => {
  // Commit batch if approaching limit
  if (batchCount >= MAX_BATCH_OPERATIONS - 1) {
    await batch.commit();
    logger.info('Committed batch due to operation limit');
    batch = db.batch();
    batchCount = 0;
  }
  return { batch, batchCount };
};

export const commitFinal = async (batch: FirebaseFirestore.WriteBatch, batchCount: number): Promise<void> => {
  if (batchCount > 0) {
    await batch.commit();
    logger.info(`Committed final batch with ${batchCount} operations`);
  }
};
