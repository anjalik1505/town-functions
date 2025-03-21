export interface Insights {
  emotional_overview: string;
  key_moments: string;
  recurring_themes: string;
  progress_and_growth: string;
}

export interface BaseUser {
  user_id: string;
  username: string;
  name?: string;
  avatar?: string;
}

export interface ProfileResponse extends BaseUser {
  location?: string;
  birthday?: string;
  notification_settings?: string[];
  summary?: string;
  insights?: Insights;
  suggestions?: string;
  updated_at?: string;
}

export interface FriendProfileResponse extends BaseUser {
  location?: string;
  birthday?: string;
  summary?: string;
  suggestions?: string;
  updated_at?: string;
}

export interface Update {
  update_id: string;
  created_by: string;
  content: string;
  group_ids: string[];
  friend_ids: string[];
  sentiment: string;
  created_at: string;
}

export interface UpdatesResponse {
  updates: Update[];
  next_timestamp: string | null;
}

export interface FeedResponse {
  updates: Update[];
  next_timestamp: string | null;
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
}

export interface Friend {
  user_id: string;
  username: string;
  name: string;
  avatar: string;
}

export interface InvitationsResponse {
  invitations: Invitation[];
}

export interface Device {
  device_id: string;
  updated_at: string;
} 