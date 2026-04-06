const success = (res, data, message = 'Success', code = 200) => {
  return res.status(code).json({ success: true, data, message });
};

const fail = (res, message, code = 400) => {
  return res.status(code).json({ success: false, message });
};

module.exports = { success, fail };
