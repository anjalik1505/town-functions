import { fileTypeFromBuffer } from 'file-type';
import { getStorage } from 'firebase-admin/storage';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  analyzeImagesFlow,
  analyzeSentimentFlow,
  generateCreatorProfileFlow,
  generateQuestionFlow,
  transcribeAudioFlow,
} from '../ai/flows.js';
import { ProfileDAO } from '../dao/profile-dao.js';
import { ApiResponse, EventName, SummaryEventParams } from '../models/analytics-events.js';
import { QuestionResponse, SentimentAnalysisResponse, TranscriptionResponse } from '../models/api-responses.js';
import { InsightsDoc, ProfileDoc, UpdateDoc } from '../models/firestore/index.js';
import { decompressData, isCompressedMimeType } from '../utils/compression.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import { detectAndValidateAudioMimeType } from '../utils/file-validation.js';
import { getLogger } from '../utils/logging-utils.js';
import { calculateAge } from '../utils/profile-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Service layer for AI operations
 * Handles sentiment analysis, audio transcription, image analysis, and AI profile operations
 */
export class AiService {
  private profileDAO: ProfileDAO;

  constructor() {
    this.profileDAO = new ProfileDAO();
  }

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

  /**
   * Generates a personalized question for the user using AI
   * @param userId The ID of the user requesting the question
   * @returns AI-generated personalized question
   */
  async generateQuestion(userId: string): Promise<ApiResponse<QuestionResponse>> {
    logger.info(`Generating question for user ${userId}`);

    const profileData = await this.profileDAO.get(userId);
    if (!profileData) {
      throw new NotFoundError('Profile not found');
    }

    try {
      const questionData = await generateQuestionFlow({
        existingSummary: profileData.summary,
        existingSuggestions: profileData.suggestions,
        existingEmotionalOverview: profileData.insights?.emotional_overview || '',
        existingKeyMoments: profileData.insights?.key_moments || '',
        existingRecurringThemes: profileData.insights?.recurring_themes || '',
        existingProgressAndGrowth: profileData.insights?.progress_and_growth || '',
        gender: profileData.gender,
        location: profileData.location,
        age: calculateAge(profileData.birthday || ''),
        tone: profileData.tone,
      });

      logger.info(`Successfully generated question for user ${userId}`);

      return {
        data: { question: questionData.question },
        status: 200,
        analytics: {
          event: EventName.QUESTION_GENERATED,
          userId: userId,
          params: { question_length: questionData.question.length },
        },
      };
    } catch (error) {
      logger.error('Failed to generate question', { error });
      throw new BadRequestError('Failed to generate question. Please try again.');
    }
  }

  /**
   * Processes creator profile updates with AI-generated insights after an update is created
   * @param updateData The update document data
   * @param imageAnalysis Already analyzed image description text
   * @returns Analytics data for the creator's profile update
   */
  async processUpdateSimpleProfile(updateData: UpdateDoc, imageAnalysis: string): Promise<SummaryEventParams> {
    const creatorId = updateData.created_by;

    if (!creatorId) {
      logger.error('Update has no creator ID');
      return {
        update_length: 0,
        update_sentiment: '',
        summary_length: 0,
        suggestions_length: 0,
        emotional_overview_length: 0,
        key_moments_length: 0,
        recurring_themes_length: 0,
        progress_and_growth_length: 0,
        has_name: false,
        has_avatar: false,
        has_location: false,
        has_birthday: false,
        has_gender: false,
        nudging_occurrence: '',
        goal: '',
        connect_to: '',
        personality: '',
        tone: '',
        friend_summary_count: 0,
      };
    }

    logger.info(`Processing creator profile update for user ${creatorId}`);

    // Get the profile document
    const profileData = await this.profileDAO.get(creatorId);

    if (!profileData) {
      logger.warn(`Profile not found for user ${creatorId}`);
      return {
        update_length: 0,
        update_sentiment: '',
        summary_length: 0,
        suggestions_length: 0,
        emotional_overview_length: 0,
        key_moments_length: 0,
        recurring_themes_length: 0,
        progress_and_growth_length: 0,
        has_name: false,
        has_avatar: false,
        has_location: false,
        has_birthday: false,
        has_gender: false,
        nudging_occurrence: '',
        goal: '',
        connect_to: '',
        personality: '',
        tone: '',
        friend_summary_count: 0,
      };
    }

    const existingSummary = profileData.summary;
    const existingSuggestions = profileData.suggestions;

    // Extract update content and sentiment
    const updateContent = updateData.content;
    const sentiment = updateData.sentiment;
    const updateId = updateData.id;

    // Calculate age from the birthday
    const age = calculateAge(profileData.birthday || '');

    // Use the creator profile flow to generate insights
    const result = await generateCreatorProfileFlow({
      existingSummary: existingSummary || '',
      existingSuggestions: existingSuggestions || '',
      existingEmotionalOverview: profileData.insights?.emotional_overview || '',
      existingKeyMoments: profileData.insights?.key_moments || '',
      existingRecurringThemes: profileData.insights?.recurring_themes || '',
      existingProgressAndGrowth: profileData.insights?.progress_and_growth || '',
      updateContent: updateContent || '',
      sentiment: sentiment || '',
      gender: profileData.gender || 'unknown',
      location: profileData.location || 'unknown',
      age: age,
      imageAnalysis: imageAnalysis,
    });

    // Prepare profile and insights updates
    const profileUpdate: Partial<ProfileDoc> = {
      summary: result.summary || '',
      suggestions: result.suggestions || '',
      last_update_id: updateId,
    };

    const insightsData: InsightsDoc = {
      emotional_overview: result.emotional_overview || '',
      key_moments: result.key_moments || '',
      recurring_themes: result.recurring_themes || '',
      progress_and_growth: result.progress_and_growth || '',
    };

    // Use ProfileDAO to update both profile and insights atomically
    await this.profileDAO.updateProfile(creatorId, profileUpdate, undefined, insightsData);
    logger.info(`Successfully updated creator profile and insights for user ${creatorId}`);

    // Return analytics data
    return {
      update_length: (updateData.content || '').length,
      update_sentiment: updateData.sentiment || '',
      summary_length: (result.summary || '').length,
      suggestions_length: (result.suggestions || '').length,
      emotional_overview_length: (result.emotional_overview || '').length,
      key_moments_length: (result.key_moments || '').length,
      recurring_themes_length: (result.recurring_themes || '').length,
      progress_and_growth_length: (result.progress_and_growth || '').length,
      has_name: !!profileData.name,
      has_avatar: !!profileData.avatar,
      has_location: !!profileData.location,
      has_birthday: !!profileData.birthday,
      has_gender: !!profileData.gender,
      nudging_occurrence: profileData.nudging_settings?.occurrence || '',
      goal: profileData.goal || '',
      connect_to: profileData.connect_to || '',
      personality: profileData.personality || '',
      tone: profileData.tone || '',
      friend_summary_count: (updateData.friend_ids || []).length,
    };
  }
}
