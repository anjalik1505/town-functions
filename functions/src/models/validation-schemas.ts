import { isValid, parse } from 'date-fns';
import { getTimezoneOffset } from 'date-fns-tz';
import emojiRegex from 'emoji-regex';
import { z } from 'zod';
import { DaysOfWeek, NotificationSettings, NudgingOccurrence, Personalities, Tones } from './firestore/profile-doc.js';

// Nudging settings schema
export const nudgingSettingsSchema = z
  .object({
    occurrence: z.enum(Object.values(NudgingOccurrence) as [string, ...string[]]),
    times_of_day: z
      .array(z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Time must be in HH:MM format'))
      .optional(),
    days_of_week: z.array(z.enum(Object.values(DaysOfWeek) as [string, ...string[]])).optional(),
  })
  .refine(
    (data) => {
      // times_of_day can be used with daily, weekly, or few_days occurrence
      if (data.times_of_day && data.times_of_day.length > 0) {
        return (
          data.occurrence === NudgingOccurrence.DAILY ||
          data.occurrence === NudgingOccurrence.WEEKLY ||
          data.occurrence === NudgingOccurrence.FEW_DAYS
        );
      }
      return true;
    },
    {
      message: 'times_of_day can only be used with daily, weekly, or few_days occurrence',
      path: ['times_of_day'],
    },
  )
  .refine(
    (data) => {
      // days_of_week can only be together with weekly or few_days
      if (data.days_of_week && data.days_of_week.length > 0) {
        return data.occurrence === NudgingOccurrence.WEEKLY || data.occurrence === NudgingOccurrence.FEW_DAYS;
      }
      return true;
    },
    {
      message: 'days_of_week can only be used with weekly or few_days occurrence',
      path: ['days_of_week'],
    },
  )
  .refine(
    (data) => {
      // days_of_week can only be multiple days if occurrence is few_days
      if (data.days_of_week && data.days_of_week.length > 1) {
        return data.occurrence === NudgingOccurrence.FEW_DAYS;
      }
      return true;
    },
    {
      message: 'Multiple days_of_week can only be used with few_days occurrence',
      path: ['days_of_week'],
    },
  )
  .refine(
    (data) => {
      // times_of_day can only be more than one with occurrence daily
      if (data.times_of_day && data.times_of_day.length > 1) {
        return data.occurrence === NudgingOccurrence.DAILY;
      }
      return true;
    },
    {
      message: 'Multiple times_of_day can only be used with daily occurrence',
      path: ['times_of_day'],
    },
  )
  .transform((data) => {
    // Apply defaults based on occurrence
    const result = { ...data };

    if (data.occurrence === NudgingOccurrence.DAILY) {
      // Default time to 09:00 if not provided
      if (!result.times_of_day || result.times_of_day.length === 0) {
        result.times_of_day = ['09:00'];
      }
    } else if (data.occurrence === NudgingOccurrence.WEEKLY) {
      // Default time to 09:00 if not provided
      if (!result.times_of_day || result.times_of_day.length === 0) {
        result.times_of_day = ['09:00'];
      }
      // Default day to monday if not provided
      if (!result.days_of_week || result.days_of_week.length === 0) {
        result.days_of_week = [DaysOfWeek.MONDAY];
      }
    } else if (data.occurrence === NudgingOccurrence.FEW_DAYS) {
      // Default days to monday and thursday if not provided
      if (!result.days_of_week || result.days_of_week.length === 0) {
        result.days_of_week = [DaysOfWeek.MONDAY, DaysOfWeek.THURSDAY];
      }
    }

    return result;
  });

// Reusable schema for birthday validation
const birthdaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Birthday must be in yyyy-mm-dd format')
  .refine((val: string) => {
    // Use date-fns to parse and validate the date
    const parsedDate = parse(val, 'yyyy-MM-dd', new Date());
    return isValid(parsedDate);
  }, 'Birthday must be a valid date')
  .optional();

// Phone number schema (E.164 format)
const phoneSchema = z.string().regex(/^\+\d{10,15}$/, 'Phone number must be in E.164 format (e.g., +1234567890)');

// Profile schemas
export const createProfileSchema = z.object({
  username: z.string().min(1),
  name: z.string().optional(),
  avatar: z.string().optional(),
  birthday: birthdaySchema,
  notification_settings: z.array(z.enum(Object.values(NotificationSettings) as [string, ...string[]])).optional(),
  nudging_settings: nudgingSettingsSchema.optional(),
  gender: z.string().optional(),
  goal: z.string().optional(),
  connect_to: z.string().optional(),
  personality: z.enum(Object.values(Personalities) as [string, ...string[]]).optional(),
  tone: z.enum(Object.values(Tones) as [string, ...string[]]).optional(),
  phone_number: phoneSchema.optional(),
});

export const updateProfileSchema = z.object({
  username: z.string().min(1).optional(),
  name: z.string().optional(),
  avatar: z.string().optional(),
  birthday: birthdaySchema,
  notification_settings: z.array(z.enum(Object.values(NotificationSettings) as [string, ...string[]])).optional(),
  nudging_settings: nudgingSettingsSchema.optional(),
  gender: z.string().optional(),
  goal: z.string().optional(),
  connect_to: z.string().optional(),
  personality: z.enum(Object.values(Personalities) as [string, ...string[]]).optional(),
  tone: z.enum(Object.values(Tones) as [string, ...string[]]).optional(),
  phone_number: phoneSchema.optional(),
});

// Pagination schemas
export const paginationSchema = z.object({
  limit: z
    .string()
    .transform((val: string) => parseInt(val, 10))
    .pipe(z.number().min(1).max(100))
    .default('20'),
  after_cursor: z
    .string()
    .regex(/^[A-Za-z0-9+/=]+$/)
    .optional(),
});

export const deviceSchema = z.object({
  device_id: z.string().min(1, 'Device ID is required'),
});

export const createUpdateSchema = z.object({
  content: z.string().min(1, 'Content is required'),
  sentiment: z.string().min(1, 'Sentiment is required'),
  score: z.number().min(1).max(5, 'Score must be between 1 and 5'),
  emoji: z
    .string()
    .min(1, 'Sentiment emoji is required')
    .refine((val: string) => {
      const regex = emojiRegex();
      return regex.test(val);
    }, 'Must be a valid emoji'),
  group_ids: z.array(z.string()).optional(),
  friend_ids: z.array(z.string()).optional(),
  all_village: z.boolean().optional().default(false),
  images: z.array(z.string()).optional(),
});

export const createChatMessageSchema = z.object({
  text: z.string().min(1, 'Message text is required'),
  attachments: z.array(z.string()).optional(),
});

export const createGroupSchema = z.object({
  name: z.string().min(1, 'Group name is required'),
  icon: z.string().optional(),
  members: z.array(z.string()).min(1, 'At least one member is required'),
});

export const addGroupMembersSchema = z.object({
  members: z.array(z.string()).min(1, 'At least one member is required'),
});

export const ownProfileSchema = z.object({
  summary: z.string(),
  suggestions: z.string(),
  emotional_overview: z.string(),
  key_moments: z.string(),
  recurring_themes: z.string(),
  progress_and_growth: z.string(),
});

export const friendProfileSchema = z.object({
  summary: z.string(),
  suggestions: z.string(),
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
  gender: z.string().optional().default('they'),
  location: z.string().optional(),
  is_own_profile: z.boolean(),
  prompt: z.string(),
  temperature: z.number().optional(),
});

export const testNotificationSchema = z.object({
  title: z.string().min(1, 'Notification title is required'),
  body: z.string().min(1, 'Notification body is required'),
});

export const createCommentSchema = z.object({
  content: z.string().min(1).max(1000),
  parent_id: z.string().optional().nullable(),
});

export const updateCommentSchema = z.object({
  content: z.string().min(1).max(1000),
});

export const reactionSchema = z.object({
  type: z.string().min(1).max(50),
});

export const createFeedbackSchema = z.object({
  content: z.string().min(1, 'Feedback content is required'),
});

export const analyzeSentimentSchema = z.object({
  content: z.string().min(1, 'Content is required'),
});

export const transcribeAudioSchema = z.object({
  audio_data: z
    .string()
    .min(1, 'Audio data is required')
    .base64({ message: 'Audio data must be a valid base64 string' }),
});

// Timezone schema with validation using date-fns-tz
export const timezoneSchema = z.object({
  timezone: z
    .string()
    .min(1, 'Timezone is required')
    .refine(
      (tz) => {
        // For valid timezones, getTimezoneOffset returns a number that's not NaN
        // For invalid timezones like "New York", it returns NaN
        const offset = getTimezoneOffset(tz);

        // Special case: empty string returns 0, not NaN, but is invalid
        if (tz.trim() === '') return false;

        return !isNaN(offset);
      },
      {
        message: 'Invalid timezone. Must be a valid IANA timezone identifier (e.g., America/New_York)',
      },
    ),
});

// Location schema with City, Country format validation using country-state-city
export const locationSchema = z.object({
  location: z
    .string()
    .min(1, 'Location is required')
    .regex(/^[A-Za-z\s]+,\s*[A-Za-z\s]+$/, 'Location must be in the format "City, Country"'),
  // .refine(
  //   (loc) => {
  //     try {
  //       const parts = loc.split(',').map((part) => part.trim());
  //       if (parts.length !== 2) return false;

  //       // Since we've checked parts.length === 2, these values will exist
  //       const cityName = parts[0]!;
  //       const countryName = parts[1]!;

  //       // Validate country exists
  //       const country = Country.getAllCountries().find(
  //         (c) => c.name.toLowerCase() === countryName.toLowerCase(),
  //       );
  //       if (!country) return false;

  //       // Get cities for this country
  //       const cities = City.getCitiesOfCountry(country.isoCode) || [];

  //       // Check if city exists in this country (case insensitive)
  //       return cities.some(
  //         (city) => city.name.toLowerCase() === cityName.toLowerCase(),
  //       );
  //     } catch {
  //       return false;
  //     }
  //   },
  //   {
  //     message: 'Invalid location. Must use a valid country name with a city',
  //   },
  // ),
});

export const shareUpdateSchema = z
  .object({
    friend_ids: z.array(z.string()).optional(),
    group_ids: z.array(z.string()).optional(),
  })
  .refine((data) => (data.friend_ids && data.friend_ids.length > 0) || (data.group_ids && data.group_ids.length > 0), {
    message: 'At least one friend ID or group ID is required',
  });

// Lookup phones request schema
export const phoneLookupSchema = z.object({
  phones: z
    .array(phoneSchema)
    .min(1, 'At least one phone number is required')
    .max(500, 'Maximum 500 phone numbers allowed'),
});
