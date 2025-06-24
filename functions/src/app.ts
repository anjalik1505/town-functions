import cors from 'cors';
import express, { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { ZodError } from 'zod';
import { getDevice } from './device/get-device.js';
import { updateDevice } from './device/update-device.js';
import { createFeedback } from './feedback/create-feedback.js';
import { acceptJoinRequest } from './invitations/accept-join-request.js';
import { getInvitation } from './invitations/get-invitation.js';
import { getJoinRequests } from './invitations/get-join-requests.js';
import { rejectJoinRequest } from './invitations/reject-join-request.js';
import { requestToJoin } from './invitations/request-to-join.js';
import { resetInvitation } from './invitations/reset-invitation.js';
import { validateQueryParams, validateRequest } from './middleware/validation.js';
import { ApiResponse, ErrorResponse, EventName } from './models/analytics-events.js';
import {
  analyzeSentimentSchema,
  createCommentSchema,
  createFeedbackSchema,
  createProfileSchema,
  createReactionSchema,
  createUpdateSchema,
  deviceSchema,
  locationSchema,
  paginationSchema,
  phoneLookupSchema,
  shareUpdateSchema,
  testNotificationSchema,
  testPromptSchema,
  timezoneSchema,
  transcribeAudioSchema,
  updateCommentSchema,
  updateProfileSchema,
} from './models/validation-schemas.js';
import { createProfile } from './own_profile/create-my-profile.js';
import { deleteProfile } from './own_profile/delete-my-profile.js';
import { getJoinRequest } from './own_profile/get-join-request.js';
import { getFeeds } from './own_profile/get-my-feeds.js';
import { getMyFriends } from './own_profile/get-my-friends.js';
import { getMyJoinRequests } from './own_profile/get-my-join-requests.js';
import { getProfile } from './own_profile/get-my-profile.js';
import { getUpdates } from './own_profile/get-my-updates.js';
import { getQuestion } from './own_profile/get-question.js';
import { removeFriend } from './own_profile/remove-friend.js';
import { updateLocation } from './own_profile/update-location.js';
import { updateProfile } from './own_profile/update-my-profile.js';
import { updateTimezone } from './own_profile/update-timezone.js';
import { testNotification } from './test/test-notification.js';
import { testPrompt } from './test/test-prompt.js';
import { analyzeSentiment } from './updates/analyze-sentiment.js';
import { createComment } from './updates/create-comment.js';
import { createReaction } from './updates/create-reaction.js';
import { createUpdate } from './updates/create-update.js';
import { deleteComment } from './updates/delete-comment.js';
import { deleteReaction } from './updates/delete-reaction.js';
import { getComments } from './updates/get-comments.js';
import { getUpdate } from './updates/get-update.js';
import { shareUpdate } from './updates/share-update.js';
import { transcribeAudio } from './updates/transcribe-audio.js';
import { updateComment } from './updates/update-comment.js';
import { getUserProfile } from './user_profile/get-user-profile.js';
import { getUserUpdates } from './user_profile/get-user-updates.js';
import { lookupPhones } from './user_profile/lookup-phones.js';
import { nudgeUser } from './user_profile/nudge-user.js';
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

// Routes - leveraging Express 5+'s automatic error handling for async handlers
app.get('/me/profile', async (req, res) => {
  const result = await getProfile(req);
  sendResponse(res, result);
});

app.get('/me/question', async (req, res) => {
  const result = await getQuestion(req);
  sendResponse(res, result);
});

app.post('/me/profile', validateRequest(createProfileSchema), async (req, res) => {
  const result = await createProfile(req);
  sendResponse(res, result);
});

app.put('/me/profile', validateRequest(updateProfileSchema), async (req, res) => {
  const result = await updateProfile(req);
  sendResponse(res, result);
});

app.put('/me/timezone', validateRequest(timezoneSchema), async (req, res: Response) => {
  await updateTimezone(req, res);
});

app.put('/me/location', validateRequest(locationSchema), async (req, res: Response) => {
  await updateLocation(req, res);
});

app.delete('/me/profile', async (req, res) => {
  const result = await deleteProfile(req);
  sendResponse(res, result);
});

app.get('/me/updates', validateQueryParams(paginationSchema), async (req, res) => {
  const result = await getUpdates(req);
  sendResponse(res, result);
});

app.get('/me/feed', validateQueryParams(paginationSchema), async (req, res) => {
  const result = await getFeeds(req);
  sendResponse(res, result);
});

app.get('/me/friends', validateQueryParams(paginationSchema), async (req, res) => {
  const result = await getMyFriends(req);
  sendResponse(res, result);
});

app.delete('/me/friends/:friend_user_id', async (req, res) => {
  const result = await removeFriend(req);
  sendResponse(res, result);
});

app.get('/me/requests', validateQueryParams(paginationSchema), async (req, res) => {
  const result = await getMyJoinRequests(req);
  sendResponse(res, result);
});

app.get('/me/requests/:request_id', async (req, res) => {
  const result = await getJoinRequest(req);
  sendResponse(res, result);
});

// User profile routes
app.get('/users/:target_user_id/profile', async (req, res) => {
  const result = await getUserProfile(req);
  sendResponse(res, result);
});

// Lookup users by phone numbers
app.post('/phones/lookup', validateRequest(phoneLookupSchema), async (req, res) => {
  const result = await lookupPhones(req);
  sendResponse(res, result);
});

app.get('/users/:target_user_id/updates', validateQueryParams(paginationSchema), async (req, res) => {
  const result = await getUserUpdates(req);
  sendResponse(res, result);
});

app.post('/users/:target_user_id/nudge', async (req, res) => {
  const result = await nudgeUser(req);
  sendResponse(res, result);
});

// Invitation routes
app.get('/invitation', async (req, res) => {
  const result = await getInvitation(req);
  sendResponse(res, result);
});

app.post('/invitation/reset', async (req, res) => {
  const result = await resetInvitation(req);
  sendResponse(res, result);
});

app.post('/invitation/:invitation_id/join', async (req, res) => {
  const result = await requestToJoin(req);
  sendResponse(res, result);
});

app.post('/invitation/:request_id/accept', async (req, res) => {
  const result = await acceptJoinRequest(req);
  sendResponse(res, result);
});

app.post('/invitation/:request_id/reject', async (req, res) => {
  const result = await rejectJoinRequest(req);
  sendResponse(res, result);
});

app.get('/invitation/requests', validateQueryParams(paginationSchema), async (req, res) => {
  const result = await getJoinRequests(req);
  sendResponse(res, result);
});

// Device routes
app.get('/device', async (req, res) => {
  await getDevice(req, res);
});

app.put('/device', validateRequest(deviceSchema), async (req, res) => {
  await updateDevice(req, res);
});

// Update routes
app.post('/updates/transcribe', validateRequest(transcribeAudioSchema), async (req, res) => {
  const result = await transcribeAudio(req);
  sendResponse(res, result);
});

app.post('/updates', validateRequest(createUpdateSchema), async (req, res) => {
  const result = await createUpdate(req);
  sendResponse(res, result);
});

app.get('/updates/:update_id', validateQueryParams(paginationSchema), async (req, res) => {
  const result = await getUpdate(req);
  sendResponse(res, result);
});

// Share update with additional friends
app.put('/updates/:update_id/share', validateRequest(shareUpdateSchema), async (req, res) => {
  const result = await shareUpdate(req);
  sendResponse(res, result);
});

// Comment routes
app.get('/updates/:update_id/comments', validateQueryParams(paginationSchema), async (req, res) => {
  const result = await getComments(req);
  sendResponse(res, result);
});

app.post('/updates/:update_id/comments', validateRequest(createCommentSchema), async (req, res) => {
  const result = await createComment(req);
  sendResponse(res, result);
});

app.put('/updates/:update_id/comments/:comment_id', validateRequest(updateCommentSchema), async (req, res) => {
  const result = await updateComment(req);
  sendResponse(res, result);
});

app.delete('/updates/:update_id/comments/:comment_id', async (req, res) => {
  const result = await deleteComment(req);
  sendResponse(res, result);
});

// Reaction routes
app.post('/updates/:update_id/reactions', validateRequest(createReactionSchema), async (req, res) => {
  const result = await createReaction(req);
  sendResponse(res, result);
});

app.delete('/updates/:update_id/reactions/:reaction_id', async (req, res) => {
  const result = await deleteReaction(req);
  sendResponse(res, result);
});

// Sentiment analysis endpoint
app.post('/updates/sentiment', validateRequest(analyzeSentimentSchema), async (req, res) => {
  const result = await analyzeSentiment(req);
  sendResponse(res, result);
});

// // Group routes
// app.get("/me/groups", handle_errors(false), async (req, res) => {
//     await getMyGroups(req, res);
// });

// app.post("/groups", handle_errors(true), validateRequest(createGroupSchema), async (req, res) => {
//     await createGroup(req, res);
// });

// app.get("/groups/:group_id/members", handle_errors(false), async (req, res) => {
//     await getGroupMembers(req, res, req.params.group_id);
// });

// app.post("/groups/:group_id/members", handle_errors(true), validateRequest(addGroupMembersSchema), async (req, res) => {
//     await addMembersToGroup(req, res, req.params.group_id);
// });

// app.get("/groups/:group_id/feed", handle_errors(true), validateQueryParams(paginationSchema), async (req, res) => {
//     await getGroupFeed(req, res, req.params.group_id);
// });

// app.get("/groups/:group_id/chats", handle_errors(true), validateQueryParams(paginationSchema), async (req, res) => {
//     await getGroupChats(req, res, req.params.group_id);
// });

// app.post("/groups/:group_id/chats", handle_errors(true), validateRequest(createChatMessageSchema), async (req, res) => {
//     await createGroupChatMessage(req, res, req.params.group_id);
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
  const result = await createFeedback(req);
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
