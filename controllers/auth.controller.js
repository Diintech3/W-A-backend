const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { success, fail } = require('../utils/apiResponse');
const { sendWelcomeEmail } = require('../services/email.service');

const ACCESS_EXPIRES = '15m';
const REFRESH_EXPIRES = '7d';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function signAccess(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
}

function signRefresh(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
}

function setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    maxAge: COOKIE_MAX_AGE,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
}

function sanitizeUser(userDoc) {
  const u = userDoc.toObject ? userDoc.toObject() : { ...userDoc };
  delete u.password;
  delete u.refreshToken;
  delete u.whatsappAccessToken;
  return u;
}

exports.register = async (req, res) => {
  try {
    const { name, email, password, businessName, phone } = req.body;
    if (!name || !email || !password) {
      return fail(res, 'Name, email and password are required');
    }
    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return fail(res, 'Email already registered');

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password,
      businessName: businessName || '',
      phone: phone || '',
    });

    const accessToken = signAccess(user._id);
    const refreshToken = signRefresh(user._id);
    user.refreshToken = refreshToken;
    await user.save();

    setRefreshCookie(res, refreshToken);
    await sendWelcomeEmail(user.email, user.name).catch(() => {});

    return success(
      res,
      { user: sanitizeUser(user), accessToken },
      'Account created',
      201
    );
  } catch (e) {
    return fail(res, e.message || 'Registration failed', 500);
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return fail(res, 'Email and password required');

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return fail(res, 'Invalid credentials', 401);
    }

    const accessToken = signAccess(user._id);
    const refreshToken = signRefresh(user._id);
    user.refreshToken = refreshToken;
    await user.save();

    setRefreshCookie(res, refreshToken);

    return success(res, { user: sanitizeUser(user), accessToken }, 'Logged in');
  } catch (e) {
    return fail(res, e.message || 'Login failed', 500);
  }
};

exports.logout = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { refreshToken: '' });
    res.clearCookie('refreshToken', { path: '/' });
    return success(res, null, 'Logged out');
  } catch (e) {
    return fail(res, e.message || 'Logout failed', 500);
  }
};

exports.me = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    return success(res, { user: sanitizeUser(user) }, 'Profile');
  } catch (e) {
    return fail(res, e.message || 'Failed to load user', 500);
  }
};

exports.refresh = async (req, res) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) return fail(res, 'No refresh token', 401);

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    } catch {
      return fail(res, 'Invalid refresh token', 401);
    }

    const user = await User.findById(decoded.id).select('+refreshToken');
    if (!user || user.refreshToken !== token) {
      return fail(res, 'Session invalid', 401);
    }

    const accessToken = signAccess(user._id);
    return success(res, { accessToken }, 'Token refreshed');
  } catch (e) {
    return fail(res, e.message || 'Refresh failed', 500);
  }
};

exports.connectWhatsApp = async (req, res) => {
  try {
    const { whatsappPhoneNumberId, whatsappAccessToken } = req.body;
    if (!whatsappPhoneNumberId || !whatsappAccessToken) {
      return fail(res, 'Phone Number ID and Access Token are required');
    }
    await User.findByIdAndUpdate(req.user._id, {
      whatsappPhoneNumberId: String(whatsappPhoneNumberId).trim(),
      whatsappAccessToken: String(whatsappAccessToken).trim(),
    });
    const user = await User.findById(req.user._id);
    return success(res, { user: sanitizeUser(user) }, 'WhatsApp connected');
  } catch (e) {
    return fail(res, e.message || 'Failed to save connection', 500);
  }
};
