import { z } from "zod";

// Profile schemas
export const createProfileSchema = z.object({
    username: z.string().min(1),
    name: z.string().optional(),
    avatar: z.string().optional(),
    location: z.string().optional(),
    birthday: z.string().optional(),
    notification_settings: z.array(z.string()).optional()
});

export const updateProfileSchema = z.object({
    username: z.string().min(1).optional(),
    name: z.string().optional(),
    avatar: z.string().optional(),
    location: z.string().optional(),
    birthday: z.string().optional(),
    notification_settings: z.array(z.string()).optional()
});

// Pagination schemas
export const paginationSchema = z.object({
    limit: z.number().min(1).max(100).default(20),
    after_timestamp: z.string().optional()
});

export const deviceSchema = z.object({
    device_id: z.string().min(1, "Device ID is required")
});

export const createUpdateSchema = z.object({
    content: z.string().min(1, "Content is required"),
    sentiment: z.string().min(1, "Sentiment is required"),
    group_ids: z.array(z.string()).optional(),
    friend_ids: z.array(z.string()).optional()
});

export const createChatMessageSchema = z.object({
    text: z.string().min(1, "Message text is required"),
    attachments: z.array(z.string()).optional()
});

export const createGroupSchema = z.object({
    name: z.string().min(1, "Group name is required"),
    icon: z.string().optional(),
    members: z.array(z.string()).min(1, "At least one member is required")
});

export const addGroupMembersSchema = z.object({
    members: z.array(z.string()).min(1, "At least one member is required")
}); 