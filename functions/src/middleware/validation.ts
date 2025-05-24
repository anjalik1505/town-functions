import { RequestHandler } from 'express';
import { z } from 'zod';
import { getLogger } from '../utils/logging-utils.js';

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

export const validateRequest = <T extends z.ZodType>(schema: T): RequestHandler => {
  return (req, res, next) => {
    try {
      // Validate and attach validated data to request with proper typing
      req.validated_params = schema.parse(req.body) as z.infer<T>;
      next();
    } catch (error) {
      // Log the input data that caused the validation error
      logger.error(`Validation error for request body:`, {
        body: req.body,
        error: error,
      });
      // Pass the error to the next error handler
      next(error);
    }
  };
};

export const validateQueryParams = <T extends z.ZodType>(schema: T): RequestHandler => {
  return (req, res, next) => {
    try {
      // Validate and attach validated data to request with proper typing
      req.validated_params = schema.parse(req.query) as z.infer<T>;
      next();
    } catch (error) {
      // Log the input data that caused the validation error
      logger.error(`Validation error for query params:`, {
        query: req.query,
        error: error,
      });
      // Pass the error to the next error handler
      next(error);
    }
  };
};
