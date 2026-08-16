/**
 * Wraps an async route handler so any thrown/rejected error is forwarded
 * to Express's error middleware instead of hanging the request.
 * Without this you'd need a try/catch in every single controller.
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
