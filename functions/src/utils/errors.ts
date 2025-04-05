// Custom error classes for better error handling

export class BadRequestError extends Error {
    statusCode: number;

    constructor(message: string) {
        super(message);
        this.name = 'BadRequestError';
        this.statusCode = 400;
    }
}

export class UnauthorizedError extends Error {
    statusCode: number;

    constructor(message: string) {
        super(message);
        this.name = 'UnauthorizedError';
        this.statusCode = 401;
    }
}

export class ForbiddenError extends Error {
    statusCode: number;

    constructor(message: string) {
        super(message);
        this.name = 'ForbiddenError';
        this.statusCode = 403;
    }
}

export class NotFoundError extends Error {
    statusCode: number;

    constructor(message: string) {
        super(message);
        this.name = 'NotFoundError';
        this.statusCode = 404;
    }
}

export class ConflictError extends Error {
    statusCode: number;

    constructor(message: string) {
        super(message);
        this.name = 'ConflictError';
        this.statusCode = 409;
    }
}

export class InternalServerError extends Error {
    statusCode: number;

    constructor(message: string = 'An unexpected error occurred') {
        super(message);
        this.name = 'InternalServerError';
        this.statusCode = 500;
    }
} 