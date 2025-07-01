import { Timestamp } from 'firebase-admin/firestore';

// Options for notification settings
export const NotificationSettings = {
  ALL: 'all',
  URGENT: 'urgent',
} as const;
export type NotificationSetting = (typeof NotificationSettings)[keyof typeof NotificationSettings];

// Options for nudging settings occurrence
export const NudgingOccurrence = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  NEVER: 'never',
  FEW_DAYS: 'few_days',
} as const;
export type NudgingOccurrenceType = (typeof NudgingOccurrence)[keyof typeof NudgingOccurrence];

// Options for days of the week
export const DaysOfWeek = {
  MONDAY: 'monday',
  TUESDAY: 'tuesday',
  WEDNESDAY: 'wednesday',
  THURSDAY: 'thursday',
  FRIDAY: 'friday',
  SATURDAY: 'saturday',
  SUNDAY: 'sunday',
} as const;
export type DayOfWeek = (typeof DaysOfWeek)[keyof typeof DaysOfWeek];

// Options for goal settings
export const Goals = {
  STAY_CONNECTED: 'stay_connected',
  CHECK_IN: 'check_in',
  IMPROVE_RELATIONSHIPS: 'improve_relationships',
  MEET_NEW_PEOPLE: 'meet_new_people',
  NOT_SURE: 'not_sure',
  EMPTY: '',
} as const;
export type Goal = (typeof Goals)[keyof typeof Goals] | string;

// Options for connect_to settings
export const ConnectTo = {
  FRIENDS: 'friends',
  FAMILY: 'family',
  PARTNER: 'partner',
  NEW_PEOPLE: 'new_people',
  EMPTY: '',
} as const;
export type ConnectToType = (typeof ConnectTo)[keyof typeof ConnectTo] | string;

// Options for personality settings
export const Personalities = {
  SHARE_LITTLE: 'share_little',
  SHARE_BIG: 'share_big',
  KEEP_TO_SELF: 'keep_to_self',
  SHARE_MORE: 'share_more',
  EMPTY: '',
} as const;
export type Personality = (typeof Personalities)[keyof typeof Personalities];

// Options for tone settings
export const Tones = {
  LIGHT_AND_CASUAL: 'light_and_casual',
  DEEP_AND_REFLECTIVE: 'deep_and_reflective',
  SURPRISE_ME: 'surprise_me',
} as const;
export type Tone = (typeof Tones)[keyof typeof Tones];

export interface NudgingSettings {
  occurrence: NudgingOccurrenceType;
  times_of_day: string[];
  days_of_week: DayOfWeek[];
}

export interface ProfileDoc {
  user_id: string;
  name: string;
  username: string;
  avatar: string;
  location: string;
  birthday: string;
  notification_settings: NotificationSetting[];
  nudging_settings: NudgingSettings;
  gender: string;
  group_ids: string[];
  summary: string;
  suggestions: string;
  last_update_id: string;
  updated_at: Timestamp;
  created_at: Timestamp;
  limit_override: boolean;
  timezone: string;
  goal: Goal;
  connect_to: ConnectToType;
  personality: Personality;
  tone: Tone;
  phone_number: string;
  friends_to_cleanup: string[];
  friend_count: number;
}

export const profileConverter: FirebaseFirestore.FirestoreDataConverter<ProfileDoc> = {
  toFirestore: (p: ProfileDoc) => p,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as ProfileDoc,
};

export const pf = <K extends keyof ProfileDoc>(k: K) => k;
