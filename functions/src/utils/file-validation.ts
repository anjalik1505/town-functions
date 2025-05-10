import { fileTypeFromBuffer } from 'file-type';
import { BadRequestError } from './errors.js';
import { getLogger } from './logging-utils.js';

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * List of supported audio MIME types for transcription, based on Gemini's capabilities.
 */
export const SUPPORTED_AUDIO_MIME_TYPES: readonly string[] = [
  'audio/x-aac',
  'audio/flac',
  'audio/mp3',
  'audio/m4a',
  'audio/mpeg',
  'audio/mpga',
  'audio/mp4',
  'audio/opus',
  'audio/pcm',
  'audio/wav',
  'audio/webm',
];

/**
 * Validates if the detected MIME type is one of the Gemini-supported audio formats.
 *
 * @param detectedMimeType - The MIME type detected by file-type or similar.
 * @throws BadRequestError if the detected MIME type is not supported.
 */
export const ensureSupportedAudioMimeType = async (
  detectedMimeType: string | undefined,
): Promise<void> => {
  if (!detectedMimeType) {
    logger.warn('MIME type could not be detected from the provided data.');
    throw new BadRequestError(
      'Could not determine file type. Please provide valid audio data.',
    );
  }

  if (!SUPPORTED_AUDIO_MIME_TYPES.includes(detectedMimeType)) {
    logger.warn(
      `Detected MIME type ${detectedMimeType} is not in the list of Gemini-supported audio types.`,
    );
    throw new BadRequestError(
      `Unsupported audio format: ${detectedMimeType}. Supported formats by the transcription service are: ${SUPPORTED_AUDIO_MIME_TYPES.join(', ')}`,
    );
  }
  logger.info(
    `Detected MIME type ${detectedMimeType} is supported for transcription.`,
  );
};

/**
 * Attempts to detect the MIME type of a buffer and validates if it's supported.
 * This function can be used after decompression or on initial data.
 *
 * @param dataBuffer The data buffer to inspect.
 * @returns The detected and supported audio MIME type.
 * @throws BadRequestError if the type cannot be detected or is not supported.
 */
export const detectAndValidateAudioMimeType = async (
  dataBuffer: Buffer,
): Promise<string> => {
  const fileTypeResult = await fileTypeFromBuffer(dataBuffer);
  const detectedMime = fileTypeResult?.mime;

  await ensureSupportedAudioMimeType(detectedMime);

  // We've ensured detectedMime is not undefined by ensureSupportedAudioMimeType
  return detectedMime!;
};
