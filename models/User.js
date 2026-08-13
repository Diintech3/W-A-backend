const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
    businessName: { type: String, default: '', trim: true },
    phone: { type: String, default: '' },
    whatsappPhoneNumberId: { type: String, default: '' },
    whatsappWabaId: { type: String, default: '' },
    whatsappAccessToken: { type: String, default: '', select: false },
    plan: {
      type: String,
      enum: ['free', 'starter', 'pro', 'enterprise'],
      default: 'free',
    },
    role: {
      type: String,
      enum: ['superadmin', 'admin', 'client'],
      default: 'client',
    },
    parentAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    adminLimits: {
      maxClients: { type: Number, default: 20 },
      maxMessages: { type: Number, default: 100000 },
    },
    isVerified: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['pending', 'active', 'rejected'],
      default: 'pending',
    },
    refreshToken: { type: String, default: '', select: false },
    apiSharing: {
      isEnabled: { type: Boolean, default: false },
      apiSharingKey: { type: String, default: '' },
      accessToken: { type: String, default: '' },
      referenceKey: { type: String, default: '' },
      generatedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
