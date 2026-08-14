const clientScope = (req, res, next) => {
  req.targetUserId = req.user ? req.user._id : null;

  if (
    req.user &&
    (req.user.role === 'admin' || req.user.role === 'superadmin') &&
    req.headers['x-client-id']
  ) {
    req.targetUserId = req.headers['x-client-id'];
  }

  next();
};

module.exports = clientScope;
