import { fileTypeFromBuffer } from 'file-type';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeSentimentFlow, transcribeAudioFlow } from '../ai/flows.js';
import { ApiResponse, EventName } from '../models/analytics-events.js';
import { SentimentAnalysisResponse, TranscriptionResponse } from '../models/data-models.js';
import { decompressData, isCompressedMimeType } from '../utils/compression.js';
import { BadRequestError } from '../utils/errors.js';
import { detectAndValidateAudioMimeType } from '../utils/file-validation.js';
import { getLogger } from '../utils/logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Service layer for Update operations
 * Handles business logic, validation, and coordination between DAOs
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
}
