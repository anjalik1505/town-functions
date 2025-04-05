import { RequestHandler } from "express";
import { z } from "zod";

export const validateRequest = <T extends z.ZodType>(schema: T): RequestHandler => {
    return (req, res, next) => {
        try {
            // Validate and attach validated data to request with proper typing
            req.validated_params = schema.parse(req.body) as z.infer<T>;
            next();
        } catch (error) {
            // Pass the error to the next error handler instead of handling it here
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
            // Pass the error to the next error handler instead of handling it here
            next(error);
        }
    };
};
