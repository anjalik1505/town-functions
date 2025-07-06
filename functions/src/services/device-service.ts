import { DeviceDAO } from '../dao/device-dao.js';
import { ApiResponse, EventName } from '../models/analytics-events.js';
import { Device } from '../models/api-responses.js';
import { NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';

const logger = getLogger('device-service');

export class DeviceService {
  private deviceDAO: DeviceDAO;

  constructor() {
    this.deviceDAO = new DeviceDAO();
  }

  /**
   * Gets the device information for a user.
   *
   * @param userId - The user ID
   * @returns Device with formatted timestamp
   * @throws NotFoundError if device not found
   */
  async getDevice(userId: string): Promise<ApiResponse<Device>> {
    logger.info(`Getting device for user ${userId}`);

    const deviceDoc = await this.deviceDAO.get(userId);
    if (!deviceDoc) {
      logger.warn(`Device not found for user ${userId}`);
      throw new NotFoundError('Device not found');
    }

    logger.info(`Device retrieved for user ${userId}`);

    const device: Device = {
      device_id: deviceDoc.device_id,
      updated_at: formatTimestamp(deviceDoc.updated_at),
    };

    return {
      data: device,
      status: 200,
      analytics: {
        event: EventName.DEVICE_RETRIEVED,
        userId: userId,
        params: {},
      },
    };
  }

  /**
   * Updates the device information for a user.
   * Creates or updates the device with the specified device_id.
   *
   * @param userId - The user ID
   * @param deviceId - The device ID to set
   * @returns Device with formatted timestamp
   */
  async updateDevice(userId: string, deviceId: string): Promise<ApiResponse<Device>> {
    logger.info(`Updating device for user ${userId}`);

    const deviceDoc = await this.deviceDAO.upsert(userId, deviceId);

    logger.info(`Device updated for user ${userId}`);

    // Transform the returned DeviceDoc to Device response format
    const device: Device = {
      device_id: deviceDoc.device_id,
      updated_at: formatTimestamp(deviceDoc.updated_at),
    };

    return {
      data: device,
      status: 200,
      analytics: {
        event: EventName.DEVICE_UPDATED,
        userId: userId,
        params: {},
      },
    };
  }
}
