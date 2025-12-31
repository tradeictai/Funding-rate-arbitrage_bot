/**
 * Config Module
 * This module now exports the dynamic configuration loaded from MongoDB
 * For backward compatibility, it still provides the same interface
 *
 * IMPORTANT: The config is now loaded dynamically from MongoDB at startup
 * To update config values, use the REST API at http://localhost:5004/api/settings
 */

import { getConfig } from "./configLoader.js";

// Export the dynamic config getter as default
// This maintains backward compatibility with existing code
export default getConfig();
