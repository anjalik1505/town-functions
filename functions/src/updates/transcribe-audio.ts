import { Request } from 'express';
import { fileTypeFromBuffer } from 'file-type';
import path from 'path';
import { fileURLToPath } from 'url';
import { transcribeAudioFlow } from '../ai/flows.js';
import { ApiResponse, AudioTranscribedEventParams, EventName } from '../models/analytics-events.js';
import { TranscribeAudioPayload, TranscriptionResponse } from '../models/data-models.js';
import { decompressData, isCompressedMimeType } from '../utils/compression.js'; // isCompressedMimeType checks against our limited list
import { BadRequestError } from '../utils/errors.js';
import { detectAndValidateAudioMimeType } from '../utils/file-validation.js';
import { getLogger } from '../utils/logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Transcribes audio input.
 *
 * This function:
 * 1. Takes base64 encoded audio data from the request.
 * 2. Auto-detects the MIME type.
 * 3. If it's a supported compressed format (gzip, deflate, brotli), decompresses it.
 * 4. Auto-detects the MIME type of the (potentially decompressed) data.
 * 5. Validates that the final MIME type is a supported audio format.
 * 6. Uses AI to transcribe the audio.
 * 7. Returns the transcription.
 *
 * @param req - The Express request object containing validated_params:
 *              - audio_data: Base64 encoded audio string.
 *
 * @returns An ApiResponse containing the transcription and analytics.
 *
 * @throws 400: Invalid request parameters (handled by validation middleware) or unsupported file types.
 */
export const transcribeAudio = async (req: Request): Promise<ApiResponse<TranscriptionResponse>> => {
  const { audio_data } = req.validated_params as TranscribeAudioPayload;

  logger.info(`Received audio data for transcription, data length: ${audio_data.length}`);

  let workingAudioBuffer = Buffer.from(audio_data, 'base64');
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

  // Prepare response data
  const responseData: TranscriptionResponse = {
    transcription: result.transcription,
    sentiment: result.sentiment,
    score: result.score,
    emoji: result.emoji,
  };

  // Prepare analytics event
  const eventParams: AudioTranscribedEventParams = {
    mime_type: finalAudioMimeType, // Use the final, validated audio MIME type
    transcription_length_characters: result.transcription.length,
    sentiment: result.sentiment,
    score: result.score,
    emoji: result.emoji,
  };

  return {
    data: responseData,
    status: 200,
    analytics: {
      event: EventName.AUDIO_TRANSCRIBED,
      userId: req.userId,
      params: eventParams,
    },
  };
};
