import { fromZonedTime } from 'date-fns-tz';
import path from 'path';
import { fileURLToPath } from 'url';
import { DaysOfWeek } from '../models/firestore/index.js';
import { getLogger } from './logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Unified day mapping using DaysOfWeek enum
 */
const DAY_NUMBER_TO_ENUM = [
  DaysOfWeek.SUNDAY, // 0
  DaysOfWeek.MONDAY, // 1
  DaysOfWeek.TUESDAY, // 2
  DaysOfWeek.WEDNESDAY, // 3
  DaysOfWeek.THURSDAY, // 4
  DaysOfWeek.FRIDAY, // 5
  DaysOfWeek.SATURDAY, // 6
];

const DAY_ENUM_TO_NUMBER: Record<string, number> = {
  [DaysOfWeek.SUNDAY]: 0,
  [DaysOfWeek.MONDAY]: 1,
  [DaysOfWeek.TUESDAY]: 2,
  [DaysOfWeek.WEDNESDAY]: 3,
  [DaysOfWeek.THURSDAY]: 4,
  [DaysOfWeek.FRIDAY]: 5,
  [DaysOfWeek.SATURDAY]: 6,
};

/**
 * Converts day enum string to number (0=Sunday, 1=Monday, etc.)
 */
export function dayEnumToNumber(dayEnum: string): number {
  return DAY_ENUM_TO_NUMBER[dayEnum] ?? 0;
}

/**
 * Converts day number to enum string (0=sunday, 1=monday, etc.)
 */
export function dayNumberToEnum(dayNumber: number): string {
  return DAY_NUMBER_TO_ENUM[dayNumber] ?? DaysOfWeek.SUNDAY;
}

/**
 * Creates a time bucket identifier from day enum and hour
 */
export function createBucketIdentifier(dayEnum: string, hour: number): string {
  const hourString = hour.toString().padStart(2, '0');
  return `${dayEnum}_${hourString}:00`;
}

/**
 * Gets current time bucket for notification processing
 */
export function getCurrentTimeBucket(): string {
  const now = new Date();
  const dayIndex = now.getDay();
  const dayEnum = dayNumberToEnum(dayIndex);
  const hour = now.getHours();
  return createBucketIdentifier(dayEnum, hour);
}

/**
 * Calculates the UTC day and hour for a given local day and hour in a specific timezone.
 * Properly handles day boundary crossing when converting between timezones.
 *
 * @param timezone - The timezone in Region/City format (e.g., Asia/Dubai)
 * @param localDay - The day in user's local time (0=Sunday, 1=Monday, etc.)
 * @param localHour - The hour in user's local time (0-23)
 * @returns Object with utcDay and utcHour
 */
export function calculateUtcDayAndHour(
  timezone: string,
  localDay: number,
  localHour: number,
): { utcDay: number; utcHour: number } {
  try {
    // Create a date in a known week (2024-01-07 is a Sunday)
    const baseSunday = new Date('2024-01-07T00:00:00');
    const localDate = new Date(baseSunday);
    localDate.setDate(baseSunday.getDate() + localDay);
    localDate.setHours(localHour, 0, 0, 0);

    // Convert local time in timezone to UTC
    const utcDate = fromZonedTime(localDate, timezone);

    const utcDay = utcDate.getUTCDay();
    const utcHour = utcDate.getUTCHours();

    logger.info(`Timezone: ${timezone}, Local: Day ${localDay} Hour ${localHour}, UTC: Day ${utcDay} Hour ${utcHour}`);

    return { utcDay, utcHour };
  } catch (error) {
    logger.error(`Error calculating UTC day/hour for timezone ${timezone}:`, error);
    return { utcDay: localDay, utcHour: localHour };
  }
}
