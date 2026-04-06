const mongoose = require('mongoose');
const { info, error } = require('../utils/logger');

const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/whatsapp_saas';
    await mongoose.connect(uri);
    info('MongoDB connected');
  } catch (err) {
    error('MongoDB connection failed', { reason: err.message });
    process.exit(1);
  }
};

module.exports = connectDB;
