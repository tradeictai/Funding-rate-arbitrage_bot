/**
 * ConfigService
 * Manages configuration settings in MongoDB
 */

import { MongoClient } from "mongodb";
import { defaultConfigValues, validateConfig } from "../models/ConfigSettings.js";

class ConfigService {
  constructor() {
    this.client = null;
    this.db = null;
    this.configCollection = null;
    this.isConnected = false;
  }

  /**
   * Initialize MongoDB connection for config service
   */
  async initialize(mongoUri, dbName) {
    try {
      this.client = new MongoClient(mongoUri);
      await this.client.connect();
      this.db = this.client.db(dbName);
      this.configCollection = this.db.collection("config_settings");
      this.isConnected = true;

      console.log("[ConfigService] Connected to MongoDB");

      // Ensure default config exists
      await this.ensureDefaultConfig();

      return true;
    } catch (error) {
      console.error("[ConfigService] Failed to initialize:", error.message);
      throw error;
    }
  }

  /**
   * Ensure default config exists in database (seed on first run)
   */
  async ensureDefaultConfig() {
    try {
      const existing = await this.configCollection.findOne({ _id: "trading_config" });

      if (!existing) {
        console.log("[ConfigService] Creating default config...");
        await this.configCollection.insertOne(defaultConfigValues);
        console.log("[ConfigService] Default config created successfully");
      } else {
        console.log("[ConfigService] Config already exists");
      }
    } catch (error) {
      console.error("[ConfigService] Error ensuring default config:", error.message);
      throw error;
    }
  }

  /**
   * Get current config from database
   */
  async getConfig() {
    try {
      const config = await this.configCollection.findOne({ _id: "trading_config" });
      return config || defaultConfigValues;
    } catch (error) {
      console.error("[ConfigService] Error getting config:", error.message);
      // Return defaults if DB fails
      return defaultConfigValues;
    }
  }

  /**
   * Update config in database
   */
  async updateConfig(updates, updatedBy = "api") {
    try {
      // Validate updates
      const validation = validateConfig(updates);
      if (!validation.isValid) {
        return {
          success: false,
          errors: validation.errors,
        };
      }

      // Prepare update document
      const updateDoc = {
        $set: {
          ...updates,
          updatedAt: new Date(),
          updatedBy,
        },
      };

      // Update config
      const result = await this.configCollection.updateOne(
        { _id: "trading_config" },
        updateDoc,
        { upsert: true }
      );

      // Get updated config
      const updatedConfig = await this.getConfig();

      return {
        success: true,
        config: updatedConfig,
        modified: result.modifiedCount > 0,
      };
    } catch (error) {
      console.error("[ConfigService] Error updating config:", error.message);
      return {
        success: false,
        errors: [error.message],
      };
    }
  }

  /**
   * Reset config to defaults
   */
  async resetConfig() {
    try {
      await this.configCollection.replaceOne(
        { _id: "trading_config" },
        { ...defaultConfigValues, updatedAt: new Date(), updatedBy: "system" },
        { upsert: true }
      );

      return {
        success: true,
        config: defaultConfigValues,
      };
    } catch (error) {
      console.error("[ConfigService] Error resetting config:", error.message);
      return {
        success: false,
        errors: [error.message],
      };
    }
  }

  /**
   * Close MongoDB connection
   */
  async close() {
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
      console.log("[ConfigService] MongoDB connection closed");
    }
  }
}

// Export singleton instance
export default new ConfigService();
