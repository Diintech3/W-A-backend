const mongoose = require('mongoose');
const { info, error } = require('../utils/logger');

const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/whatsapp_saas';
    
    mongoose.connection.on('error', (err) => {
      error('MongoDB runtime connection error:', { reason: err.message });
    });

    mongoose.connection.on('disconnected', () => {
      // Log as info instead of error during idle socket rotation
      info('MongoDB connection rotating / reconnecting...');
    });

    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 20,
      minPoolSize: 2,
      maxIdleTimeMS: 60000,
      heartbeatFrequencyMS: 10000,
      retryWrites: true,
    });
    info('MongoDB connected successfully');
  } catch (err) {
    error('MongoDB initial connection failed', { reason: err.message });
    process.exit(1);
  }
};

module.exports = connectDB;
