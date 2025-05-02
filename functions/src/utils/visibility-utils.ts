/**
 * Constants and utilities for handling visibility identifiers in updates
 */

export const VisibilityTypes = {
  FRIEND: 'friend',
  GROUP: 'group',
} as const;

export type VisibilityType =
  (typeof VisibilityTypes)[keyof typeof VisibilityTypes];

/**
 * Creates a visibility identifier string in the format "type:id"
 * @param type The type of visibility (friend or group)
 * @param id The ID of the friend or group
 * @returns A formatted visibility identifier string
 */
export function createVisibilityIdentifier(
  type: VisibilityType,
  id: string,
): string {
  return `${type}:${id}`;
}

/**
 * Creates a friend visibility identifier
 * @param friendId The ID of the friend
 * @returns A formatted friend visibility identifier
 */
export function createFriendVisibilityIdentifier(friendId: string): string {
  return createVisibilityIdentifier(VisibilityTypes.FRIEND, friendId);
}

/**
 * Creates a group visibility identifier
 * @param groupId The ID of the group
 * @returns A formatted group visibility identifier
 */
export function createGroupVisibilityIdentifier(groupId: string): string {
  return createVisibilityIdentifier(VisibilityTypes.GROUP, groupId);
}

/**
 * Creates visibility identifiers for a list of friends
 * @param friendIds Array of friend IDs
 * @returns Array of friend visibility identifiers
 */
export function createFriendVisibilityIdentifiers(
  friendIds: string[],
): string[] {
  return friendIds.map(createFriendVisibilityIdentifier);
}

/**
 * Creates visibility identifiers for a list of groups
 * @param groupIds Array of group IDs
 * @returns Array of group visibility identifiers
 */
export function createGroupVisibilityIdentifiers(groupIds: string[]): string[] {
  return groupIds.map(createGroupVisibilityIdentifier);
}
