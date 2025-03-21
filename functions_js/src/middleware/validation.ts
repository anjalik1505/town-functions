import { RequestHandler } from "express";
import { z } from "zod";
import { createProfileSchema, paginationSchema, updateProfileSchema } from "../models/validation-schemas";

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

// Export commonly used validation middleware
export const validateCreateProfile = validateRequest(createProfileSchema);
export const validateUpdateProfile = validateRequest(updateProfileSchema);
export const validatePagination = validateRequest(paginationSchema); 