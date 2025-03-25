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

export const ownProfileSchema = z.object({
    summary: z.string(),
    suggestions: z.string(),
    emotional_overview: z.string(),
    key_moments: z.string(),
    recurring_themes: z.string(),
    progress_and_growth: z.string()
});

export const friendProfileSchema = z.object({
    summary: z.string(),
    suggestions: z.string()
});

export const testPromptSchema = z.object({
    summary: z.string(),
    suggestions: z.string(),
    emotional_overview: z.string().optional(),
    key_moments: z.string().optional(),
    recurring_themes: z.string().optional(),
    progress_and_growth: z.string().optional(),
    update_content: z.string(),
    update_sentiment: z.string(),
    gender: z.string().optional().default("they"),
    location: z.string().optional(),
    is_own_profile: z.boolean(),
    prompt: z.string(),
    temperature: z.number().optional()
});
