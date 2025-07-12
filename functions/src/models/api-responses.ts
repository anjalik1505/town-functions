export interface Insights {
  emotional_overview: string;
  key_moments: string;
  recurring_themes: string;
  progress_and_growth: string;
}

export interface NudgingSettings {
  occurrence: string;
  times_of_day?: string[];
  days_of_week?: string[];
}

export interface BaseUser {
  user_id: string;
  username: string;
  name: string;
  avatar: string;
}

export interface BaseGroup {
  group_id: string;
  name: string;
  icon: string;
}

export interface ProfileResponse extends BaseUser {
  location: string;
  birthday: string; // Format: yyyy-mm-dd
  notification_settings: string[];
  nudging_settings: NudgingSettings | null;
  gender: string;
  summary: string;
  insights: Insights;
  suggestions: string;
  updated_at: string;
  timezone: string;
  tone: string;
  phone_number: string;
}

export interface FriendProfileResponse extends BaseUser {
  location: string;
  birthday: string; // Format: yyyy-mm-dd
  gender: string;
  summary: string;
  suggestions: string;
  updated_at: string;
  timezone: string;
}

export interface ReactionGroup {
  type: string;
  count: number;
}

export interface Update {
  update_id: string;
  created_by: string;
  content: string;
  group_ids: string[];
  friend_ids: string[];
  sentiment: string;
  score: number;
  emoji: string;
  created_at: string;
  comment_count: number;
  reaction_count: number;
  reactions: ReactionGroup[];
  all_village: boolean;
  images: string[];
  shared_with_friends: BaseUser[];
  shared_with_groups: BaseGroup[];
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

export interface FeedResponse {
  updates: EnrichedUpdate[];
  next_cursor: string | null;
}

export interface Invitation {
  invitation_id: string;
  created_at: string;
  sender_id: string;
  username: string;
  name: string;
  avatar: string;
}

export interface JoinRequest {
  request_id: string;
  invitation_id: string;
  requester_id: string;
  receiver_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  requester_username: string;
  requester_name: string;
  requester_avatar: string;
  receiver_username: string;
  receiver_name: string;
  receiver_avatar: string;
}

export interface JoinRequestResponse {
  join_requests: JoinRequest[];
  next_cursor: string | null;
}

export interface Friend extends BaseUser {
  last_update_emoji: string;
  last_update_time: string;
}

export interface FriendsResponse {
  friends: Friend[];
  next_cursor: string | null;
}

export interface Device {
  device_id: string;
  updated_at: string;
}

export interface Location {
  location: string;
  updated_at: string;
}

export interface Timezone {
  timezone: string;
  updated_at: string;
}

export interface Group extends BaseGroup {
  created_at: string;
  members: string[];
  member_profiles: Record<string, string>[];
}

export interface GroupsResponse {
  groups: Group[];
}

export interface GroupMember extends BaseUser {
  user_id: string;
}

export interface NotificationResponse {
  success: boolean;
  message: string;
  messageId: string;
}

export interface QuestionResponse {
  question: string;
}

export interface NudgeResponse {
  message: string;
}

export interface Comment {
  username: string;
  name: string;
  avatar: string;
  comment_id: string;
  created_by: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface CommentsResponse {
  comments: Comment[];
  next_cursor: string | null;
}

export interface UpdateWithCommentsResponse {
  update: EnrichedUpdate;
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

export interface TranscriptionResponse {
  transcription: string;
  sentiment: string;
  score: number;
  emoji: string;
}

export interface PhoneUser extends BaseUser {
  phone_number: string;
}

export interface PhoneLookupResponse {
  matches: PhoneUser[];
}
