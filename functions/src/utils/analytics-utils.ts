import axios, { AxiosInstance } from 'axios';
import { BaseEventParams, EventName } from '../models/analytics-events';
import { getLogger } from './logging-utils';

const logger = getLogger(__filename);

// Configuration
const CONFIG = {
  maxEventsPerBatch: 25,
  maxPayloadSize: 16 * 1024, // 16KB in bytes
  serverClientId: 'server',
  endpoint: 'https://www.google-analytics.com/mp/collect',
  defaultRetries: 3,
  defaultTimeout: 5000,
  maxRetryDelay: 10000,
  minRetryDelay: 1000,
} as const;

// Interfaces
interface GA4Event {
  name: EventName;
  params?: BaseEventParams;
}

interface GA4Payload {
  client_id: string;
  user_id: string;
  events: GA4Event[];
}

interface AnalyticsClientConfig {
  maxRetries: number;
  timeout: number;
}

/**
 * GA4 Measurement Protocol client for server-side analytics
 */
export class GA4MeasurementClient {
  private static instance: GA4MeasurementClient | null = null;
  private readonly axiosInstance: AxiosInstance;
  private readonly maxRetries: number;
  private readonly timeout: number;

  private constructor(config: AnalyticsClientConfig) {
    this.maxRetries = config.maxRetries;
    this.timeout = config.timeout;

    logger.info('Initializing GA4 client', {
      maxRetries: this.maxRetries,
      timeout: this.timeout,
    });

    // Create and configure axios instance
    this.axiosInstance = axios.create({
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
      },
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 300,
    });
  }

  public static getInstance(
    config: AnalyticsClientConfig = {
      maxRetries: CONFIG.defaultRetries,
      timeout: CONFIG.defaultTimeout,
    },
  ): GA4MeasurementClient {
    if (!GA4MeasurementClient.instance) {
      GA4MeasurementClient.instance = new GA4MeasurementClient(config);
    }
    return GA4MeasurementClient.instance;
  }

  async sendEvents(events: GA4Event[], userId: string): Promise<void> {
    if (!events?.length) {
      logger.warn('No events to send');
      return;
    }

    if (
      !process.env.GA4_MEASUREMENT_ID ||
      !process.env.GA4_API_SECRET ||
      !process.env.GA4_SERVER_CLIENT_ID
    ) {
      logger.warn('Missing GA4 credentials');
      return;
    }

    logger.info('Sending analytics events', {
      eventCount: events.length,
      userId,
      events: events.map((e) => e.name),
    });

    try {
      // Extend each event's params with engagement_time_msec
      const eventsWithEngagement: GA4Event[] = events.map((event) => ({
        ...event,
        params: { ...event.params, engagement_time_msec: 1 },
      }));
      const batches = this.createBatches(eventsWithEngagement);
      logger.info('Created event batches', {
        batchCount: batches.length,
        totalEvents: eventsWithEngagement.length,
      });

      for (const batch of batches) {
        // Build the payload with the persistent server-side client_id
        const payload: GA4Payload = {
          client_id: process.env.GA4_SERVER_CLIENT_ID!,
          user_id: userId,
          events: batch,
        };

        await this.sendWithRetries(payload);
        logger.info('Successfully sent batch', {
          batchSize: batch.length,
          events: batch.map((e) => e.name),
        });
      }

      logger.info('Successfully sent all events', {
        totalEvents: eventsWithEngagement.length,
        userId,
      });
    } catch (error) {
      logger.error('Failed to send analytics events', error);
    }
  }

  private createBatches(events: GA4Event[]): GA4Event[][] {
    // Optimize for single event
    if (events.length === 1) {
      return [events];
    }

    const batches: GA4Event[][] = [];
    let currentBatch: GA4Event[] = [];
    let currentSize = 0;

    // Pre-calculate event sizes
    const eventSizes = events.map(
      (event) => new TextEncoder().encode(JSON.stringify(event)).length,
    );

    for (let i = 0; i < events.length; i++) {
      const eventSize = eventSizes[i];

      if (
        currentSize + eventSize > CONFIG.maxPayloadSize ||
        currentBatch.length >= CONFIG.maxEventsPerBatch
      ) {
        if (currentBatch.length > 0) {
          batches.push(currentBatch);
          logger.debug('Created new batch', {
            batchSize: currentBatch.length,
            currentSize,
          });
        }
        currentBatch = [];
        currentSize = 0;
      }

      currentBatch.push(events[i]);
      currentSize += eventSize;
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
      logger.debug('Created final batch', {
        batchSize: currentBatch.length,
        currentSize,
      });
    }

    return batches;
  }

  private async sendWithRetries(payload: GA4Payload): Promise<void> {
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < this.maxRetries) {
      try {
        if (attempt > 0) {
          const backoffMs = Math.min(
            CONFIG.minRetryDelay * Math.pow(2, attempt) + Math.random() * 1000,
            CONFIG.maxRetryDelay,
          );
          logger.info('Retrying analytics request', {
            attempt,
            backoffMs,
            events: payload.events.map((e) => e.name),
          });
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }

        await this.sendRequest(payload);
        logger.info('Successfully sent request', {
          attempt: attempt + 1,
          events: payload.events.map((e) => e.name),
        });
        return;
      } catch (error) {
        lastError = error as Error;
        logger.warn('Analytics request failed, will retry', {
          attempt: attempt + 1,
          maxRetries: this.maxRetries,
          events: payload.events.map((e) => e.name),
        });
        attempt++;
      }
    }

    logger.error('Max retries exceeded', {
      error: lastError,
      events: payload.events.map((e) => e.name),
    });
  }

  private async sendRequest(payload: GA4Payload): Promise<void> {
    const url = `${CONFIG.endpoint}?measurement_id=${process.env.GA4_MEASUREMENT_ID}&api_secret=${process.env.GA4_API_SECRET}`;

    logger.debug('Sending request to GA4', {
      url: url.replace(process.env.GA4_API_SECRET || '', '[REDACTED]'),
      eventCount: payload.events.length,
    });

    const response = await this.axiosInstance.post(url, payload);
    logger.info('Received response from GA4', {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data: response.data,
    });
  }
}

export function trackApiEvent(
  eventName: EventName,
  userId: string,
  params: BaseEventParams = {},
): void {
  try {
    logger.info('Tracking API event', {
      eventName,
      userId,
      params,
    });

    const analytics = GA4MeasurementClient.getInstance();
    analytics
      .sendEvents([{ name: eventName, params }], userId)
      .catch((error) => {
        logger.error('Failed to send API event', error);
      });
  } catch (error) {
    logger.error('Error in trackApiEvent', error);
  }
}

export function trackApiEvents(
  events: { eventName: EventName; params: BaseEventParams }[],
  userId: string,
): void {
  try {
    logger.info('Tracking multiple API events', {
      eventCount: events.length,
      userId,
      events: events.map((e) => e.eventName),
    });

    const analytics = GA4MeasurementClient.getInstance();
    analytics
      .sendEvents(
        events.map(({ eventName, params }) => ({ name: eventName, params })),
        userId,
      )
      .catch((error) => {
        logger.error('Failed to send API events', error);
      });
  } catch (error) {
    logger.error('Error in trackApiEvents', error);
  }
}
