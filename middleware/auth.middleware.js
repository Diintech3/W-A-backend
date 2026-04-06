const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { fail } = require('../utils/apiResponse');

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return fail(res, 'Not authorized', 401);

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id)
      .select('-password')
      .select('-refreshToken')
      .select('-whatsappAccessToken');
    if (!user) return fail(res, 'User not found', 401);

    req.user = user;
    next();
  } catch {
    return fail(res, 'Not authorized', 401);
  }
};

module.exports = { protect };
