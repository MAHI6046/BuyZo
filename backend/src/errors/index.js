class AppError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', details } = {}) {
    super(message || 'Internal server error');
    this.name = this.constructor.name;
    this.status = Number(status) || 500;
    this.code = String(code || 'INTERNAL_ERROR');
    if (details !== undefined) this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation failed', details) {
    super(message, { status: 400, code: 'VALIDATION_ERROR', details });
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', details) {
    super(message, { status: 401, code: 'UNAUTHORIZED', details });
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', details) {
    super(message, { status: 403, code: 'FORBIDDEN', details });
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Not found', details) {
    super(message, { status: 404, code: 'NOT_FOUND', details });
  }
}

class ConflictError extends AppError {
  constructor(message = 'Conflict', details) {
    super(message, { status: 409, code: 'CONFLICT', details });
  }
}

function isAppError(error) {
  return error instanceof AppError;
}

function toHttpErrorPayload(error, { exposeInternal = false } = {}) {
  if (isAppError(error)) {
    return {
      status: error.status,
      body: {
        ok: false,
        code: error.code,
        message: error.message,
        details: error.details,
      },
    };
  }

  if (error?.httpStatus) {
    return {
      status: Number(error.httpStatus) || 500,
      body: error.payload || {
        ok: false,
        message: error.message || 'Request failed',
      },
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: exposeInternal ? error?.message || 'Internal server error' : 'Internal server error',
    },
  };
}

module.exports = {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  isAppError,
  toHttpErrorPayload,
};
