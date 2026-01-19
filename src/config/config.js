/**
 * Config Module
 * This module now exports the dynamic configuration loaded from MongoDB
 * For backward compatibility, it still provides the same interface
 *
 * IMPORTANT: The config is now loaded dynamically from MongoDB at startup
 * To update config values, use the REST API at http://localhost:5004/api/settings
 *
 * NOTE: We export a Proxy to ensure all config reads get the LATEST values
 * from runtimeConfig, even after DB updates. Without this, modules that
 * import config at startup would get stale values.
 */

import { getConfig } from "./configLoader.js";

// Export a Proxy that always returns the current config values
// This ensures that even after DB updates, all modules get fresh values
const configProxy = new Proxy({}, {
  get(target, prop) {
    const currentConfig = getConfig();
    return currentConfig[prop];
  },
  set(target, prop, value) {
    // Prevent direct modification - config should only be changed via API
    console.warn(`[Config] Direct modification of config.${prop} is not allowed. Use the API.`);
    return false;
  },
  ownKeys() {
    return Object.keys(getConfig());
  },
  getOwnPropertyDescriptor(target, prop) {
    const currentConfig = getConfig();
    if (prop in currentConfig) {
      return {
        enumerable: true,
        configurable: true,
        value: currentConfig[prop]
      };
    }
    return undefined;
  },
  has(target, prop) {
    return prop in getConfig();
  }
});

export default configProxy;
