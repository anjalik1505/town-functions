import cors from "cors";
import express, { ErrorRequestHandler, RequestHandler, Response } from "express";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { ZodError } from "zod";
import { getDevice } from "./device/get-device";
import { updateDevice } from "./device/update-device";
import { createFeedback } from "./feedback/create-feedback";
import { acceptInvitation } from "./invitations/accept-invitation";
import { createInvitation } from "./invitations/create-invitation";
import { getInvitation } from "./invitations/get-invitation";
import { getInvitations } from "./invitations/get-invitations";
import { rejectInvitation } from "./invitations/reject-invitation";
import { resendInvitation } from "./invitations/resend-invitation";
import { validateQueryParams, validateRequest } from "./middleware/validation";
import { ApiResponse, ErrorResponse, EventName } from "./models/analytics-events";
import { analyzeSentimentSchema, createCommentSchema, createFeedbackSchema, createInvitationSchema, createProfileSchema, createReactionSchema, createUpdateSchema, deviceSchema, paginationSchema, testNotificationSchema, testPromptSchema, updateCommentSchema, updateProfileSchema } from "./models/validation-schemas";
import { createProfile } from "./own_profile/create-my-profile";
import { deleteProfile } from "./own_profile/delete-my-profile";
import { getFeeds } from "./own_profile/get-my-feeds";
import { getMyFriends } from "./own_profile/get-my-friends";
import { getProfile } from "./own_profile/get-my-profile";
import { getUpdates } from "./own_profile/get-my-updates";
import { getQuestion } from "./own_profile/get-question";
import { updateProfile } from "./own_profile/update-my-profile";
import { testNotification } from "./test/test-notification";
import { testPrompt } from "./test/test-prompt";
import { analyzeSentiment } from "./updates/analyze-sentiment";
import { createComment } from "./updates/create-comment";
import { createReaction } from "./updates/create-reaction";
import { createUpdate } from "./updates/create-update";
import { deleteComment } from "./updates/delete-comment";
import { deleteReaction } from "./updates/delete-reaction";
import { getComments } from "./updates/get-comments";
import { updateComment } from "./updates/update-comment";
import { getUserProfile } from "./user_profile/get-user-profile";
import { getUserUpdates } from "./user_profile/get-user-updates";
import { trackApiEvent } from "./utils/analytics-utils";
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    InternalServerError,
    NotFoundError,
    UnauthorizedError
} from "./utils/errors";

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

// Extend Express Request type to include userId and validated_params
declare global {
    namespace Express {
        interface Request {
            userId: string;  // Changed from optional to required since it's always set by auth middleware
            validated_params?: any; // This will be properly typed by the validation middleware
        }
    }
}

// Authentication middleware
const authenticate_request: RequestHandler = async (req, res, next) => {
    try {
        const auth_header = req.headers.authorization;
        if (!auth_header) {
            throw new UnauthorizedError("Authentication required: valid Firebase ID token needed");
        }

        const token = auth_header.startsWith("Bearer ")
            ? auth_header.split("Bearer ")[1]
            : auth_header;

        const decoded_token = await auth.verifyIdToken(token);
        const user_id = decoded_token.uid;

        if (!user_id) {
            throw new UnauthorizedError("Invalid token: no user ID found");
        }

        // Attach userId to request
        req.userId = user_id;
        next();
    } catch (error: unknown) {
        next(error);
    }
};

// Apply authentication to all routes
app.use(authenticate_request);

// Routes - leveraging Express 5+'s automatic error handling for async handlers
app.get("/me/profile", async (req, res) => {
    const result = await getProfile(req);
    sendResponse(res, result);
});

app.get("/me/question", async (req, res) => {
    await getQuestion(req, res);
});

app.post("/me/profile", validateRequest(createProfileSchema), async (req, res) => {
    const result = await createProfile(req);
    sendResponse(res, result);
});

app.put("/me/profile", validateRequest(updateProfileSchema), async (req, res) => {
    const result = await updateProfile(req);
    sendResponse(res, result);
});

app.delete("/me/profile", async (req, res) => {
    const result = await deleteProfile(req);
    sendResponse(res, result);
});

app.get("/me/updates", validateQueryParams(paginationSchema), async (req, res) => {
    const result = await getUpdates(req);
    sendResponse(res, result);
});

app.get("/me/feed", validateQueryParams(paginationSchema), async (req, res) => {
    const result = await getFeeds(req);
    sendResponse(res, result);
});

app.get("/me/friends", validateQueryParams(paginationSchema), async (req, res) => {
    await getMyFriends(req, res);
});

// User profile routes
app.get("/users/:target_user_id/profile", async (req, res) => {
    const result = await getUserProfile(req);
    sendResponse(res, result);
});

app.get("/users/:target_user_id/updates", validateQueryParams(paginationSchema), async (req, res) => {
    const result = await getUserUpdates(req);
    sendResponse(res, result);
});

// Invitation routes
app.get("/invitations", validateQueryParams(paginationSchema), async (req, res) => {
    const result = await getInvitations(req);
    sendResponse(res, result);
});

app.get("/invitations/:invitation_id", async (req, res) => {
    const result = await getInvitation(req);
    sendResponse(res, result);
});

app.post("/invitations", validateRequest(createInvitationSchema), async (req, res) => {
    const result = await createInvitation(req);
    sendResponse(res, result);
});

app.post("/invitations/:invitation_id/accept", async (req, res) => {
    const result = await acceptInvitation(req);
    sendResponse(res, result);
});

app.post("/invitations/:invitation_id/reject", async (req, res) => {
    const result = await rejectInvitation(req);
    sendResponse(res, result);
});

app.post("/invitations/:invitation_id/resend", async (req, res) => {
    const result = await resendInvitation(req);
    sendResponse(res, result);
});

// Device routes
app.get("/device", async (req, res) => {
    await getDevice(req, res);
});

app.put("/device", validateRequest(deviceSchema), async (req, res) => {
    await updateDevice(req, res);
});

// Update routes
app.post("/updates", validateRequest(createUpdateSchema), async (req, res) => {
    const result = await createUpdate(req);
    sendResponse(res, result);
});

// Comment routes
app.get("/updates/:update_id/comments", validateQueryParams(paginationSchema), async (req, res) => {
    await getComments(req, res);
});

app.post("/updates/:update_id/comments", validateRequest(createCommentSchema), async (req, res) => {
    await createComment(req, res);
});

app.put("/updates/:update_id/comments/:comment_id", validateRequest(updateCommentSchema), async (req, res) => {
    await updateComment(req, res);
});

app.delete("/updates/:update_id/comments/:comment_id", async (req, res) => {
    await deleteComment(req, res);
});

// Reaction routes
app.post("/updates/:update_id/reactions", validateRequest(createReactionSchema), async (req, res) => {
    await createReaction(req, res);
});

app.delete("/updates/:update_id/reactions/:reaction_id", async (req, res) => {
    await deleteReaction(req, res);
});

// Sentiment analysis endpoint
app.post("/updates/sentiment", validateRequest(analyzeSentimentSchema), async (req, res) => {
    await analyzeSentiment(req, res);
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
app.post("/test/prompt", validateRequest(testPromptSchema), async (req, res) => {
    await testPrompt(req, res);
});

// Test notification endpoint
app.post("/test/notification", validateRequest(testNotificationSchema), async (req, res) => {
    await testNotification(req, res);
});

// Feedback endpoint
app.post("/feedback", validateRequest(createFeedbackSchema), async (req, res) => {
    await createFeedback(req, res);
});

// Catch-all route handler for unmatched routes
app.use((req, res) => {
    // Ensure content type is set to application/json
    res.setHeader('Content-Type', 'application/json');

    res.status(403).json({
        code: 403,
        name: "Forbidden",
        description: `Cannot ${req.method} ${req.path}`
    });
});

// Global error handler
const global_error_handler: ErrorRequestHandler = (err, req, res, next) => {
    // Log the error with request context
    console.error(`Error during ${req.method} ${req.path}:`, err);

    // Ensure content type is set to application/json
    res.setHeader('Content-Type', 'application/json');

    let statusCode = 500;
    let errorName = "Internal Server Error";
    let errorDescription = "An unexpected error occurred.";

    // Handle specific known errors
    if (err instanceof ZodError) {
        statusCode = 400;
        errorName = "Bad Request";
        errorDescription = "Invalid request parameters.";
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
    } else if (err && typeof err === 'object' && 'statusCode' in err && typeof (err as any).statusCode === 'number') {
        // Handle generic errors that might have a statusCode attached
        statusCode = (err as any).statusCode;
        errorName = (err as any).name || "Error";
        errorDescription = (err as any).message || "An error occurred.";
    }

    const response: ApiResponse<ErrorResponse> = {
        data: {
            code: statusCode,
            name: errorName,
            description: errorDescription
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
                method: req.method
            }
        }
    };

    sendResponse(res, response);
};

// Register the global error handler last
app.use(global_error_handler);

export { app };
