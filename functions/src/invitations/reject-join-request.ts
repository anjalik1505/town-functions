import { Request } from 'express';
import { Timestamp } from 'firebase-admin/firestore';
import { ApiResponse, EventName, InviteEventParams } from '../models/analytics-events.js';
import { JoinRequest } from '../models/data-models.js';
import { JoinRequestFields, Status } from '../models/constants.js';
import { BadRequestError } from '../utils/errors.js';
import { hasReachedCombinedLimit } from '../utils/friendship-utils.js';
import { formatJoinRequest, getJoinRequestDoc, validateJoinRequestOwnership } from '../utils/invitation-utils.js';
import { getLogger } from '../utils/logging-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Rejects a join request by setting its status to rejected.
 *
 * This function:
 * 1. Validates the join request exists and the current user is the invitation owner
 * 2. Updates the join request status to rejected
 * 3. Returns the updated join request data
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: Request parameters containing:
 *                - requester_id: The ID of the user who requested to join
 *
 * @returns An ApiResponse containing the updated join request and analytics
 *
 * @throws 400: Join request is already accepted/rejected
 * @throws 403: You are not authorized to reject this join request
 * @throws 404: Join request not found
 * @throws 404: Invitation not found
 */
export const rejectJoinRequest = async (req: Request): Promise<ApiResponse<JoinRequest>> => {
  // Get validated params
  const currentUserId = req.userId;
  const requestId = req.params.requester_id as string;

  logger.info(`User ${currentUserId} rejecting join request ${requestId}`);

  // Get the join request from the subcollection
  const { ref: requestRef, data: requestData } = await getJoinRequestDoc(currentUserId, requestId);
  const requesterId = requestData[JoinRequestFields.REQUESTER_ID] as string;
  const currentStatus = requestData[JoinRequestFields.STATUS] as string;

  // Validate that the current user is the invitation owner
  validateJoinRequestOwnership(requesterId, currentUserId);

  // Check if the request is already accepted or rejected
  if (currentStatus !== Status.PENDING) {
    logger.warn(`Join request from ${requesterId} is already ${currentStatus}`);
    throw new BadRequestError(`Join request is already ${currentStatus}`);
  }

  // Update the join request status to rejected
  const currentTime = Timestamp.now();
  await requestRef.update({
    [JoinRequestFields.STATUS]: Status.REJECTED,
    [JoinRequestFields.UPDATED_AT]: currentTime,
  });

  logger.info(`Rejected join request from ${requesterId}`);

  // Get current friend count for analytics
  const { friendCount } = await hasReachedCombinedLimit(currentUserId);

  // Create analytics event
  const event: InviteEventParams = {
    friend_count: friendCount,
  };

  // Return the updated join request
  return {
    data: formatJoinRequest(requestRef.id, {
      ...requestData,
      [JoinRequestFields.STATUS]: Status.REJECTED,
      [JoinRequestFields.UPDATED_AT]: currentTime,
    }),
    status: 200,
    analytics: {
      event: EventName.JOIN_REJECTED,
      userId: currentUserId,
      params: event,
    },
  };
};
