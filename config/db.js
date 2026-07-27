const mongoose = require('mongoose');
const { info, error } = require('../utils/logger');

const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/whatsapp_saas';
    
    mongoose.connection.on('error', (err) => {
      error('MongoDB runtime connection error:', { reason: err.message });
    });

    mongoose.connection.on('disconnected', () => {
      error('MongoDB disconnected! Attempting to reconnect...');
    });

    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    info('MongoDB connected successfully');
  } catch (err) {
    error('MongoDB initial connection failed', { reason: err.message });
    process.exit(1);
  }
};

module.exports = connectDB;
