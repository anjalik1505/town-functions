// Custom error classes for better error handling

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