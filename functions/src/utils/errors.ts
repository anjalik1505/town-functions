// Custom error classes for better error handling

// Firebase Auth Error type
export interface FirebaseAuthError extends Error {
  code?: string;
  message: string;
}

// Interface for errors that include an HTTP status code
export interface ErrorWithStatus {
  statusCode: number;
  name?: string;
  message?: string;
}

// Utility function to check if an error is a Firebase Auth token expiration error
export function isFirebaseAuthTokenExpiredError(error: unknown): error is FirebaseAuthError {
  return (
    error instanceof Error &&
    ((error as FirebaseAuthError).code?.includes('auth/id-token-expired') ||
      error.message.includes('auth/id-token-expired') ||
      error.message.includes('token is expired'))
  );
}

export class BadRequestError extends Error {
  statusCode: number;

  constructor(message: string) {
    super(message);
    this.name = 'Bad Request';
    this.statusCode = 400;
  }
}

export class UnauthorizedError extends Error {
  statusCode: number;

  constructor(message: string) {
    super(message);
    this.name = 'Unauthorized';
    this.statusCode = 401;
  }
}

export class ForbiddenError extends Error {
  statusCode: number;

  constructor(message: string) {
    super(message);
    this.name = 'Forbidden';
    this.statusCode = 403;
  }
}

export class NotFoundError extends Error {
  statusCode: number;

  constructor(message: string) {
    super(message);
    this.name = 'Not Found';
    this.statusCode = 404;
  }
}

export class ConflictError extends Error {
  statusCode: number;

  constructor(message: string) {
    super(message);
    this.name = 'Conflict';
    this.statusCode = 409;
  }
}

export class InternalServerError extends Error {
  statusCode: number;

  constructor(message: string = 'An unexpected error occurred') {
    super(message);
    this.name = 'Internal Server Error';
    this.statusCode = 500;
  }
}
