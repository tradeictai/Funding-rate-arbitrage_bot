import TPTracker from '../models/TPTracker.js';

/**
 * TP Tracker Service
 * Manages TP (Take Profit) values in MongoDB for frontend display
 * Used by separate API backend to show TP during pre-funding window
 */
class TPTrackerService {
  /**
   * Save or update TP for an opportunity
   * @param {Object} tpData - TP data to save
   * @returns {Promise<Object>} - Saved document
   */
  async saveTP(tpData) {
    try {
      const {
        token,
        deltaSymbol,
        coindcxSymbol,
        deltaTP,
        coindcxTP,
        deltaSide,
        coindcxSide,
        fundingDiff,
        spreadPercent,
        nextFundingTime,
        timeToFundingMs,
        status = 'active',
        rejectionReason = null
      } = tpData;

      // Calculate expiration time (30 minutes from now or funding time, whichever is sooner)
      const now = Date.now();
      const thirtyMinutesFromNow = now + (1 * 60 * 1000);
      const expiresAt = new Date(Math.min(thirtyMinutesFromNow, nextFundingTime));

      // Check if TP already exists for this token
      const existingTP = await TPTracker.findOne({
        token,
        status: 'active'
      });

      if (existingTP) {
        // Update existing TP
        existingTP.deltaTP = deltaTP;
        existingTP.coindcxTP = coindcxTP;
        existingTP.deltaSide = deltaSide;
        existingTP.coindcxSide = coindcxSide;
        existingTP.fundingDiff = fundingDiff;
        existingTP.spreadPercent = spreadPercent;
        existingTP.nextFundingTime = nextFundingTime;
        existingTP.timeToFundingMs = timeToFundingMs;
        existingTP.status = status;
        existingTP.rejectionReason = rejectionReason;
        existingTP.expiresAt = expiresAt;

        const updated = await existingTP.save();
        console.log(`✅ TP updated in MongoDB for ${token}`);
        return updated;
      }

      // Create new TP record
      const newTP = await TPTracker.create({
        token,
        deltaSymbol,
        coindcxSymbol,
        deltaTP,
        coindcxTP,
        deltaSide,
        coindcxSide,
        fundingDiff,
        spreadPercent,
        nextFundingTime,
        timeToFundingMs,
        status,
        rejectionReason,
        expiresAt
      });

      console.log(`✅ TP saved in MongoDB for ${token} (expires at ${expiresAt.toLocaleString()})`);
      return newTP;
    } catch (error) {
      console.error('❌ Error saving TP to MongoDB:', error.message);
      throw error;
    }
  }

  /**
   * Mark TP as executed when trade is placed
   * @param {string} token - Token symbol
   * @returns {Promise<Object>}
   */
  async markAsExecuted(token) {
    try {
      const updated = await TPTracker.findOneAndUpdate(
        { token, status: 'active' },
        {
          status: 'executed',
          // Keep it for 5 more minutes for reference, then auto-delete
          expiresAt: new Date(Date.now() + 5 * 60 * 1000)
        },
        { new: true }
      );

      if (updated) {
        console.log(`✅ TP marked as executed for ${token}`);
      }
      return updated;
    } catch (error) {
      console.error('❌ Error marking TP as executed:', error.message);
      throw error;
    }
  }

  /**
   * Mark TP as expired (optional - TTL index handles auto-deletion)
   * @param {string} token - Token symbol
   * @returns {Promise<Object>}
   */
  async markAsExpired(token) {
    try {
      const updated = await TPTracker.findOneAndUpdate(
        { token, status: 'active' },
        {
          status: 'expired',
          expiresAt: new Date() // Delete immediately
        },
        { new: true }
      );

      if (updated) {
        console.log(`✅ TP marked as expired for ${token}`);
      }
      return updated;
    } catch (error) {
      console.error('❌ Error marking TP as expired:', error.message);
      throw error;
    }
  }

  /**
   * Get active TP for a specific token
   * @param {string} token - Token symbol
   * @returns {Promise<Object|null>}
   */
  async getActiveTP(token) {
    try {
      return await TPTracker.findOne({ token, status: 'active' });
    } catch (error) {
      console.error('❌ Error fetching active TP:', error.message);
      throw error;
    }
  }

  /**
   * Get all active TPs
   * @returns {Promise<Array>}
   */
  async getAllActiveTPs() {
    try {
      return await TPTracker.find({ status: 'active' }).sort({ createdAt: -1 });
    } catch (error) {
      console.error('❌ Error fetching all active TPs:', error.message);
      throw error;
    }
  }

  /**
   * Delete TP for a token
   * @param {string} token - Token symbol
   * @returns {Promise<Object>}
   */
  async deleteTP(token) {
    try {
      const deleted = await TPTracker.findOneAndDelete({ token, status: 'active' });
      if (deleted) {
        console.log(`✅ TP deleted for ${token}`);
      }
      return deleted;
    } catch (error) {
      console.error('❌ Error deleting TP:', error.message);
      throw error;
    }
  }

  /**
   * Clean up expired TPs manually (TTL index also handles this)
   * @returns {Promise<Object>}
   */
  async cleanupExpiredTPs() {
    try {
      const result = await TPTracker.deleteMany({
        expiresAt: { $lt: new Date() }
      });
      console.log(`✅ Cleaned up ${result.deletedCount} expired TPs`);
      return result;
    } catch (error) {
      console.error('❌ Error cleaning up expired TPs:', error.message);
      throw error;
    }
  }
}

export default new TPTrackerService();
