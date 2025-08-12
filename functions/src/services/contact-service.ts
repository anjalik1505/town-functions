import path from 'path';
import { fileURLToPath } from 'url';
import { PhoneDAO } from '../dao/phone-dao.js';
import { ApiResponse, EventName } from '../models/analytics-events.js';
import { PhoneLookupResponse, PhoneUser } from '../models/api-responses.js';
import { getLogger } from '../utils/logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Service layer for contact-related operations
 * Handles contact-based user lookup functionality independently from profile management
 */
export class ContactService {
  private phoneDAO: PhoneDAO;

  constructor() {
    this.phoneDAO = new PhoneDAO();
  }

  /**
   * Looks up users by phone numbers
   *
   * This method searches for users associated with the provided phone numbers
   * and returns matching user profiles. It's designed to help users find and
   * connect with their contacts who are already using the platform.
   *
   * @param userId - The ID of the user performing the lookup
   * @param phones - Array of phone numbers to look up
   * @returns Promise<ApiResponse<PhoneLookupResponse>> - Contains matching user profiles
   *
   * @example
   * ```typescript
   * const result = await contactService.lookupByPhones(
   *   'user123',
   *   ['+1234567890', '+0987654321']
   * );
   * console.log(result.data.matches); // Array of BaseUser objects
   * ```
   */
  async lookupByPhones(userId: string, phones: string[]): Promise<ApiResponse<PhoneLookupResponse>> {
    logger.info(`Looking up phones`, { count: phones.length });

    const matches = await this.phoneDAO.getAll(phones);

    const users: PhoneUser[] = matches.map((match) => ({
      user_id: match.user_id,
      username: match.username,
      name: match.name,
      avatar: match.avatar,
      phone_number: match.id,
    }));

    logger.info(`Phone lookup completed`, { requested: phones.length, found: users.length });

    return {
      data: { matches: users } as PhoneLookupResponse,
      status: 200,
      analytics: {
        event: EventName.PHONES_LOOKED_UP,
        userId: userId,
        params: {
          requested_count: phones.length,
          match_count: users.length,
        },
      },
    };
  }
}
