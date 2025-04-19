export interface Insights {
  emotional_overview: string;
  key_moments: string;
  recurring_themes: string;
  progress_and_growth: string;
}

export interface BaseUser {
  user_id: string;
  username: string;
  name: string;
  avatar: string;
}

export interface ProfileResponse extends BaseUser {
  location: string;
  birthday: string; // Format: yyyy-mm-dd
  notification_settings: string[];
  gender: string;
  summary: string;
  insights: Insights;
  suggestions: string;
  updated_at: string;
}

export interface FriendProfileResponse {
  user_id: string;
  username: string;
  name: string;
  avatar: string;
  location: string;
  birthday: string; // Format: yyyy-mm-dd
  gender: string;
  summary: string;
  suggestions: string;
  updated_at: string;
}

export interface ReactionGroup {
  type: string;
  count: number;
  reaction_id: string;
}

export interface Update {
  update_id: string;
  created_by: string;
  content: string;
  group_ids: string[];
  friend_ids: string[];
  sentiment: string;
  score: string;
  emoji: string;
  created_at: string;
  comment_count: number;
  reaction_count: number;
  reactions: ReactionGroup[];
}

export interface EnrichedUpdate extends Update {
  username: string;
  name: string;
  avatar: string;
}

export interface UpdatesResponse {
  updates: Update[];
  next_cursor: string | null;
}

export interface FeedItem {
  update_id: string;
  created_at: string;
  direct_visible: boolean;
  friend_id: string;
  group_ids: string[];
}

export interface FeedResponse {
  updates: EnrichedUpdate[];
  next_cursor: string | null;
}

export interface Invitation {
  invitation_id: string;
  created_at: string;
  expires_at: string;
  sender_id: string;
  status: string;
  username: string;
  name: string;
  avatar: string;
  receiver_name: string;
}

export interface Friend {
  user_id: string;
  username: string;
  name: string;
  avatar: string;
}

export interface FriendsResponse {
  friends: Friend[];
  next_cursor: string | null;
}

export interface InvitationsResponse {
  invitations: Invitation[];
  next_cursor: string | null;
}

export interface Device {
  device_id: string;
  updated_at: string;
}

export interface Group {
  group_id: string;
  name: string;
  icon: string;
  created_at: string;
  members: string[];
  member_profiles: Record<string, string>[];
}

export interface GroupsResponse {
  groups: Group[];
}

export interface GroupMember extends BaseUser {
  // Group member with basic profile information
}

export interface GroupMembersResponse {
  members: GroupMember[];
}

export interface ChatMessage {
  message_id: string;
  sender_id: string;
  text: string;
  created_at: string;
  attachments?: string[];
}

export interface ChatResponse {
  messages: ChatMessage[];
  next_cursor: string | null;
}

// Define types for AI generation results
export interface FriendProfileResult {
  summary: string;
  suggestions: string;
}

export interface CreatorProfileResult {
  summary: string;
  suggestions: string;
  emotional_overview: string;
  key_moments: string;
  recurring_themes: string;
  progress_and_growth: string;
}

export interface NotificationResponse {
  success: boolean;
  message: string;
  messageId: string;
}

export interface QuestionResponse {
  question: string;
}

export interface Comment {
  comment_id: string;
  created_by: string;
  content: string;
  created_at: string;
  updated_at: string;
  username: string;
  name: string;
  avatar: string;
}

export interface CommentsResponse {
  comments: Comment[];
  next_cursor: string | null;
}

export interface Feedback {
  feedback_id: string;
  created_by: string;
  content: string;
  created_at: string;
}

export interface SentimentAnalysisResponse {
  sentiment: string;
  score: number;
  emoji: string;
}