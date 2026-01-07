import mongoose from 'mongoose';

/**
 * TP Tracker Schema
 * Stores Take Profit prices for opportunities during pre-funding window
 * Used by separate API backend to display TP on frontend
 */
const TPTrackerSchema = new mongoose.Schema({
  // Symbol information
  token: {
    type: String,
    required: true,
    index: true
  },
  deltaSymbol: {
    type: String,
    required: true
  },
  coindcxSymbol: {
    type: String,
    required: true
  },

  // TP values
  deltaTP: {
    type: Number,
    required: true
  },
  coindcxTP: {
    type: Number,
    required: true
  },

  // Trading sides
  deltaSide: {
    type: String,
    enum: ['buy', 'sell'],
    required: true
  },
  coindcxSide: {
    type: String,
    enum: ['buy', 'sell'],
    required: true
  },

  // Opportunity details
  fundingDiff: {
    type: Number,
    required: true
  },
  spreadPercent: {
    type: Number,
    required: false
  },

  // Timing
  nextFundingTime: {
    type: Date,
    required: true
  },
  timeToFundingMs: {
    type: Number,
    required: true
  },

  // Status tracking
  status: {
    type: String,
    enum: ['active', 'executed', 'expired', 'rejected'],
    default: 'active',
    index: true
  },

  // Rejection reason (if spread validation failed)
  rejectionReason: {
    type: String,
    required: false
  },

  // Auto-expire after 30 minutes
  expiresAt: {
    type: Date,
    required: true,
    index: true
  }
}, {
  timestamps: true // createdAt, updatedAt
});

// TTL Index: Auto-delete documents after expiresAt
TPTrackerSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Only one active TP per token at a time
TPTrackerSchema.index({ token: 1, status: 1 }, { unique: false });

const TPTracker = mongoose.model('TPTracker', TPTrackerSchema);

export default TPTracker;
