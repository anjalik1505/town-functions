import cors from 'cors';
import express, { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { ZodError } from 'zod';
import { validateQueryParams, validateRequest } from './middleware/validation.js';
import { ApiResponse, ErrorResponse, EventName } from './models/analytics-events.js';
import {
  AnalyzeSentimentPayload,
  CreateCommentPayload,
  CreateFeedbackPayload,
  CreateProfilePayload,
  CreateReactionPayload,
  CreateUpdatePayload,
  DevicePayload,
  LocationPayload,
  PaginationPayload,
  PhoneLookupPayload,
  ShareUpdatePayload,
  TimezonePayload,
  TranscribeAudioPayload,
  UpdateCommentPayload,
  UpdateProfilePayload,
} from './models/data-models.js';
import {
  analyzeSentimentSchema,
  createCommentSchema,
  createFeedbackSchema,
  createProfileSchema,
  createUpdateSchema,
  deviceSchema,
  locationSchema,
  paginationSchema,
  phoneLookupSchema,
  reactionSchema,
  shareUpdateSchema,
  testNotificationSchema,
  testPromptSchema,
  timezoneSchema,
  transcribeAudioSchema,
  updateCommentSchema,
  updateProfileSchema,
} from './models/validation-schemas.js';
import {
  AiService,
  ContactService,
  DeviceService,
  FeedbackService,
  FeedQueryService,
  FriendshipService,
  GroupService,
  InvitationService,
  ProfileService,
  UpdateService
} from './services/index.js';
import { testNotification } from './test/test-notification.js';
import { testPrompt } from './test/test-prompt.js';
import { trackApiEvent } from './utils/analytics-utils.js';
import {
  BadRequestError,
  ConflictError,
  ErrorWithStatus,
  ForbiddenError,
  InternalServerError,
  isFirebaseAuthTokenExpiredError,
  NotFoundError,
  UnauthorizedError,
} from './utils/errors.js';

// Response Handler
const sendResponse = <T>(res: Response, response: ApiResponse<T>): void => {
  const { analytics } = response;
  if (analytics) {
    res.on('finish', () => {
      trackApiEvent(analytics.event, analytics.userId, analytics.params);
    });
  }
  res.status(response.status);
  if (response.data !== null) {
    res.json(response.data);
  } else {
    res.end();
  }
};

// Initialize Firebase Admin
initializeApp();
const auth = getAuth();

const app = express();

// Basic middleware
app.use(express.json());
app.use(cors());

// Content type middleware to ensure JSON responses
const ensureJsonResponse: RequestHandler = (req, res, next) => {
  // Set content type for all responses
  res.setHeader('Content-Type', 'application/json');
  next();
};

// Apply content type middleware
app.use(ensureJsonResponse);

declare module 'express-serve-static-core' {
  interface Request {
    userId: string;
    validated_params?: unknown;
  }
}

// Authentication middleware
const authenticate_request: RequestHandler = async (req, res, next) => {
  try {
    const auth_header = req.headers.authorization;
    if (!auth_header) {
      throw new UnauthorizedError('Authentication required: valid Firebase ID token needed');
    }

    const token = auth_header.startsWith('Bearer ') ? auth_header.split('Bearer ')[1] : auth_header;

    if (!token) {
      throw new UnauthorizedError('Authentication token is required');
    }

    const decoded_token = await auth.verifyIdToken(token);
    const user_id = decoded_token.uid;

    if (!user_id) {
      throw new UnauthorizedError('Invalid token: no user ID found');
    }

    // Attach userId to request
    req.userId = user_id;
    next();
  } catch (error: unknown) {
    // Check if this is a Firebase Auth token expiration error using the type-safe utility function
    if (isFirebaseAuthTokenExpiredError(error)) {
      next(new UnauthorizedError('Token expired, please re-authenticate'));
    } else {
      next(error);
    }
  }
};

// Apply authentication to all routes
app.use(authenticate_request);

// Service instances
const aiService = new AiService();
const contactService = new ContactService();
const deviceService = new DeviceService();
const feedbackService = new FeedbackService();
const feedQueryService = new FeedQueryService();
const friendshipService = new FriendshipService();
const groupService = new GroupService();
const invitationService = new InvitationService();
const profileService = new ProfileService();
const updateService = new UpdateService();

// Routes - leveraging Express 5+'s automatic error handling for async handlers

// Profile routes
app.get('/me/profile', async (req, res) => {
  const result = await profileService.getProfile(req.userId);
  sendResponse(res, result);
});

app.get('/me/question', async (req, res) => {
  const result = await aiService.generateQuestion(req.userId);
  sendResponse(res, result);
});

app.post('/me/profile', validateRequest(createProfileSchema), async (req, res) => {
  const result = await profileService.createProfile(req.userId, req.validated_params as CreateProfilePayload);
  sendResponse(res, result);
});

app.put('/me/profile', validateRequest(updateProfileSchema), async (req, res) => {
  const result = await profileService.updateProfile(req.userId, req.validated_params as UpdateProfilePayload);
  sendResponse(res, result);
});

app.put('/me/timezone', validateRequest(timezoneSchema), async (req, res) => {
  const result = await profileService.updateTimezone(req.userId, req.validated_params as TimezonePayload);
  sendResponse(res, result);
});

app.put('/me/location', validateRequest(locationSchema), async (req, res) => {
  const result = await profileService.updateLocation(req.userId, req.validated_params as LocationPayload);
  sendResponse(res, result);
});

app.delete('/me/profile', async (req, res) => {
  const result = await profileService.deleteProfile(req.userId);
  sendResponse(res, result);
});

app.get('/me/updates', validateQueryParams(paginationSchema), async (req, res) => {
  const result = await feedQueryService.getMyUpdates(req.userId, req.validated_params as PaginationPayload);
  sendResponse(res, result);
});

app.get('/me/feed', validateQueryParams(paginationSchema), async (req, res) => {
  const result = await feedQueryService.getUserFeed(req.userId, req.validated_params as PaginationPayload);
  sendResponse(res, result);
});

app.get('/me/friends', validateQueryParams(paginationSchema), async (req, res) => {
  const result = await friendshipService.getFriends(req.userId, req.validated_params as PaginationPayload);
  sendResponse(res, result);
});

app.delete('/me/friends/:friend_user_id', async (req, res) => {
  const result = await friendshipService.removeFriend(req.userId, req.params.friend_user_id);
  sendResponse(res, result);
});

app.get('/me/requests', validateQueryParams(paginationSchema), async (req, res) => {
  const result = await invitationService.getMyJoinRequests(req.userId, req.validated_params as PaginationPayload);
  sendResponse(res, result);
});

app.get('/me/requests/:request_id', async (req, res) => {
  const result = await invitationService.getJoinRequest(req.userId, req.params.request_id!);
  sendResponse(res, result);
});

app.get('/me/groups', validateQueryParams(paginationSchema), async (req, res) => {
  const result = await groupService.getUserGroups(req.userId, req.validated_params as PaginationPayload);
  sendResponse(res, result);
});

// User profile routes
app.get('/users/:target_user_id/profile', async (req, res) => {
  const result = await profileService.getFriendProfile(req.userId, req.params.target_user_id);
  sendResponse(res, result);
});

// Lookup users by phone numbers
app.post('/phones/lookup', validateRequest(phoneLookupSchema), async (req, res) => {
  const { phones } = req.validated_params as PhoneLookupPayload;
  const result = await contactService.lookupByPhones(req.userId, phones);
  sendResponse(res, result);
});

app.get('/users/:target_user_id/updates', validateQueryParams(paginationSchema), async (req, res) => {
  const result = await feedQueryService.getUserUpdates(
    req.userId,
    req.params.target_user_id!,
    req.validated_params as PaginationPayload,
  );
  sendResponse(res, result);
});

app.post('/users/:target_user_id/nudge', async (req, res) => {
  const result = await friendshipService.nudgeUser(req.userId, req.params.target_user_id);
  sendResponse(res, result);
});

// Invitation routes
app.get('/invitation', async (req, res) => {
  const result = await invitationService.getInvitation(req.userId);
  sendResponse(res, result);
});

app.post('/invitation/reset', async (req, res) => {
  const result = await invitationService.resetInvitation(req.userId);
  sendResponse(res, result);
});

app.post('/invitation/:invitation_id/join', async (req, res) => {
  const result = await invitationService.requestToJoin(req.userId, req.params.invitation_id);
  sendResponse(res, result);
});

app.post('/invitation/:request_id/accept', async (req, res) => {
  const result = await invitationService.acceptJoinRequest(req.userId, req.params.request_id);
  sendResponse(res, result);
});

app.post('/invitation/:request_id/reject', async (req, res) => {
  const result = await invitationService.rejectJoinRequest(req.userId, req.params.request_id);
  sendResponse(res, result);
});

app.get('/invitation/requests', validateQueryParams(paginationSchema), async (req, res) => {
  const result = await invitationService.getJoinRequests(req.userId, req.validated_params as PaginationPayload);
  sendResponse(res, result);
});

// Device routes
app.get('/device', async (req, res) => {
  const result = await deviceService.getDevice(req.userId);
  sendResponse(res, result);
});

app.put('/device', validateRequest(deviceSchema), async (req, res) => {
  const { device_id } = req.validated_params as DevicePayload;
  const result = await deviceService.updateDevice(req.userId, device_id);
  sendResponse(res, result);
});

// Update routes
app.post('/updates', validateRequest(createUpdateSchema), async (req, res) => {
  const result = await updateService.createUpdate(req.userId, req.validated_params as CreateUpdatePayload);
  sendResponse(res, result);
});

app.get('/updates/:update_id', validateQueryParams(paginationSchema), async (req, res) => {
  const result = await updateService.getUpdate(
    req.userId,
    req.params.update_id!,
    req.validated_params as PaginationPayload,
  );
  sendResponse(res, result);
});

// Share update with additional friends
app.put('/updates/:update_id/share', validateRequest(shareUpdateSchema), async (req, res) => {
  const result = await updateService.shareUpdate(
    req.userId,
    req.params.update_id!,
    req.validated_params as ShareUpdatePayload,
  );
  sendResponse(res, result);
});

// Comment routes
app.get('/updates/:update_id/comments', validateQueryParams(paginationSchema), async (req, res) => {
  const result = await updateService.getComments(
    req.userId,
    req.params.update_id!,
    req.validated_params as PaginationPayload,
  );
  sendResponse(res, result);
});

app.post('/updates/:update_id/comments', validateRequest(createCommentSchema), async (req, res) => {
  const result = await updateService.createComment(
    req.userId,
    req.params.update_id!,
    req.validated_params as CreateCommentPayload,
  );
  sendResponse(res, result);
});

app.put('/updates/:update_id/comments/:comment_id', validateRequest(updateCommentSchema), async (req, res) => {
  const result = await updateService.updateComment(
    req.userId,
    req.params.update_id!,
    req.params.comment_id!,
    req.validated_params as UpdateCommentPayload,
  );
  sendResponse(res, result);
});

app.delete('/updates/:update_id/comments/:comment_id', async (req, res) => {
  const result = await updateService.deleteComment(req.userId, req.params.update_id!, req.params.comment_id!);
  sendResponse(res, result);
});

// Reaction routes
app.post('/updates/:update_id/reactions/add', validateRequest(reactionSchema), async (req, res) => {
  const { type } = req.validated_params as CreateReactionPayload;
  const result = await updateService.addReaction(req.userId, req.params.update_id!, type);
  sendResponse(res, result);
});

app.post('/updates/:update_id/reactions/remove', validateRequest(reactionSchema), async (req, res) => {
  const { type } = req.validated_params as CreateReactionPayload;
  const result = await updateService.removeReaction(req.userId, req.params.update_id!, type);
  sendResponse(res, result);
});

// Sentiment analysis endpoint
app.post('/updates/sentiment', validateRequest(analyzeSentimentSchema), async (req, res) => {
  const { content } = req.validated_params as AnalyzeSentimentPayload;
  const result = await aiService.analyzeSentiment(req.userId, content);
  sendResponse(res, result);
});

app.post('/updates/transcribe', validateRequest(transcribeAudioSchema), async (req, res) => {
  const { audio_data } = req.validated_params as TranscribeAudioPayload;
  const result = await aiService.transcribeAudio(req.userId, audio_data);
  sendResponse(res, result);
});

// // Group routes
// app.post('/groups', validateRequest(createGroupSchema), async (req, res) => {
//   const result = await groupService.createGroup(req.userId, req.validated_params as CreateGroupPayload);
//   sendResponse(res, result);
// });

// app.get('/groups/:group_id/members', async (req, res) => {
//   const result = await groupService.getGroupMembers(req.userId, req.params.group_id!);
//   sendResponse(res, result);
// });

// app.post('/groups/:group_id/members', validateRequest(addGroupMembersSchema), async (req, res) => {
//   const { members } = req.validated_params as AddGroupMembersPayload;
//   const result = await groupService.addMembers(req.userId, req.params.group_id!, members);
//   sendResponse(res, result);
// });

// app.get('/groups/:group_id/feed', validateQueryParams(paginationSchema), async (req, res) => {
//   const result = await groupService.getGroupFeed(
//     req.userId,
//     req.params.group_id!,
//     req.validated_params as PaginationPayload,
//   );
//   sendResponse(res, result);
// });

// app.get('/groups/:group_id/chats', validateQueryParams(paginationSchema), async (req, res) => {
//   const result = await groupService.getGroupChats(
//     req.userId,
//     req.params.group_id!,
//     req.validated_params as PaginationPayload,
//   );
//   sendResponse(res, result);
// });

// app.post('/groups/:group_id/chats', validateRequest(createChatMessageSchema), async (req, res) => {
//   const result = await groupService.createChatMessage(
//     req.userId,
//     req.params.group_id!,
//     req.validated_params as CreateChatMessagePayload,
//   );
//   sendResponse(res, result);
// });

// Test prompt endpoint
app.post('/test/prompt', validateRequest(testPromptSchema), async (req, res) => {
  await testPrompt(req, res);
});

// Test notification endpoint
app.post('/test/notification', validateRequest(testNotificationSchema), async (req, res) => {
  await testNotification(req, res);
});

// Feedback endpoint
app.post('/feedback', validateRequest(createFeedbackSchema), async (req, res) => {
  const { content } = req.validated_params as CreateFeedbackPayload;
  const result = await feedbackService.createFeedback(req.userId, content);
  sendResponse(res, result);
});

// Catch-all route handler for unmatched routes
app.use((req, res) => {
  // Ensure content type is set to application/json
  res.setHeader('Content-Type', 'application/json');

  res.status(403).json({
    code: 403,
    name: 'Forbidden',
    description: `Cannot ${req.method} ${req.path}`,
  });
});

// Global error handler
// Next attribute is required for Express
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const global_error_handler: ErrorRequestHandler = (err, req, res, next) => {
  // Log the error with request context
  console.error(`Error during ${req.method} ${req.path}:`, err);

  // Ensure content type is set to application/json
  res.setHeader('Content-Type', 'application/json');

  let statusCode = 500;
  let errorName = 'Internal Server Error';
  let errorDescription = 'An unexpected error occurred.';

  // Handle specific known errors
  if (err instanceof ZodError) {
    statusCode = 400;
    errorName = 'Bad Request';
    errorDescription = 'Invalid request parameters.';
  } else if (err instanceof BadRequestError) {
    statusCode = err.statusCode;
    errorName = err.name;
    errorDescription = err.message;
  } else if (err instanceof UnauthorizedError) {
    statusCode = err.statusCode;
    errorName = err.name;
    errorDescription = err.message;
  } else if (err instanceof ForbiddenError) {
    statusCode = err.statusCode;
    errorName = err.name;
    errorDescription = err.message;
  } else if (err instanceof NotFoundError) {
    statusCode = err.statusCode;
    errorName = err.name;
    errorDescription = err.message;
  } else if (err instanceof ConflictError) {
    statusCode = err.statusCode;
    errorName = err.name;
    errorDescription = err.message;
  } else if (err instanceof InternalServerError) {
    statusCode = err.statusCode;
    errorName = err.name;
    errorDescription = err.message;
  } else if (
    err &&
    typeof err === 'object' &&
    'statusCode' in err &&
    typeof (err as { statusCode: unknown }).statusCode === 'number'
  ) {
    // Handle generic errors that might have a statusCode attached
    const typedErr = err as ErrorWithStatus;
    statusCode = typedErr.statusCode;
    errorName = typedErr.name || 'Error';
    errorDescription = typedErr.message || 'An error occurred.';
  }

  const response: ApiResponse<ErrorResponse> = {
    data: {
      code: statusCode,
      name: errorName,
      description: errorDescription,
    },
    status: statusCode,
    analytics: {
      event: EventName.API_ERROR,
      userId: req.userId,
      params: {
        error_type: errorName,
        error_message: errorDescription,
        error_code: statusCode,
        path: req.path,
        method: req.method,
      },
    },
  };

  sendResponse(res, response);
};

// Register the global error handler last
app.use(global_error_handler);

export { app };
