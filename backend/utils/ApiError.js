/**
 * A small error class that carries an HTTP status code, so controllers can
 * do `throw new ApiError(404, 'Product not found')` and the error middleware
 * knows what to send back.
 */
class ApiError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ApiError;
