import { differenceInYears, parse } from 'date-fns';

/**
 * Calculates a person's age based on their birthday string in yyyy-mm-dd format
 * @param birthdayString The birthday string in yyyy-mm-dd format (already validated)
 * @returns The calculated age as a string, or "unknown" if the birthday string is empty
 */
export const calculateAge = (birthdayString: string): string => {
  // Return "unknown" if the birthday string is empty
  if (!birthdayString) {
    return 'unknown';
  }

  // Parse the birthday string into a Date object using date-fns
  const birthday = parse(birthdayString, 'yyyy-MM-dd', new Date());

  // Calculate age using date-fns differenceInYears function
  const age = differenceInYears(new Date(), birthday);

  return age.toString();
};

/**
 * Creates a consistent summary ID by sorting user IDs.
 * This ensures that the same summary ID is generated regardless of which user is first.
 *
 * @param userId1 - First user ID
 * @param userId2 - Second user ID
 * @returns A consistent summary ID in the format "user1_user2" where user1 and user2 are concatenated
 */
export const createSummaryId = (userId1: string, userId2: string): string => {
  return `${userId1}_${userId2}`;
};
