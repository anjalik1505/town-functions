import cors from "cors";
import express, { ErrorRequestHandler, RequestHandler } from "express";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { ZodError } from "zod";
import { getDevice } from "./device/get-device";
import { updateDevice } from "./device/update-device";
import { acceptInvitation } from "./invitations/accept-invitation";
import { createInvitation } from "./invitations/create-invitation";
import { getInvitation } from "./invitations/get-invitation";
import { getInvitations } from "./invitations/get-invitations";
import { rejectInvitation } from "./invitations/reject-invitation";
import { resendInvitation } from "./invitations/resend-invitation";
import { validateQueryParams, validateRequest } from "./middleware/validation";
import { createCommentSchema, createInvitationSchema, createProfileSchema, createUpdateSchema, deviceSchema, paginationSchema, testNotificationSchema, testPromptSchema, updateCommentSchema, updateProfileSchema } from "./models/validation-schemas";
import { createProfile } from "./own_profile/create-my-profile";
import { getFeeds } from "./own_profile/get-my-feeds";
import { getMyFriends } from "./own_profile/get-my-friends";
import { getProfile } from "./own_profile/get-my-profile";
import { getUpdates } from "./own_profile/get-my-updates";
import { getQuestion } from "./own_profile/get-question";
import { updateProfile } from "./own_profile/update-my-profile";
import { testNotification } from "./test/test-notification";
import { testPrompt } from "./test/test-prompt";
import { createComment } from "./updates/create-comment";
import { createUpdate } from "./updates/create-update";
import { deleteComment } from "./updates/delete-comment";
import { getComments } from "./updates/get-comments";
import { updateComment } from "./updates/update-comment";
import { getUserProfile } from "./user_profile/get-user-profile";
import { getUserUpdates } from "./user_profile/get-user-updates";

// Initialize Firebase Admin
initializeApp();
const auth = getAuth();

const app = express();

// Basic middleware
app.use(express.json());
app.use(cors());

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
            res.status(401).json({
                code: 401,
                name: "Unauthorized",
                description: "Authentication required: valid Firebase ID token needed"
            });
            return;
        }

        const token = auth_header.startsWith("Bearer ")
            ? auth_header.split("Bearer ")[1]
            : auth_header;

        const decoded_token = await auth.verifyIdToken(token);
        const user_id = decoded_token.uid;

        if (!user_id) {
            res.status(401).json({
                code: 401,
                name: "Unauthorized",
                description: "Invalid token: no user ID found"
            });
            return;
        }

        // Attach userId to request
        req.userId = user_id;
        next();
    } catch (error: unknown) {
        const error_message = error instanceof Error ? error.message : "Unknown error";
        res.status(401).json({
            code: 401,
            name: "Unauthorized",
            description: `Authentication failed: ${error_message}`
        });
    }
};

// Apply authentication to all routes
app.use(authenticate_request);

// Error handling middleware
const handle_errors = (validate_request: boolean = false): RequestHandler => {
    return (req, res, next) => {
        try {
            next();
        } catch (error: unknown) {
            if (error instanceof ZodError) {
                if (validate_request) {
                    res.status(400).json({
                        code: 400,
                        name: "Bad Request",
                        description: "Invalid request parameters"
                    });
                    return;
                }
                throw error;
            }

            const error_message = error instanceof Error ? error.message : "Unknown error";
            console.error(`Error in ${req.path}: ${error_message}`);

            if (error && typeof error === 'object' && 'status' in error && typeof (error as any).status === 'number') {
                res.status((error as any).status).json({
                    code: (error as any).status,
                    name: (error as any).name || "Error",
                    description: error_message
                });
                return;
            }

            res.status(500).json({
                code: 500,
                name: "Internal Server Error",
                description: "An unexpected error occurred"
            });
        }
    };
};

// Routes with error handling
app.get("/me/profile", handle_errors(false), async (req, res) => {
    await getProfile(req, res);
});

app.get("/me/question", handle_errors(false), async (req, res) => {
    await getQuestion(req, res);
});

app.post("/me/profile", handle_errors(true), validateRequest(createProfileSchema), async (req, res) => {
    await createProfile(req, res);
});

app.put("/me/profile", handle_errors(true), validateRequest(updateProfileSchema), async (req, res) => {
    await updateProfile(req, res);
});

app.get("/me/updates", handle_errors(true), validateQueryParams(paginationSchema), async (req, res) => {
    await getUpdates(req, res);
});

app.get("/me/feed", handle_errors(true), validateQueryParams(paginationSchema), async (req, res) => {
    await getFeeds(req, res);
});

app.get("/me/friends", handle_errors(true), validateQueryParams(paginationSchema), async (req, res) => {
    await getMyFriends(req, res);
});

// User profile routes
app.get("/users/:target_user_id/profile", handle_errors(false), async (req, res) => {
    await getUserProfile(req, res);
});

app.get("/users/:target_user_id/updates", handle_errors(true), validateQueryParams(paginationSchema), async (req, res) => {
    await getUserUpdates(req, res);
});

// Invitation routes
app.get("/invitations", handle_errors(true), validateQueryParams(paginationSchema), async (req, res) => {
    await getInvitations(req, res);
});

app.get("/invitations/:invitation_id", handle_errors(false), async (req, res) => {
    await getInvitation(req, res);
});

app.post("/invitations", handle_errors(true), validateRequest(createInvitationSchema), async (req, res) => {
    await createInvitation(req, res);
});

app.post("/invitations/:invitation_id/accept", handle_errors(false), async (req, res) => {
    await acceptInvitation(req, res);
});

app.post("/invitations/:invitation_id/reject", handle_errors(false), async (req, res) => {
    await rejectInvitation(req, res);
});

app.post("/invitations/:invitation_id/resend", handle_errors(false), async (req, res) => {
    await resendInvitation(req, res);
});

// Device routes
app.get("/device", handle_errors(false), async (req, res) => {
    await getDevice(req, res);
});

app.put("/device", handle_errors(true), validateRequest(deviceSchema), async (req, res) => {
    await updateDevice(req, res);
});

// Update routes
app.post("/updates", handle_errors(true), validateRequest(createUpdateSchema), async (req, res) => {
    await createUpdate(req, res);
});

// Comment routes
app.get("/updates/:update_id/comments", handle_errors(true), validateQueryParams(paginationSchema), async (req, res) => {
    await getComments(req, res);
});

app.post("/updates/:update_id/comments", handle_errors(true), validateRequest(createCommentSchema), async (req, res) => {
    await createComment(req, res);
});

app.put("/updates/:update_id/comments/:comment_id", handle_errors(true), validateRequest(updateCommentSchema), async (req, res) => {
    await updateComment(req, res);
});

app.delete("/updates/:update_id/comments/:comment_id", handle_errors(false), async (req, res) => {
    await deleteComment(req, res);
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
app.post("/test/prompt", handle_errors(true), validateRequest(testPromptSchema), async (req, res) => {
    await testPrompt(req, res);
});

// Test notification endpoint
app.post("/test/notification", handle_errors(true), validateRequest(testNotificationSchema), async (req, res) => {
    await testNotification(req, res);
});

// Catch-all route handler for unmatched routes
app.use((req, res) => {
    res.status(403).json({
        code: 403,
        name: "Forbidden",
        description: `Cannot ${req.method} ${req.path}`
    });
});

// Global error handler
const global_error_handler: ErrorRequestHandler = (err, req, res, next) => {
    console.error(`Error in ${req.path}: ${err.message}`);
    res.status(500).json({
        code: 500,
        name: "Internal Server Error",
        description: "An unexpected error occurred"
    });
};

app.use(global_error_handler);

export { app };

