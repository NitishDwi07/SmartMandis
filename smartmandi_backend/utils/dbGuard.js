const mongoose = require('mongoose');

/**
 * mongoose readyState: 0 disconnected, 1 connected, 2 connecting, 3 disconnecting.
 */
function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

/**
 * 503 for "we cannot answer this right now".
 *
 * These endpoints used to swallow database errors and reply 200 with hardcoded
 * figures, which made an unreachable database indistinguishable from real data
 * on the dashboard. Callers must be able to tell the difference.
 */
function dbUnavailable(res, resource) {
  return res.status(503).json({
    success: false,
    error: 'Database unavailable',
    message: `Cannot serve ${resource}: the database is not reachable. Check MONGODB_URI and that MongoDB is running.`,
    resource
  });
}

/**
 * Single exit point for a failed read. Distinguishes "database is down" (503,
 * retryable) from "the query itself broke" (500, a bug).
 */
function handleDbError(res, error, resource) {
  console.error(`Error serving ${resource}:`, error);

  if (!isDbConnected()) {
    return dbUnavailable(res, resource);
  }

  return res.status(500).json({
    success: false,
    error: `Failed to fetch ${resource}`,
    message: error.message
  });
}

module.exports = { isDbConnected, dbUnavailable, handleDbError };
