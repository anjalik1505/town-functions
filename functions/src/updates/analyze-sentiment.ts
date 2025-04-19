import {Request} from "express";
import {analyzeSentimentFlow} from "../ai/flows";
import {AnalyzeSentimentEventParams, ApiResponse, EventName} from "../models/analytics-events";
import {SentimentAnalysisResponse} from "../models/data-models";
import {getLogger} from "../utils/logging-utils";

const logger = getLogger(__filename);

/**
 * Analyzes text input to determine sentiment, score, and generate an emoji.
 *
 * This function:
 * 1. Takes text input from the request
 * 2. Uses AI to analyze the sentiment, generate a score, and select an emoji
 * 3. Returns the analysis results
 *
 * @param req - The Express request object containing:
 *              - content: The text to analyze
 *
 * @returns An ApiResponse containing the analysis results and analytics
 *
 * @throws 400: Invalid request parameters
 */
export const analyzeSentiment = async (req: Request): Promise<ApiResponse<SentimentAnalysisResponse>> => {
  const {content} = req.validated_params;
  logger.info(`Analyzing sentiment for content: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`);

  // Use the sentiment analysis flow to analyze the text
  const result = await analyzeSentimentFlow({
    content: content || ""
  });

  logger.info(`Sentiment analysis result: ${JSON.stringify(result)}`);

  // Return the analysis results
  const response: SentimentAnalysisResponse = {
    sentiment: result.sentiment,
    score: result.score,
    emoji: result.emoji
  };

  // Create analytics event
  const event: AnalyzeSentimentEventParams = {
    sentiment: result.sentiment,
    score: result.score,
    emoji: result.emoji
  };

  return {
    data: response,
    status: 200,
    analytics: {
      event: EventName.SENTIMENT_ANALYZED,
      userId: req.userId,
      params: event
    }
  };
}; 