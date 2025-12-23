import { createClient } from 'redis';
import config from '../config/config.js';

/**
 * Redis Service for caching funding rate data
 */
class RedisService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.TTL_FUNDING_DATA = 300; // 5 minutes TTL for funding data
    this.TTL_OPPORTUNITIES = 60; // 1 minute TTL for opportunities
  }

  /**
   * Connect to Redis
   */
  async connect() {
    try {
      this.client = createClient({
        socket: {
          host: config.redis.host,
          port: config.redis.port
        },
        password: config.redis.password
      });

      this.client.on('error', (err) => {
        console.error('Redis Client Error:', err);
      });

      this.client.on('connect', () => {
        console.log('✅ Connected to Redis');
        this.isConnected = true;
      });

      this.client.on('disconnect', () => {
        console.log('❌ Disconnected from Redis');
        this.isConnected = false;
      });

      await this.client.connect();
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  /**
   * Store funding data for a symbol
   * @param {string} exchange - 'delta' or 'pi42'
   * @param {string} symbol - Symbol name
   * @param {Object} data - Funding data
   */
  async storeFundingData(exchange, symbol, data) {
    if (!this.isConnected) {
      console.warn('Redis not connected, skipping cache');
      return;
    }

    try {
      const key = `funding:${exchange}:${symbol}`;
      await this.client.setEx(
        key,
        this.TTL_FUNDING_DATA,
        JSON.stringify(data)
      );
    } catch (error) {
      console.error(`Error storing funding data for ${exchange}:${symbol}:`, error);
    }
  }

  /**
   * Get funding data for a symbol
   * @param {string} exchange - 'delta' or 'pi42'
   * @param {string} symbol - Symbol name
   * @returns {Object|null}
   */
  async getFundingData(exchange, symbol) {
    if (!this.isConnected) {
      return null;
    }

    try {
      const key = `funding:${exchange}:${symbol}`;
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error(`Error getting funding data for ${exchange}:${symbol}:`, error);
      return null;
    }
  }

  /**
   * Store arbitrage opportunity
   * @param {string} opportunityId - Unique ID for opportunity
   * @param {Object} data - Opportunity data
   */
  async storeOpportunity(opportunityId, data) {
    if (!this.isConnected) {
      console.warn('Redis not connected, skipping cache');
      return;
    }

    try {
      const key = `opportunity:${opportunityId}`;
      await this.client.setEx(
        key,
        this.TTL_OPPORTUNITIES,
        JSON.stringify(data)
      );

      // Also add to a sorted set ordered by profit percentage
      await this.client.zAdd('opportunities:active', {
        score: data.profitPct || 0,
        value: opportunityId
      });
    } catch (error) {
      console.error(`Error storing opportunity ${opportunityId}:`, error);
    }
  }

  /**
   * Get arbitrage opportunity
   * @param {string} opportunityId - Unique ID for opportunity
   * @returns {Object|null}
   */
  async getOpportunity(opportunityId) {
    if (!this.isConnected) {
      return null;
    }

    try {
      const key = `opportunity:${opportunityId}`;
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error(`Error getting opportunity ${opportunityId}:`, error);
      return null;
    }
  }

  /**
   * Get top opportunities sorted by profit percentage
   * @param {number} limit - Number of top opportunities to retrieve
   * @returns {Array<Object>}
   */
  async getTopOpportunities(limit = 10) {
    if (!this.isConnected) {
      return [];
    }

    try {
      // Get top opportunity IDs from sorted set (highest profit first)
      const opportunityIds = await this.client.zRange(
        'opportunities:active',
        0,
        limit - 1,
        { REV: true }
      );

      // Fetch full data for each opportunity
      const opportunities = [];
      for (const id of opportunityIds) {
        const data = await this.getOpportunity(id);
        if (data) {
          opportunities.push(data);
        }
      }

      return opportunities;
    } catch (error) {
      console.error('Error getting top opportunities:', error);
      return [];
    }
  }

  /**
   * Remove opportunity
   * @param {string} opportunityId - Unique ID for opportunity
   */
  async removeOpportunity(opportunityId) {
    if (!this.isConnected) {
      return;
    }

    try {
      const key = `opportunity:${opportunityId}`;
      await this.client.del(key);
      await this.client.zRem('opportunities:active', opportunityId);
    } catch (error) {
      console.error(`Error removing opportunity ${opportunityId}:`, error);
    }
  }

  /**
   * Clear all opportunities
   */
  async clearAllOpportunities() {
    if (!this.isConnected) {
      return;
    }

    try {
      await this.client.del('opportunities:active');
      const keys = await this.client.keys('opportunity:*');
      if (keys.length > 0) {
        await this.client.del(keys);
      }
    } catch (error) {
      console.error('Error clearing opportunities:', error);
    }
  }

  /**
   * Store last trade decision
   * @param {Object} decision - Trade decision data
   */
  async storeTradeDecision(decision) {
    if (!this.isConnected) {
      return;
    }

    try {
      await this.client.setEx(
        'trade:last_decision',
        3600, // 1 hour TTL
        JSON.stringify(decision)
      );
    } catch (error) {
      console.error('Error storing trade decision:', error);
    }
  }

  /**
   * Get last trade decision
   * @returns {Object|null}
   */
  async getLastTradeDecision() {
    if (!this.isConnected) {
      return null;
    }

    try {
      const data = await this.client.get('trade:last_decision');
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Error getting last trade decision:', error);
      return null;
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect() {
    if (this.client && this.isConnected) {
      try {
        await this.client.quit();
        this.isConnected = false;
        console.log('🔌 Disconnected from Redis');
      } catch (error) {
        // Ignore error if already closed
        if (error.message && !error.message.includes('closed')) {
          console.error('Error disconnecting from Redis:', error.message);
        }
        // Mark as disconnected regardless
        this.isConnected = false;
      }
    }
  }

  /**
   * Check if Redis is connected
   * @returns {boolean}
   */
  isActive() {
    return this.isConnected;
  }
}

export default new RedisService();
