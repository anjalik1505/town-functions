import { RequestHandler } from "express";
import { z } from "zod";

export const validateRequest = <T extends z.ZodType>(schema: T): RequestHandler => {
    return (req, res, next) => {
        try {
            // Validate and attach validated data to request with proper typing
            req.validated_params = schema.parse(req.body) as z.infer<T>;
            next();
        } catch (error) {
            if (error instanceof z.ZodError) {
                res.status(400).json({
                    code: 400,
                    name: "Bad Request",
                    description: "Invalid request parameters"
                });
                return;
            }
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
            if (error instanceof z.ZodError) {
                res.status(400).json({
                    code: 400,
                    name: "Bad Request",
                    description: "Invalid query parameters"
                });
                return;
            }
            next(error);
        }
    };
};
