import { getStorage } from 'firebase-admin/storage';
import { getLogger } from './logging-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Process image paths into objects with signed URLs and MIME types for use in prompts
 *
 * @param imagePaths - Array of Firebase Storage paths to images
 * @returns Array of objects with url and mimeType properties
 */
export const processImagesForPrompt = async (
  imagePaths: string[],
): Promise<Array<{ url: string; mimeType: string }>> => {
  if (!imagePaths || imagePaths.length === 0) {
    return [];
  }

  const bucket = getStorage().bucket();
  const images: Array<{ url: string; mimeType: string }> = [];

  for (const imagePath of imagePaths) {
    try {
      const file = bucket.file(imagePath);

      // 1. Get MIME type
      const [metadata] = await file.getMetadata();
      const mimeType = metadata.contentType || 'image/jpeg';

      // 2. Generate signed URL (valid for 1 minute)
      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 60 * 1000,
      });

      images.push({ url: signedUrl, mimeType });
      logger.info(`Processed image: ${imagePath} -> ${mimeType}`);
    } catch (error) {
      logger.error(`Failed to process image ${imagePath}: ${error}`);
      // Continue with other images
    }
  }

  return images;
};
