const jwt = require('jsonwebtoken');

/**
 * Signs a JWT containing only the user id and role.
 * Deliberately minimal: a token is readable by anyone who holds it
 * (it is signed, not encrypted), so no email, phone or name goes in.
 */
function generateToken(user) {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not set. Check your .env file.');
  }
  return jwt.sign(
    { id: user._id.toString(), role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

module.exports = generateToken;
