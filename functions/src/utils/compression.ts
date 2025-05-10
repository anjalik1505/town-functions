import { BadRequestError } from './errors';
import { getLogger } from './logging-utils';
import * as zlib from 'zlib';
import { promisify } from 'util';

const logger = getLogger(__filename);

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);
const brotliDecompress = promisify(zlib.brotliDecompress);

/**
 * Supported compression formats and their corresponding zlib algorithm names.
 * We only support formats natively handled by Node.js's zlib.
 */
export const COMPRESSION_MIME_TYPES: Record<
  string,
  'gzip' | 'deflate' | 'brotli'
> = {
  'application/gzip': 'gzip',
  'application/x-gzip': 'gzip',
  'application/deflate': 'deflate',
  'application/brotli': 'brotli',
};

/**
 * Determines if a MIME type represents a supported compressed data format.
 *
 * @param mimeType - The MIME type to check
 * @returns True if the MIME type represents a supported compressed data format
 */
export function isCompressedMimeType(mimeType: string): boolean {
  return Object.keys(COMPRESSION_MIME_TYPES).includes(mimeType);
}

/**
 * Decompresses data based on the provided MIME type
 *
 * @param compressedData - The compressed data buffer
 * @param mimeType - The MIME type indicating the compression format
 * @returns A Promise resolving to the decompressed data buffer
 * @throws BadRequestError if decompression fails or the format is unsupported
 */
export async function decompressData(
  compressedData: Buffer,
  mimeType: string,
): Promise<Buffer> {
  if (!Object.prototype.hasOwnProperty.call(COMPRESSION_MIME_TYPES, mimeType)) {
    throw new BadRequestError(
      `Unsupported or unrecognized compression format: ${mimeType}`,
    );
  }
  const compressionAlgorithm =
    COMPRESSION_MIME_TYPES[mimeType as keyof typeof COMPRESSION_MIME_TYPES];

  logger.info(
    `Decompressing data with format: ${compressionAlgorithm} (from MIME type: ${mimeType})`,
  );

  switch (compressionAlgorithm) {
    case 'gzip':
      return await gunzip(compressedData);
    case 'deflate':
      return await inflate(compressedData);
    case 'brotli':
      return await brotliDecompress(compressedData);
    default:
      throw new BadRequestError(
        `Internal error: Unhandled compression algorithm for ${mimeType}`,
      );
  }
}
