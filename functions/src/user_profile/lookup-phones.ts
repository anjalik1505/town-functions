import { Request } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { ApiResponse, EventName, PhoneLookupEventParams } from '../models/analytics-events.js';
import { Collections, ProfileFields } from '../models/constants.js';
import { BaseUser, PhoneLookupPayload, PhoneLookupResponse } from '../models/data-models.js';

/**
 * Retrieves user info for provided phone numbers.
 */
export const lookupPhones = async (req: Request): Promise<ApiResponse<PhoneLookupResponse>> => {
  const { phones } = req.validated_params as PhoneLookupPayload;

  const db = getFirestore();
  const docRefs = phones.map((p) => db.collection(Collections.PHONES).doc(p));
  const snapshots = await db.getAll(...docRefs);

  const matches: BaseUser[] = [];
  snapshots.forEach((snap) => {
    if (!snap.exists) return;
    const data = snap.data() ?? {};
    matches.push({
      user_id: data[ProfileFields.USER_ID] as string,
      username: data[ProfileFields.USERNAME] as string,
      name: data[ProfileFields.NAME] as string,
      avatar: data[ProfileFields.AVATAR] as string,
    });
  });

  const analyticsParams: PhoneLookupEventParams = {
    requested_count: phones.length,
    match_count: matches.length,
  };

  const response: ApiResponse<PhoneLookupResponse> = {
    data: { matches },
    status: 200,
    analytics: {
      event: EventName.PHONES_LOOKED_UP,
      userId: req.userId,
      params: analyticsParams,
    },
  };

  return response;
};
