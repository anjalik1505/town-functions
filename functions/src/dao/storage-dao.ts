import { getStorage } from 'firebase-admin/storage';
import path from 'path';
import { fileURLToPath } from 'url';
import { getLogger } from '../utils/logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Data Access Object for Firebase Storage operations
 * Handles image processing, copying, and deletion operations
 */
export class StorageDAO {
  private storage: ReturnType<typeof getStorage>;

  constructor() {
    this.storage = getStorage();
  }

  /**
   * Processes staging images to final location
   * @param stagingPaths Array of staging image paths
   * @param userId The user ID for metadata
   * @param updateId The update ID for final path
   * @returns Array of final image paths
   */
  async copyImages(stagingPaths: string[], userId: string, updateId: string): Promise<string[]> {
    if (stagingPaths.length === 0) {
      return [];
    }

    logger.info(`Processing ${stagingPaths.length} staging images`);

    const bucket = this.storage.bucket();
    const finalPaths: string[] = [];

    for (const stagingPath of stagingPaths) {
      try {
        const fileName = stagingPath.split('/').pop();
        if (!fileName) {
          logger.warn(`Invalid staging path: ${stagingPath}`);
          continue;
        }

        const srcFile = bucket.file(stagingPath);
        const destPath = `updates/${updateId}/${fileName}`;
        const destFile = bucket.file(destPath);

        // Copy with metadata
        await srcFile.copy(destFile);
        await destFile.setMetadata({
          metadata: {
            created_by: userId,
          },
        });

        // Delete staging file
        await srcFile.delete();
        finalPaths.push(destPath);

        logger.info(`Moved image from ${stagingPath} to ${destPath}`);
      } catch (error) {
        logger.error(`Failed to process image ${stagingPath}:`, error);
      }
    }

    return finalPaths;
  }

  /**
   * Deletes all profile images for a user
   * Uses Firebase Admin SDK deleteFiles with prefix to efficiently delete the entire folder
   * @param userId The user ID whose profile images should be deleted
   * @returns Boolean indicating success/failure
   */
  async deleteProfile(userId: string): Promise<boolean> {
    logger.info(`Deleting profile images for user ${userId}`);

    try {
      const bucket = this.storage.bucket();
      const prefix = `profile_images/${userId}/`;

      // Use deleteFiles with prefix to delete the entire folder efficiently
      await bucket.deleteFiles({ prefix });

      logger.info(`Successfully deleted profile images folder for user ${userId}`);
      return true;
    } catch (error) {
      logger.error(`Error deleting profile images for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Deletes all images for specific updates
   * Uses Firebase Admin SDK deleteFiles with prefix to efficiently delete each update folder
   * @param updateIds Array of update IDs whose images should be deleted
   * @returns Boolean indicating success/failure
   */
  async deleteUpdateImages(updateIds: string[]): Promise<boolean> {
    if (updateIds.length === 0) {
      logger.info('No update IDs provided for image deletion');
      return true;
    }

    logger.info(`Deleting images for ${updateIds.length} updates`);

    try {
      const bucket = this.storage.bucket();
      let successCount = 0;
      let errorCount = 0;

      // Delete images for each update
      for (const updateId of updateIds) {
        try {
          const prefix = `updates/${updateId}/`;
          await bucket.deleteFiles({ prefix });
          successCount++;
          logger.info(`Successfully deleted images for update ${updateId}`);
        } catch (error) {
          errorCount++;
          logger.error(`Error deleting images for update ${updateId}:`, error);
        }
      }

      logger.info(`Completed update image deletion: ${successCount} successful, ${errorCount} errors`);
      return errorCount === 0;
    } catch (error) {
      logger.error(`Error deleting update images:`, error);
      return false;
    }
  }
}
