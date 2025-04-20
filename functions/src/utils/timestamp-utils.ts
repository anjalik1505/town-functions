import { formatInTimeZone } from "date-fns-tz";
import { Timestamp } from "firebase-admin/firestore";

/**
 * Formats a Firestore Timestamp to an ISO string in the same format as Python's datetime.isoformat()
 * This ensures consistent timestamp formatting between Python and TypeScript implementations.
 *
 * @param timestamp - The Firestore Timestamp to format
 * @returns A string in the format "YYYY-MM-DDTHH:mm:ss.ssssss+00:00"
 */
export const formatTimestamp = (timestamp: Timestamp): string => {
  const date = timestamp.toDate();
  return formatInTimeZone(date, "UTC", "yyyy-MM-dd'T'HH:mm:ss.SSSSSSxxx");
}; 