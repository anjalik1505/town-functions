import { z } from 'zod';
import {
  addGroupMembersSchema,
  analyzeSentimentSchema,
  createChatMessageSchema,
  createCommentSchema,
  createFeedbackSchema,
  createGroupSchema,
  createProfileSchema,
  createUpdateSchema,
  deviceSchema,
  friendProfileSchema,
  locationSchema,
  ownProfileSchema,
  paginationSchema,
  phoneJoinSchema,
  phoneLookupSchema,
  reactionSchema,
  shareUpdateSchema,
  testNotificationSchema,
  testPromptSchema,
  timezoneSchema,
  transcribeAudioSchema,
  updateCommentSchema,
  updateProfileSchema,
} from './validation-schemas.js';

// Inferred types from Zod validation schemas
export type CreateProfilePayload = z.infer<typeof createProfileSchema>;
export type UpdateProfilePayload = z.infer<typeof updateProfileSchema>;
export type PaginationPayload = z.infer<typeof paginationSchema>;
export type DevicePayload = z.infer<typeof deviceSchema>;
export type CreateUpdatePayload = z.infer<typeof createUpdateSchema>;
export type CreateChatMessagePayload = z.infer<typeof createChatMessageSchema>;
export type CreateGroupPayload = z.infer<typeof createGroupSchema>;
export type AddGroupMembersPayload = z.infer<typeof addGroupMembersSchema>;
export type OwnProfilePayload = z.infer<typeof ownProfileSchema>;
export type FriendProfilePayload = z.infer<typeof friendProfileSchema>;
export type TestPromptPayload = z.infer<typeof testPromptSchema>;
export type TestNotificationPayload = z.infer<typeof testNotificationSchema>;
export type CreateCommentPayload = z.infer<typeof createCommentSchema>;
export type UpdateCommentPayload = z.infer<typeof updateCommentSchema>;
export type CreateReactionPayload = z.infer<typeof reactionSchema>;
export type CreateFeedbackPayload = z.infer<typeof createFeedbackSchema>;
export type AnalyzeSentimentPayload = z.infer<typeof analyzeSentimentSchema>;
export type TranscribeAudioPayload = z.infer<typeof transcribeAudioSchema>;
export type TimezonePayload = z.infer<typeof timezoneSchema>;
export type LocationPayload = z.infer<typeof locationSchema>;
export type ShareUpdatePayload = z.infer<typeof shareUpdateSchema>;
export type PhoneLookupPayload = z.infer<typeof phoneLookupSchema>;
export type PhoneJoinPayload = z.infer<typeof phoneJoinSchema>;
