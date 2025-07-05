import { fileTypeFromBuffer } from 'file-type';
import { getStorage } from 'firebase-admin/storage';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeImagesFlow, analyzeSentimentFlow, transcribeAudioFlow } from '../ai/flows.js';
import { ApiResponse, EventName } from '../models/analytics-events.js';
import { SentimentAnalysisResponse, TranscriptionResponse } from '../models/data-models.js';
import { decompressData, isCompressedMimeType } from '../utils/compression.js';
import { BadRequestError } from '../utils/errors.js';
import { detectAndValidateAudioMimeType } from '../utils/file-validation.js';
import { getLogger } from '../utils/logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Service layer for AI operations
 * Handles sentiment analysis, audio transcription, and image analysis
 */
export class AiService {
  constructor() {}

  /**
   * Analyzes sentiment of text content
   * @param userId The ID of the user requesting sentiment analysis
   * @param content The text content to analyze
   * @returns Sentiment analysis results
   */
  async analyzeSentiment(userId: string, content: string): Promise<ApiResponse<SentimentAnalysisResponse>> {
    logger.info(`User ${userId} analyzing sentiment for content of length ${content.length}`);

    const result = await analyzeSentimentFlow({ content });

    return {
      data: {
        sentiment: result.sentiment,
        score: result.score,
        emoji: result.emoji,
      },
      status: 200,
      analytics: {
        event: EventName.SENTIMENT_ANALYZED,
        userId: userId,
        params: {
          sentiment: result.sentiment,
          score: result.score,
          emoji: result.emoji,
        },
      },
    };
  }

  /**
   * Transcribes audio with sentiment analysis, handling compression
   * @param userId The ID of the user requesting transcription
   * @param audioData The base64 encoded audio data
   * @returns Transcription and sentiment results
   */
  async transcribeAudio(userId: string, audioData: string): Promise<ApiResponse<TranscriptionResponse>> {
    logger.info(`User ${userId} transcribing audio, data length: ${audioData.length}`);

    let workingAudioBuffer = Buffer.from(audioData, 'base64');
    let finalAudioMimeType: string;

    // 1. Detect the initial file type
    const initialFileType = await fileTypeFromBuffer(workingAudioBuffer);
    const initialMimeType = initialFileType?.mime;

    logger.info(`Initial detected MIME type: ${initialMimeType || 'unknown'}`);

    // 2. Handle if compressed (and supported compression type)
    if (initialMimeType && isCompressedMimeType(initialMimeType)) {
      logger.info(`Initial type ${initialMimeType} is a supported compression format. Attempting decompression.`);
      workingAudioBuffer = await decompressData(workingAudioBuffer, initialMimeType);
      logger.info(`Decompression successful for ${initialMimeType}.`);
      // After decompression, detect the actual audio type
      logger.info('Detecting MIME type of decompressed data.');
      finalAudioMimeType = await detectAndValidateAudioMimeType(workingAudioBuffer);
    } else {
      if (!initialMimeType) {
        logger.warn(`MIME type could not be detected from the provided data.`);
        throw new BadRequestError('Could not determine file type. Please provide valid audio data.');
      }
      finalAudioMimeType = await detectAndValidateAudioMimeType(workingAudioBuffer);
    }

    logger.info(`Final audio MIME type for transcription: ${finalAudioMimeType}`);

    // Use the transcription flow with the (potentially decompressed) data
    const audioDataForTranscription = workingAudioBuffer.toString('base64');

    const result = await transcribeAudioFlow({
      audioUri: `data:${finalAudioMimeType};base64,${audioDataForTranscription}`,
      mimeType: finalAudioMimeType,
    });

    logger.info(
      `Transcription result: ${result.transcription.substring(0, 100)}${result.transcription.length > 100 ? '...' : ''}`,
    );

    return {
      data: {
        transcription: result.transcription,
        sentiment: result.sentiment,
        score: result.score,
        emoji: result.emoji,
      },
      status: 200,
      analytics: {
        event: EventName.AUDIO_TRANSCRIBED,
        userId: userId,
        params: {
          mime_type: finalAudioMimeType,
          transcription_length_characters: result.transcription.length,
          sentiment: result.sentiment,
          score: result.score,
          emoji: result.emoji,
        },
      },
    };
  }

  /**
   * Processes and analyzes images to generate image analysis text.
   * This method handles the complete pipeline from image paths to AI analysis.
   * @param imagePaths Array of image paths to process and analyze
   * @returns Image analysis text from AI
   */
  async processAndAnalyzeImages(imagePaths: string[]): Promise<string> {
    logger.info(`Processing and analyzing ${imagePaths.length} images`);

    if (imagePaths.length === 0) {
      logger.info('No images to process, returning empty analysis');
      return '';
    }

    try {
      // Process images for AI analysis
      const processedImages = await this.processImagesForPrompt(imagePaths);

      // Analyze images using AI flow
      const { analysis: imageAnalysis } = await analyzeImagesFlow({ images: processedImages });

      logger.info(`Completed image analysis for ${imagePaths.length} images`);
      return imageAnalysis;
    } catch (error) {
      logger.error(`Failed to process and analyze images`, error);
      throw error;
    }
  }

  /**
   * Process image paths into objects with signed URLs and MIME types for use in prompts
   * @param imagePaths Array of Firebase Storage paths to images
   * @returns Array of objects with url and mimeType properties
   */
  private async processImagesForPrompt(imagePaths: string[]): Promise<Array<{ url: string; mimeType: string }>> {
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
        let mimeType = metadata.contentType || '';

        // Fall back to detecting MIME type from file content if metadata is missing or generic
        if (!mimeType || mimeType === 'application/octet-stream') {
          try {
            // Download the first 4 KB to inspect magic numbers
            const [buffer] = await file.download({ start: 0, end: 4095 });
            const detected = await fileTypeFromBuffer(buffer);
            mimeType = detected?.mime || 'image/jpeg';
          } catch (detectErr) {
            logger.warn(`Could not detect MIME type for ${imagePath}, defaulting to image/jpeg: ${detectErr}`);
            mimeType = 'image/jpeg';
          }
        }

        // 2. Generate signed URL (valid for 1 minute)
        const [signedUrl] = await file.getSignedUrl({
          action: 'read',
          expires: Date.now() + 60 * 1000,
          // Ensure the response header advertises the correct content type
          responseType: mimeType,
        });

        images.push({ url: signedUrl, mimeType });
        logger.info(`Processed image: ${imagePath} -> ${mimeType}`);
      } catch (error) {
        logger.error(`Failed to process image ${imagePath}: ${error}`);
        // Continue with other images
      }
    }

    return images;
  }
}
