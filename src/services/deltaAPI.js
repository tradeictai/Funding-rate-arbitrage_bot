import crypto from 'crypto';
import config from '../config/config.js';

/**
 * Delta Exchange REST API Client
 * Documentation: https://docs.delta.exchange/
 */
class DeltaAPI {
  constructor() {
    this.baseUrl = 'https://api.india.delta.exchange';
    this.apiKey = config.exchanges.delta.apiKey;
    this.apiSecret = config.exchanges.delta.apiSecret;

    this.apiKeyTrade = config.orderPlace.delta.apiKey;
    this.apiSecretTrade = config.orderPlace.delta.apiSecret;
  }

  /**
   * Generate authentication signature for Delta Exchange
   */
  generateSignature(method, path, timestamp, body = '', secret = null) {
    const message = method + timestamp + path + body;
    const secretToUse = secret || this.apiSecret;
    return crypto
      .createHmac('sha256', secretToUse)
      .update(message)
      .digest('hex');
  }

  /**
   * Make authenticated request to Delta Exchange
   */
  async request(method, endpoint, body = null, useTradeCreds = false) {
  const isPublicProducts = method === 'GET' && endpoint === '/v2/products';

  let timestamp, apiKey, apiSecret, signature, headers;

  if (!isPublicProducts) {
    // Authenticated request (standard flow)
    timestamp = Math.floor(Date.now() / 1000).toString();
    const path = endpoint;
    const bodyString = body ? JSON.stringify(body) : '';

    apiKey = useTradeCreds ? this.apiKeyTrade : this.apiKey;
    apiSecret = useTradeCreds ? this.apiSecretTrade : this.apiSecret;

    signature = this.generateSignature(method.toUpperCase(), path, timestamp, bodyString, apiSecret);

    headers = {
      'api-key': apiKey,
      'timestamp': timestamp,
      'signature': signature,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'node-js-client'
    };
  } else {
    // Public /v2/products → no auth headers
    console.log('🌐 Calling public endpoint: /v2/products (no authentication)');
    headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'node-js-client'
    };
  }

  const options = {
    method,
    headers
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    const bodyString = JSON.stringify(body);
    options.body = bodyString;

    if (!isPublicProducts) {
      // Only log body for authenticated requests
      console.log(`📤 Delta ${method} ${endpoint}:`, {
        body: JSON.parse(bodyString),
        headers: { 
          'api-key': headers['api-key'] ? `${headers['api-key'].substring(0, 5)}...` : 'MISSING',
          'timestamp': headers['timestamp'],
          'signature': headers['signature'] ? `${headers['signature'].substring(0, 16)}...` : 'MISSING'
        }
      });
    }
  }

  try {
    const response = await fetch(`${this.baseUrl}${endpoint}`, options);
    const data = await response.json();

    console.log(`Delta API ${method} ${endpoint} - Status: ${response.status}`);

    if (!response.ok) {
      let errorMsg = '';
      if (data?.error?.code === 'bad_schema' && data?.error?.context?.schema_errors) {
        const schemaErrors = data.error.context.schema_errors;
        errorMsg = `Schema validation failed: ${schemaErrors.map(e => `${e.path}: ${e.message}`).join('; ')}`;
      } else if (data?.error) {
        errorMsg = JSON.stringify(data.error);
      } else {
        errorMsg = JSON.stringify(data).substring(0, 200);
      }
      throw new Error(`Delta API Error (${response.status}): ${errorMsg}`);
    }

    return data;
  } catch (error) {
    console.error(`Delta API request failed: ${error.message}`);
    throw error;
  }
}
  /**
   * Get wallet balances
   */
  async getWalletBalance() {
    try {
      const data = await this.request('GET', '/v2/wallet/balances');
      return data.result || data || [];
    } catch (error) {
      console.error('Error fetching Delta balance:', error.message);
      console.warn('⚠️ Using mock balance data for Delta');
      return [{ asset_symbol: 'USDT', available_balance: '1000', balance: '1000' }];
    }
  }

  /**
   * Get specific asset balance
   */
  async getAssetBalance(asset = 'USD') {
    const balances = await this.getWalletBalance();
    console.log('Delta balances:', balances);
    
    if (Array.isArray(balances)) {
      const assetBalance = balances.find(b =>
        b.asset_symbol === asset ||
        b.asset === asset ||
        b.currency === asset
      );

      if (assetBalance) {
        return parseFloat(
          assetBalance.available_balance ||
          assetBalance.available ||
          assetBalance.free ||
          0
        );
      }
    }

    return 0;
  }

  /**
   * Set leverage for a product
   * MUST be called before placing orders
   */
  async setLeverage(productId, leverage) {
    const body = { leverage: leverage.toString() };
    const endpoint = `/v2/products/${productId}/orders/leverage`;
    return this.request('POST', endpoint, body, true);
  }

  /**
   * Get product/contract details
   */
  async getProductDetails(symbol) {
    try {
      const data = await this.request('GET', `/v2/products/${symbol}`);
      
      return data.result || data;
    } catch (error) {
      console.error(`Error fetching Delta product details for ${symbol}:`, error.message);
      return null;
    }
  }

  async getLotSize(symbol) {
    try {
      const data = await this.request('GET', `/v2/products`);
      const products = data.result || [];

    const product = products.find(p => p.symbol === symbol);

    if (!product) {
      console.log(`Product ${symbol} not found`);
      return null;
    }

    console.log(`\nContract Specs for ${symbol}:`);
    console.log(`   Symbol: ${product.symbol}`);
    console.log(`   Lot Size (contract_value): ${product.contract_value} USD per contract`);
    console.log(`   Tick Size: ${product.tick_size}`);
    console.log(`   Min Size: ${product.min_size || 'Not specified (check impact_size)'}`);
    console.log(`   Impact Size: ${product.impact_size} contracts`);
    console.log(`   Contract Type: ${product.contract_type}`);

    return {
      symbol: product.symbol,
      contractValue: parseFloat(product.contract_value),
      tickSize: product.tick_size,
      minSize: product.min_size ? parseInt(product.min_size) : null,
      impactSize: product.impact_size,
      contractType: product.contract_type
    };
    } catch (error) {
      console.error(`Error fetching Delta product details for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Get orderbook for a symbol
   */
  async getOrderbook(symbol, depth = 20) {
    try {
      const data = await this.request('GET', `/v2/l2orderbook/${symbol}?depth=${depth}`);
      return data.result || data;
    } catch (error) {
      console.error(`Error fetching Delta orderbook for ${symbol}:`, error.message);
      console.warn(`⚠️ Using mock orderbook data for ${symbol}`);
      return {
        buy: [[43000, 1.5], [42990, 2.0]],
        sell: [[43010, 1.5], [43020, 2.0]]
      };
    }
  }

  /**
   * Get current positions
   */
  async getPositions() {
    const data = await this.request('GET', '/v2/positions');
    return data.result || [];
  }

  /**
   * Get position for specific symbol
   */
  async getPosition(symbol) {
    const positions = await this.getPositions();
    return positions.find(p => p.product_symbol === symbol) || null;
  }

  /**
   * Place a new order
   * @param {Object} orderParams - Order parameters
   * @param {number} orderParams.productId - Product ID (REQUIRED - pass from caller)
   * @param {string} orderParams.symbol - Symbol (for reference only)
   * @param {string} orderParams.side - 'buy' or 'sell'
   * @param {string} orderParams.orderType - 'market_order' or 'limit_order'
   * @param {number} orderParams.size - Number of contracts (MUST be integer)
   * @param {number} orderParams.limitPrice - Limit price (required for limit_order)
   * @param {boolean} orderParams.postOnly - Post only flag
   * @param {boolean} orderParams.reduceOnly - Reduce only flag
   * @returns {Promise<Object>} - Order response
   */
  async placeOrder(orderParams) {
    const {
      productId,     // MUST be passed by caller
      symbol,        // For reference/logging
      side,
      orderType,
      size,
      limitPrice,
      postOnly = false,
      reduceOnly = false
    } = orderParams;

    // Validate required parameters
    if (!productId) {
      throw new Error('productId is required for Delta orders');
    }

    if (!side || !orderType || !size || size <= 0) {
      throw new Error('Invalid order parameters: side, orderType, and size are required');
    }

    console.log('\n📝 Delta Order Parameters Received:', orderParams);

    // Validate side
    const validSides = ['buy', 'sell'];
    const normalizedSide = side.toLowerCase();
    if (!validSides.includes(normalizedSide)) {
      throw new Error(`Invalid side: ${side}. Must be 'buy' or 'sell'`);
    }

    // Validate order type
    const validOrderTypes = ['market_order', 'limit_order'];
    const normalizedOrderType = orderType.toLowerCase();
    if (!validOrderTypes.includes(normalizedOrderType)) {
      throw new Error(`Invalid orderType: ${orderType}. Must be 'market_order' or 'limit_order'`);
    }

    // Build order data according to Delta API spec
    const orderData = {
      product_id: parseInt(productId),           // MUST be integer
      size: Math.floor(parseFloat(size)),        // MUST be integer (number of contracts)
      side: normalizedSide,                       // 'buy' or 'sell'
      order_type: normalizedOrderType,            // 'market_order' or 'limit_order'
      time_in_force: "gtc",                       // Good till cancelled
      post_only: postOnly,                        // Post only flag
      reduce_only: reduceOnly                     // Reduce only flag
    };

    // Add limit_price for limit orders
    if (normalizedOrderType === 'limit_order') {
      if (!limitPrice || limitPrice <= 0) {
        throw new Error('limit_price is required for limit_order');
      }
      orderData.limit_price = limitPrice.toString(); // Must be string
    }

    console.log('\n📤 Delta Order Data (Final):', orderData);
    console.log('🔑 Using trade API credentials for Delta order placement');

    try {
      const data = await this.request('POST', '/v2/orders', orderData, true);
      console.log('✅ Delta order response:', data);
      return data.result || data;
    } catch (error) {
      console.error('❌ Delta order placement failed:', error.message);
      
      // Enhanced error logging
      console.error('📊 Order Debug Info:', {
        productId: orderData.product_id,
        symbol: symbol || 'unknown',
        size: orderData.size,
        side: orderData.side,
        orderType: orderData.order_type,
        limitPrice: orderData.limit_price
      });
      
      throw error;
    }
  }

  /**
   * Get product ID for a symbol
   */
  async getProductId(symbol) {
    const product = await this.getProductDetails(symbol);
    if (!product || !product.id) {
      throw new Error(`Could not find product ID for symbol: ${symbol}`);
    }
    return product.id;
  }

  /**
   * Get maker/taker fees for a product
   */
  async getFees(symbol) {
    try {
      const product = await this.getProductDetails(symbol);
      if (product) {
        return {
          makerFee: parseFloat(product.maker_commission_rate || product.makerFee || 0.0002),
          takerFee: parseFloat(product.taker_commission_rate || product.takerFee || 0.0005)
        };
      }
    } catch (error) {
      console.error(`Error fetching Delta fees for ${symbol}:`, error.message);
    }

    console.warn(`⚠️ Using default fee rates for ${symbol}`);
    return {
      makerFee: 0.0002,
      takerFee: 0.0005
    };
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId, symbol) {
    const productId = await this.getProductId(symbol);
    const data = await this.request('DELETE', `/v2/orders/${orderId}`, { product_id: productId });
    return data.result;
  }

  /**
   * Get open orders
   */
  async getOpenOrders(symbol = null) {
    let endpoint = '/v2/orders';
    if (symbol) {
      const productId = await this.getProductId(symbol);
      endpoint += `?product_id=${productId}`;
    }
    const data = await this.request('GET', endpoint);
    return data.result || [];
  }
}

export default new DeltaAPI();