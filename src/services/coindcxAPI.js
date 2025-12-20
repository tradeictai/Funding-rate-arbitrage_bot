import crypto from 'crypto';
import config from '../config/config.js';
import axios from 'axios';

/**
 * CoinDCX Futures REST API Client
 * Based on CoinDCX Futures API documentation
 * - Authentication: HMAC-SHA256 on compact JSON body (no spaces)
 * - Balance: via /exchange/v1/derivatives/futures/wallets (or wallet_details)
 * - Orderbook: public endpoint (no auth needed)
 * - Other endpoints adapted for futures where possible
 */
class CoinDCXAPI {
  constructor() {
    this.baseUrl = 'https://api.coindcx.com';
    this.publicUrl = 'https://public.coindcx.com';
    this.apiKey = config.orderPlace.coindcx.apiKey;
    this.apiSecret = config.orderPlace.coindcx.apiSecret;

    // If you have separate trade keys, add them here
    this.apiKeyTrade =config.orderPlace.coindcx.apiKey;
    this.apiSecretTrade = config.orderPlace.coindcx.apiSecret;
  }

  /**
   * Generate compact JSON payload and signature
   * @param {Object} body - Request body
   * @returns {{payload: string, signature: string}}
   */
    generateAuth(body, useBufferFormat = false) {
    const timestamp = Math.floor(Date.now()); // Milliseconds
    const fullBody = { ...body, timestamp };

    let payload;
    if (useBufferFormat) {
      // For futures wallet endpoint: Buffer.from(JSON.stringify(body)).toString()
      // This is the EXACT format CoinDCX requires for futures wallet endpoint
      payload = Buffer.from(JSON.stringify(fullBody)).toString();
    } else {
      // For other endpoints: compact JSON format
      payload = JSON.stringify(fullBody, null, 0)
        .replace(/":/g, '":')
        .replace(/,"/g, ',"');
    }

    const signature = crypto
      .createHmac("sha256", this.apiSecret)
      .update(payload)
      .digest("hex");

    return { payload, signature, fullBody };
  }

  /**
   * Make authenticated request (for private endpoints)
   * @param {string} method - 'GET' or 'POST'
   * @param {string} endpoint - API endpoint path
   * @param {Object} params - Request parameters
   * @param {boolean} useTradeCreds - Use trade credentials
   * @param {boolean} useBufferFormat - Use Buffer format for signature (for futures wallet)
   * @returns {Promise<Object>}
   */
  async privateRequest(
    method,
    endpoint,
    params = {},
    useTradeCreds = false,
    useBufferFormat = false
  ) {
    const apiSecret = useTradeCreds ? this.apiSecretTrade : this.apiSecret;
    const apiKey = useTradeCreds ? this.apiKeyTrade : this.apiKey;

    // Temporarily set apiSecret for generateAuth
    const originalSecret = this.apiSecret;
    this.apiSecret = apiSecret;

    const { payload, signature, fullBody } = this.generateAuth(
      params,
      useBufferFormat
    );

    // Restore original secret
    this.apiSecret = originalSecret;

    const headers = {
      "Content-Type": "application/json",
      "X-AUTH-APIKEY": apiKey,
      "X-AUTH-SIGNATURE": signature,
    };

    const url = `${this.baseUrl}${endpoint}`;

    console.log(`📤 CoinDCX ${method} ${endpoint}`);
    console.log("Payload:", payload);
    console.log("Signature:", signature.substring(0, 16) + "...");

    let response;
    let data;

    try {
      if (method === "GET") {
        // For GET requests with body (like futures wallet endpoint), use axios
        // fetch() doesn't support GET requests with a body
        const axiosResponse = await axios({
          method: "GET",
          url: url,
          headers: headers,
          data: fullBody, // Body for GET request (axios supports this, fetch doesn't)
          validateStatus: () => true, // Don't throw on error status codes
        });

        response = {
          status: axiosResponse.status,
          ok: axiosResponse.status >= 200 && axiosResponse.status < 300,
        };
        data = axiosResponse.data;
      } else {
        // For POST requests, use fetch
        const fetchResponse = await fetch(url, {
          method,
          headers,
          body: payload,
        });

        const text = await fetchResponse.text();
        response = {
          status: fetchResponse.status,
          ok: fetchResponse.ok,
        };

        try {
          data = JSON.parse(text);
        } catch (e) {
          throw new Error(`Invalid JSON response: ${text.substring(0, 500)}`);
        }
      }

      if (!response.ok) {
        const msg = data?.message || data?.msg || JSON.stringify(data);
        throw new Error(`CoinDCX API Error (${response.status}): ${msg}`);
      }

      return data;
    } catch (error) {
      if (error.message.includes("CoinDCX API Error")) {
        throw error;
      }
      throw new Error(`Request failed: ${error.message}`);
    }
  }

  /**
   * Make public request (no auth)
   * @param {string} endpoint
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async publicRequest(endpoint, params = {}) {
    let url = `${this.publicUrl}${endpoint}`;
    if (Object.keys(params).length) {
      const query = new URLSearchParams(params).toString();
      url += `?${query}`;
    }

    const response = await fetch(url);
    // console.log("Response, ", response)
    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(`Invalid JSON: ${text.substring(0, 500)}`);
    }

    if (!response.ok) {
      throw new Error(`Public API Error (${response.status}): ${text}`);
    }

    return data;
  }
  /**
   * Get Futures Wallet Balance (USDT or INR margined)
   * Endpoint: GET /exchange/v1/derivatives/futures/wallets
   * IMPORTANT: This endpoint requires:
   * - Method: GET (with body)
   * - Signature format: Buffer.from(JSON.stringify(body)).toString()
   * - Use axios (fetch doesn't support GET with body)
   * @returns {Promise<Array>}
   */
  async getFuturesWallet() {
    try {
      // Use GET method, empty params, and Buffer format for signature
      const data = await this.privateRequest(
        "GET",
        "/exchange/v1/derivatives/futures/wallets",
        {}, // Empty params, timestamp will be added automatically
        false, // useTradeCreds
        true // useBufferFormat = true (required for futures wallet!)
      );

      console.log("✅ CoinDCX Futures Wallet:", data);
      return data;
    } catch (error) {
      console.error("❌ Error fetching CoinDCX futures wallet:", error.message);
      throw error; // Re-throw to let caller handle
    }
  }

  /**
   * Get account balance (futures wallet)
   */
  async getAccountBalance() {
    return await this.getFuturesWallet();
  }

  /**
   * Get asset balance (mainly USDT for futures)
   */
  async getAssetBalance(asset = 'USDT') {
    const wallet = await this.getFuturesWallet();
    // Assuming wallet returns array or object with balance
    const bal = wallet[1].balance || 0;
    return parseFloat(bal);
  }

  /**
   * Get Orderbook (public - no auth needed)
   * @param {string} pair - e.g., 'B-BTC_USDT'
   * @returns {Promise<Object>}
   */
async getOrderbook(pair, limit = 20) {
    try {
      const data = await this.publicRequest(`/market_data/v3/orderbook/${pair}-futures/${limit}`);
    //   console.log('✅ CoinDCX Orderbook fetched:', pair);
    //   console.log("Data", data)
      return {
        bids: Object.entries(data.bids || {})
          .map(([p, q]) => [parseFloat(p), parseFloat(q)])
          .sort((a, b) => b[0] - a[0]) // Highest bid first
          .slice(0, limit),
        asks: Object.entries(data.asks || {})
          .map(([p, q]) => [parseFloat(p), parseFloat(q)])
          .sort((a, b) => a[0] - b[0]) // Lowest ask first
          .slice(0, limit),
        timestamp: data.timestamp || Date.now()
      };
    } catch (error) {
      console.error(`Error fetching orderbook for ${pair}:`, error.message);
      return {
        bids: [],
        asks: [],
        timestamp: Date.now()
      };
    }
  }

  /**
   * Get active positions
   */
  async getPositions() {
    try {
      const data = await this.privateRequest('POST', '/exchange/v1/derivatives/futures/positions', {});
      return data || [];
    } catch (error) {
      console.warn('Positions endpoint failed, returning empty');
      return [];
    }
  }

  /**
   * Get position for symbol
   */
  async getPosition(symbol) {
    const positions = await this.getPositions();
    return positions.find(p => p.pair === symbol || p.symbol === symbol) || null;
  }

  /**
   * Get symbol/instrument info (public or private)
   */
  async getSymbolInfo(symbol) {
    try {
      // Try public market details first
      const markets = await this.publicRequest('/exchange/ticker');
      return markets.find(m => m.market === symbol || m.pair === symbol);
    } catch (error) {
      console.warn(`Could not fetch symbol info for ${symbol}`);
      return null;
    }
  }

  /**
   * Set leverage (update position leverage)
   */
  async setLeverage(symbol, leverage) {
    const params = {
      pair: symbol,
      leverage: parseInt(leverage)
    };
    return await this.privateRequest('POST', '/exchange/v1/derivatives/futures/positions/update_leverage', params, true);
  }

  /**
   * Place order
   */
  /**
 * Place Futures Order on CoinDCX
 * Updated & Fixed for your calling style: placeOrder({ order: { ... } })
 * Matches official docs exactly
 */
async placeOrder(orderParams) {
  console.log("Raw orderParams received:", orderParams);

  // Handle both direct object and { order: {...} } wrapper
  let params = orderParams;
  if (orderParams.order) {
    params = orderParams.order;
  }

  const {
    pair,               // e.g., "B-BTC_USDT"
    side,                 // "buy" or "sell"
    order_type = 'market', // "limit" or "market"
    total_quantity,
    price = null,
    leverage = this.leverage || null, // fallback to class leverage
    notification = "no_notification",
    position_margin_type = "crossed",   // "crossed" or "isolated"
    margin_currency_short_name = "USDT"           // "USDT" or "INR"
  } = params;

  // Validation
  if (!pair || !side || !total_quantity) {
    throw new Error('Missing required fields: symbol, side, quantity');
  }

  if (order_type.toLowerCase() === 'limit' && (price === null || price <= 0)) {
    throw new Error('Valid price is required for limit orders');
  }

  const isLimit = order_type.toLowerCase() === 'limit';

  const orderObj = {
    pair: pair,
    side: side.toLowerCase(),
    order_type: order_type,
    total_quantity: Number(total_quantity)
  };


    orderObj.price = parseFloat(price);
    orderObj.time_in_force = 'good_till_cancel'; // Safe default


  // Optional but recommended fields
orderObj.leverage  = leverage
  orderObj.notification = notification;
  orderObj.position_margin_type = position_margin_type.toLowerCase();
  orderObj.margin_currency_short_name = margin_currency_short_name;

  const body = { order: orderObj };

  console.log('📤 Final CoinDCX order payload:', JSON.stringify(body, null, 2));

  try {
    const result = await this.privateRequest(
      'POST',
      '/exchange/v1/derivatives/futures/orders/create',
      body,
      true,   // useTradeCreds
      true    // useBufferFormat = true → critical for CoinDCX
    );

    console.log('✅ CoinDCX order placed successfully:', result);

    // Response is usually an array with one object
    const orderResult = Array.isArray(result) ? result[0] : result;

    return orderResult;
  } catch (error) {
    console.error('❌ CoinDCX order failed:', error.message);
    throw error;
  }
}
  /**
   * Get open orders
   */
  async getOpenOrders(symbol = null) {
    const params = symbol ? { pair: symbol } : {};
    return await this.privateRequest('POST', '/exchange/v1/derivatives/futures/orders', params);
  }

  /**
   * Cancel order
   */
  async cancelOrder(orderId, symbol) {
    return await this.privateRequest('POST', '/exchange/v1/derivatives/futures/orders/cancel', { id: orderId });
  }
}

export default new CoinDCXAPI();