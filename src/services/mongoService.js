import { MongoClient } from 'mongodb';
import config from '../config/config.js';

/**
 * MongoDB Service for persisting arbitrage data
 */
class MongoService {
  constructor() {
    this.client = null;
    this.db = null;
    this.isConnected = false;

    // Collection names
    this.collections = {
      fundingRates: 'funding_rates',
      opportunities: 'opportunities',
      trades: 'trades',
      decisions: 'trade_decisions',
      exitResults: 'exit_results'
    };
  }

  /**
   * Connect to MongoDB
   */
  async connect() {
    try {
      this.client = new MongoClient(config.mongodb.uri, {
        maxPoolSize: 10,
        minPoolSize: 2
      });

      await this.client.connect();
      this.db = this.client.db(config.mongodb.dbName);
      this.isConnected = true;

      console.log('✅ Connected to MongoDB');

      // Create indexes for better query performance
      await this.createIndexes();
    } catch (error) {
      console.error('Failed to connect to MongoDB:', error);
      throw error;
    }
  }

  /**
   * Create indexes for collections
   */
  async createIndexes() {
    try {
      // Funding rates indexes
      await this.db.collection(this.collections.fundingRates).createIndexes([
        { key: { exchange: 1, symbol: 1, timestamp: -1 } },
        { key: { timestamp: -1 } },
        { key: { exchange: 1 } }
      ]);

      // Opportunities indexes
      await this.db.collection(this.collections.opportunities).createIndexes([
        { key: { timestamp: -1 } },
        { key: { profitPct: -1 } },
        { key: { token: 1, timestamp: -1 } }
      ]);

      // Trades indexes
      await this.db.collection(this.collections.trades).createIndexes([
        { key: { timestamp: -1 } },
        { key: { status: 1, timestamp: -1 } },
        { key: { token: 1, timestamp: -1 } }
      ]);

      // Trade decisions indexes
      await this.db.collection(this.collections.decisions).createIndexes([
        { key: { timestamp: -1 } },
        { key: { decision: 1, timestamp: -1 } },
        { key: { token: 1, timestamp: -1 } }
      ]);

      // Exit results indexes
      await this.db.collection(this.collections.exitResults).createIndexes([
        { key: { timestamp: -1 } },
        { key: { type: 1, timestamp: -1 } },
        { key: { success: 1, timestamp: -1 } }
      ]);

      console.log('📑 MongoDB indexes created successfully');
    } catch (error) {
      console.error('Error creating indexes:', error);
    }
  }

  /**
   * Store funding rate data
   * @param {string} exchange - 'delta' or 'pi42'
   * @param {string} symbol - Symbol name
   * @param {Object} data - Funding rate data
   */
  async storeFundingRate(exchange, symbol, data) {
    if (!this.isConnected) {
      console.warn('MongoDB not connected, skipping persistence');
      return;
    }

    try {
      const document = {
        exchange,
        symbol,
        fundingRate: data.fundingRate,
        nextFundingTime: data.nextFundingTime,
        remainingSeconds: data.remainingSeconds,
        markPrice: data.markPrice,
        lastPrice: data.lastPrice,
        volume: data.volume,
        timestamp: data.timestamp || Date.now()
      };

      await this.db.collection(this.collections.fundingRates).insertOne(document);
    } catch (error) {
      console.error(`Error storing funding rate for ${exchange}:${symbol}:`, error);
    }
  }

  /**
   * Store arbitrage opportunity
   * @param {Object} opportunity - Opportunity data
   */
  async storeOpportunity(opportunity) {
    if (!this.isConnected) {
      console.warn('MongoDB not connected, skipping persistence');
      return null;
    }

    try {
      const result = await this.db.collection(this.collections.opportunities).insertOne({
        ...opportunity,
        timestamp: opportunity.timestamp || Date.now()
      });

      return result.insertedId;
    } catch (error) {
      console.error('Error storing opportunity:', error);
      return null;
    }
  }

  /**
   * Store trade decision
   * @param {Object} decision - Trade decision data
   */
  async storeTradeDecision(decision) {
    if (!this.isConnected) {
      console.warn('MongoDB not connected, skipping persistence');
      return null;
    }

    try {
      const result = await this.db.collection(this.collections.decisions).insertOne({
        ...decision,
        timestamp: decision.timestamp || Date.now()
      });

      return result.insertedId;
    } catch (error) {
      console.error('Error storing trade decision:', error);
      return null;
    }
  } 



  /**
   * Store trade execution
   * @param {Object} trade - Trade data
   */
  async storeTrade(trade) {
    if (!this.isConnected) {
      console.warn('MongoDB not connected, skipping persistence');
      return null;
    }

    try {
      const result = await this.db.collection(this.collections.trades).insertOne({
        ...trade,
        timestamp: trade.timestamp || Date.now()
      });

      return result.insertedId;
    } catch (error) {
      console.error('Error storing trade:', error);
      return null;
    }
  }

  /**
   * Update trade status
   * @param {string} tradeId - Trade ID
   * @param {Object} updates - Fields to update
   */
  async updateTrade(tradeId, updates) {
    if (!this.isConnected) {
      return;
    }

    try {
      await this.db.collection(this.collections.trades).updateOne(
        { _id: tradeId },
        { $set: { ...updates, updatedAt: Date.now() } }
      );
    } catch (error) {
      console.error(`Error updating trade ${tradeId}:`, error);
    }
  }

  /**
   * Get recent opportunities
   * @param {number} limit - Number of opportunities to retrieve
   * @returns {Array<Object>}
   */
  async getRecentOpportunities(limit = 100) {
    if (!this.isConnected) {
      return [];
    }

    try {
      const opportunities = await this.db.collection(this.collections.opportunities)
        .find()
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();

      return opportunities;
    } catch (error) {
      console.error('Error getting recent opportunities:', error);
      return [];
    }
  }

  /**
   * Get recent trades
   * @param {number} limit - Number of trades to retrieve
   * @returns {Array<Object>}
   */
  async getRecentTrades(limit = 100) {
    if (!this.isConnected) {
      return [];
    }

    try {
      const trades = await this.db.collection(this.collections.trades)
        .find()
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();

      return trades;
    } catch (error) {
      console.error('Error getting recent trades:', error);
      return [];
    }
  }

  /**
   * Get funding rate history for a symbol
   * @param {string} exchange - 'delta' or 'pi42'
   * @param {string} symbol - Symbol name
   * @param {number} hoursBack - Number of hours to look back
   * @returns {Array<Object>}
   */
  async getFundingRateHistory(exchange, symbol, hoursBack = 24) {
    if (!this.isConnected) {
      return [];
    }

    try {
      const cutoffTime = Date.now() - (hoursBack * 60 * 60 * 1000);
      const history = await this.db.collection(this.collections.fundingRates)
        .find({
          exchange,
          symbol,
          timestamp: { $gte: cutoffTime }
        })
        .sort({ timestamp: 1 })
        .toArray();

      return history;
    } catch (error) {
      console.error(`Error getting funding rate history for ${exchange}:${symbol}:`, error);
      return [];
    }
  }

  /**
   * Store exit result (Phase 5)
   * @param {Object} exitResult - Exit result data
   * @returns {string|null} - Inserted ID
   */
  async storeExitResult(exitResult) {
    if (!this.isConnected) {
      console.warn('MongoDB not connected, skipping persistence');
      return null;
    }

    try {
      const result = await this.db.collection(this.collections.exitResults).insertOne({
        ...exitResult,
        timestamp: exitResult.timestamp || Date.now()
      });

      console.log(`✅ Exit result stored in MongoDB (${exitResult.type})`);
      return result.insertedId;
    } catch (error) {
      console.error('Error storing exit result:', error);
      return null;
    }
  }

  /**
   * Get recent exit results
   * @param {number} limit - Number of results to retrieve
   * @returns {Array<Object>}
   */
  async getRecentExitResults(limit = 100) {
    if (!this.isConnected) {
      return [];
    }

    try {
      const exitResults = await this.db.collection(this.collections.exitResults)
        .find()
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();

      return exitResults;
    } catch (error) {
      console.error('Error getting recent exit results:', error);
      return [];
    }
  }

  /**
   * Get statistics for opportunities
   * @param {number} daysBack - Number of days to look back
   * @returns {Object}
   */
  async getOpportunityStats(daysBack = 7) {
    if (!this.isConnected) {
      return null;
    }

    try {
      const cutoffTime = Date.now() - (daysBack * 24 * 60 * 60 * 1000);

      const stats = await this.db.collection(this.collections.opportunities).aggregate([
        { $match: { timestamp: { $gte: cutoffTime } } },
        {
          $group: {
            _id: null,
            totalOpportunities: { $sum: 1 },
            avgProfitPct: { $avg: '$profitPct' },
            maxProfitPct: { $max: '$profitPct' },
            minProfitPct: { $min: '$profitPct' }
          }
        }
      ]).toArray();

      return stats.length > 0 ? stats[0] : null;
    } catch (error) {
      console.error('Error getting opportunity stats:', error);
      return null;
    }
  }

  /**
   * Disconnect from MongoDB
   */
  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
      console.log('🔌 Disconnected from MongoDB');
    }
  }

  /**
   * Check if MongoDB is connected
   * @returns {boolean}
   */
  isActive() {
    return this.isConnected;
  }
}

export default new MongoService();
