import crypto from 'crypto';
import config from '../config/config.js';

/**
 * Pi42 Exchange REST API Client
 * Updated authentication to match the correct signature method
 */
class Pi42API {
  constructor() {
    this.baseUrl = 'https://fapi.pi42.com';
    this.apiKey = config.exchanges.pi42.apiKey;
    this.apiSecret = config.exchanges.pi42.apiSecret;

    // Separate API keys for trading/order placement
    this.apiKeyTrade = config.orderPlace.pi42.apiKey;
    this.apiSecretTrade = config.orderPlace.pi42.apiSecret;
  }

  /**
   * Generate authentication signature for Pi42 Exchange
   * @param {string} data - Data to sign (query string or JSON body)
   * @param {string} secret - API secret to use
   * @returns {string} - HMAC signature (hex)
   */
  generateSignature(data, secret = null) {
    const secretToUse = secret || this.apiSecret;
    return crypto
      .createHmac('sha256', secretToUse)
      .update(data)
      .digest('hex');
  }

  /**
   * Make request to Pi42 Exchange
   * @param {string} method - HTTP method
   * @param {string} endpoint - API endpoint
   * @param {Object} params - Request parameters
   * @param {boolean} useTradeCreds - Use trade credentials
   * @param {boolean} isPublic - Is public endpoint
   * @returns {Promise<Object>} - API response
   */
  async request(method, endpoint, params = {}, useTradeCreds = false, isPublic = false) {
    let url = isPublic ? `https://api.pi42.com${endpoint}` : `${this.baseUrl}${endpoint}`;
    let body = '';
    let queryString = '';

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }

    // Only sign and add auth headers if NOT public
    if (!isPublic) {
      const apiKey = useTradeCreds ? this.apiKeyTrade : this.apiKey;
      const apiSecret = useTradeCreds ? this.apiSecretTrade : this.apiSecret;

      // Add timestamp for authenticated requests
      const timestamp = Date.now().toString();
      params.timestamp = timestamp;

      if (method === 'GET' || method === 'DELETE') {
        queryString = new URLSearchParams(params).toString();
        url += queryString ? `?${queryString}` : '';
        const signature = this.generateSignature(queryString, apiSecret);
        headers['api-key'] = apiKey;
        headers['signature'] = signature;
      } else if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        // For POST/PUT/PATCH: sign the JSON body
        body = JSON.stringify(params);
        const signature = this.generateSignature(body, apiSecret);
        headers['api-key'] = apiKey;
        headers['signature'] = signature;
      }
    } else {
      // Public endpoint: only add query params if any
      if ((method === 'GET' || method === 'DELETE') && Object.keys(params).length > 0) {
        queryString = new URLSearchParams(params).toString();
        url += `?${queryString}`;
      } else if (method === 'POST' || method === 'PUT') {
        body = JSON.stringify(params);
      }
    }

    const options = {
      method,
      headers
    };

    if (body) {
      options.body = body;
    }

    // Logging for debugging
    if (!isPublic && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      console.log(`📤 Pi42 ${method} ${endpoint}:`, {
        url,
        body: params,
        headers: {
          'api-key': headers['api-key'] ? `${headers['api-key'].substring(0, 8)}...` : 'MISSING',
          'signature': headers['signature'] ? `${headers['signature'].substring(0, 16)}...` : 'MISSING'
        }
      });
    }

    try {
      const response = await fetch(url, options);
      console.log(`Pi42 API ${method} ${endpoint} - Status: ${response.status}`);

      const contentType = response.headers.get('content-type');

      // Try to get response text for debugging
      const responseText = await response.text();

      if (!contentType || !contentType.includes('application/json')) {
        throw new Error(`Pi42 API Error: Expected JSON but got ${contentType}. Response: ${responseText.substring(0, 500)}`);
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        throw new Error(`Pi42 API Error: Failed to parse JSON. Response: ${responseText.substring(0, 500)}`);
      }

      if (!response.ok) {
        // Enhanced error logging for 400 errors
        if (response.status === 400) {
          console.error('❌ 400 Bad Request Details:', {
            endpoint,
            method,
            params: method === 'POST' ? params : undefined,
            responseData: data
          });
        }

        const errorMsg = data?.message || data?.msg || data?.error || data?.code ||
          (typeof data === 'string' ? data : JSON.stringify(data).substring(0, 200));
        throw new Error(`Pi42 API Error (${response.status}): ${errorMsg}`);
      }

      return data.data || data;
    } catch (error) {
      console.error(`Pi42 API request failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get futures wallet details
   * @returns {Promise<Object>} - Wallet details
   */
  async getFuturesWallet() {
    try {
      const data = await this.request('GET', '/v1/wallet/futures-wallet/details');
      return data;
    } catch (error) {
      console.error('Error fetching Pi42 futures wallet:', error.message);
      console.warn('⚠️ Using mock wallet data for Pi42');
      return {
        walletBalance: '88000',
        withdrawableBalance: '80000',
        marginBalance: '70000',
        maxWithdrawableBalance: '80000',
        marginAsset: 'INR'
      };
    }
  }

  /**
   * Get exchange info for conversion rates
   * @param {string} market - Optional market param
   * @returns {Promise<Object>} - Exchange info
   */
  async getExchangeInfo(market = null) {
    try {
      const params = market ? { market } : {};
      const data = await this.request('GET', '/v1/exchange/exchangeInfo', params, false, true);
      console.log('✅ Pi42 exchangeInfo fetched successfully');
      return data;
    } catch (error) {
      console.warn(`⚠️ Pi42 exchangeInfo endpoint failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Convert INR amount to USDT equivalent
   * @param {string|number} inrAmount - Amount in INR
   * @returns {Promise<string>} - USDT amount
   */
  async convertINRToUSDT(inrAmount) {
    try {
      const exchangeInfo = await this.getExchangeInfo();
      console.log('Pi42 Exchange Info for Conversion:', exchangeInfo?.conversionRates);
      if (exchangeInfo?.conversionRates) {
        const rate =
          exchangeInfo.conversionRates.INR_MARGIN_USDT ||
          exchangeInfo.conversionRates.INR_SETTLEMENT_USDT;
        if (rate) {
          const usdtAmount = parseFloat(inrAmount) / parseFloat(rate);
          console.log(`Converted INR ${inrAmount} to USDT ${usdtAmount.toFixed(4)} at rate ${rate}`);
          return usdtAmount.toFixed(4);
        }
      }
    } catch (error) {
      console.warn('⚠️ Could not get Pi42 conversion rate, using approximate rate');
    }

    const approximateRate = 88;
    const usdtAmount = parseFloat(inrAmount) / approximateRate;
    return usdtAmount.toFixed(4);
  }

  /**
   * Get account balance with USDT equivalent
   * @returns {Promise<Object>} - Enhanced wallet details
   */
  async getAccountBalance() {
    const wallet = await this.getFuturesWallet();

    console.log(`Pi42 Wallet Balance: ${wallet.walletBalance} ${wallet.marginAsset}`);

    if (wallet.marginAsset === 'INR') {
      const usdtWallet = await this.convertINRToUSDT(wallet.walletBalance);
      const usdtAvailable = await this.convertINRToUSDT(wallet.withdrawableBalance || wallet.availableBalance || '0');
      const usdtMargin = await this.convertINRToUSDT(wallet.marginBalance || '0');
      const usdtMaxWithdraw = await this.convertINRToUSDT(wallet.maxWithdrawableBalance || '0');

      return {
        ...wallet,
        usdtEquivalent: {
          walletBalance: usdtWallet,
          availableBalance: usdtAvailable,
          marginBalance: usdtMargin,
          maxWithdrawable: usdtMaxWithdraw
        }
      };
    }

    return wallet;
  }

  /**
   * Get specific asset balance
   * @param {string} asset - Asset symbol
   * @returns {Promise<number>} - Available balance
   */
  async getAssetBalance(asset = 'USDT') {
    const wallet = await this.getAccountBalance();
    console.log(`Pi42 Asset Balance for ${asset}:`, wallet);
    return parseFloat(wallet.usdtEquivalent?.walletBalance || wallet.usdtEquivalent?.availableBalance || 0);
  }

  /**
   * Get contract/symbol information
   * @param {string} symbol - Contract symbol
   * @returns {Promise<Object|null>} - Symbol information
   */
  async getSymbolInfo(symbol) {
    try {
      const data = await this.request(
        'GET',
        '/v1/exchange/exchangeInfo',
        {},
        false,
        true
      );

      if (!data || !Array.isArray(data.contracts)) {
        return null;
      }

      return data.contracts.find(
        c => c.name === symbol
      ) || null;

    } catch (error) {
      console.warn(`⚠️ Could not fetch symbol info for ${symbol}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get orderbook for a symbol
   * @param {string} symbol - Contract symbol
   * @param {number} limit - Orderbook depth
   * @returns {Promise<Object>} - Orderbook data
   */
  async getOrderbook(symbol, limit = 20) {
    try {
      const data = await this.request('GET', `/v1/market/depth/${symbol}`);
      return {
        bids: data.b || data.bids || [],
        asks: data.a || data.asks || [],
        timestamp: data.E || data.timestamp || Date.now()
      };
    } catch (error) {
      console.error(`Error fetching Pi42 orderbook for ${symbol}:`, error.message);
      console.warn(`⚠️ Using mock orderbook data for ${symbol}`);
      return {
        bids: [[0.02, 1000], [0.019, 2000]],
        asks: [[0.021, 1000], [0.022, 2000]],
        timestamp: Date.now()
      };
    }
  }

  /**
   * Get current positions
   * @returns {Promise<Array>} - Active positions
   */
  async getPositions() {
    const data = await this.request('GET', '/v1/positions/OPEN');
    return data || [];
  }

  /**
   * Get position for specific symbol
   * @param {string} symbol - Contract symbol
   * @returns {Promise<Object|null>} - Position data
   */
  async getPosition(symbol) {
    const positions = await this.getPositions();
    return positions.find(p => p.symbol === symbol) || null;
  }

  /**
   * Set preference (leverage and margin mode) for a contract
   * FIXED: Now properly includes timestamp and signs the complete body
   * @param {string} contractName - Contract name (e.g., 'BTCINR')
   * @param {number} leverage - Leverage value (1-125)
   * @param {string} marginMode - Margin mode ('CROSS' or 'ISOLATED')
   * @returns {Promise<Object>} - Response
   */
  async setPreference(contractName, leverage, marginMode = 'CROSS') {
    // Validate inputs
    if (!contractName) {
      throw new Error('contractName is required');
    }
    if (!leverage || leverage < 1 || leverage > 125) {
      throw new Error('leverage must be between 1 and 125');
    }
    if (!['CROSS', 'ISOLATED'].includes(marginMode.toUpperCase())) {
      throw new Error('marginMode must be either CROSS or ISOLATED');
    }

    // First, verify the contract exists
    console.log(`🔍 Verifying contract ${contractName} exists...`);
    const symbolInfo = await this.getSymbolInfo(contractName);
    if (!symbolInfo) {
      throw new Error(`Contract ${contractName} not found on Pi42. Please check the contract name.`);
    }

    console.log('Pi42 Symbol Info for Preference Setting:', symbolInfo);
    console.log(`✅ Contract ${contractName} verified:`, {
      symbol: symbolInfo.symbol,
      status: symbolInfo.status,
      contractType: symbolInfo.contractType
    });

    // Prepare parameters (timestamp will be added in request method)
    const params = {
      contractName: contractName,
      leverage: parseInt(leverage),
      marginMode: marginMode.toUpperCase()
    };

    console.log('🔧 Setting Pi42 preference:', params);

    try {
      // Use trade credentials (true) since this modifies trading settings
      const result = await this.request('POST', '/v1/exchange/update/preference', params, true);
      console.log('✅ Preference updated successfully:', result);
      return result;
    } catch (error) {
      console.error('❌ Failed to update preference:', error.message);

      // Additional debugging info
      console.log('📊 Debug Info:', {
        contractName,
        leverage,
        marginMode,
        apiKeyUsed: this.apiKeyTrade ? `${this.apiKeyTrade.substring(0, 8)}...` : 'MISSING',
        endpoint: '/v1/exchange/update/preference'
      });

      throw error;
    }
  }

  //   async getPositions() {
  //   const data = await this.request('GET', '/v1/positionRisk');
  //   return data || [];
  // }

  /**
   * Place a new order
   * @param {Object} orderParams - Order parameters
   * @returns {Promise<Object>} - Order response
   */
  async placeOrder(orderParams) {
    const {
      symbol,
      side,
      orderType,
      quantity,
      price,
      reduceOnly = false,
      positionId = null
    } = orderParams;

    if (!symbol || !side || !orderType || !quantity || quantity <= 0) {
      throw new Error('Invalid order parameters');
    }

    console.log('Preparing to place Pi42 order:', orderParams);

    const symbolInfo = await this.getSymbolInfo(symbol);
    console.log('Fetched Pi42 Symbol Info for Order Placement:', symbolInfo);
    if (!symbolInfo) throw new Error(`No symbol info for ${symbol}`);

    console.log('Pi42 Symbol Info:', symbolInfo);

    const qtyPrecision = symbolInfo.quantityPrecision || 3;
    const pricePrecision = symbolInfo.pricePrecision || 2;

    const roundedQty = parseFloat(quantity.toFixed(qtyPrecision));
    if (roundedQty < symbolInfo.minQty || roundedQty > symbolInfo.maxQty) {
      throw new Error(`Quantity ${roundedQty} out of range [${symbolInfo.minQty}, ${symbolInfo.maxQty}]`);
    }

    const orderData = {
      placeType: "ORDER_FORM",
      quantity: roundedQty,
      side: side.toUpperCase(),
      symbol: symbol,
      type: orderType.toUpperCase(),
      marginAsset: 'INR',
      reduceOnly: reduceOnly
    };

    if (orderType.toUpperCase() === 'LIMIT') {
      if (!price || price <= 0) throw new Error('Price required for LIMIT');
      orderData.price = parseFloat(price.toFixed(pricePrecision));
    }

    console.log("Placing Pi42 order with params:", orderData);
    console.log('🔑 Using trade API credentials for Pi42 order placement');

    const orderDataForClose = {
      placeType: "POSITION",
      quantity: quantity,
      side: side.toUpperCase(),
      symbol: symbol,
      type: orderType.toUpperCase(),
      marginAsset: 'INR',
      reduceOnly: reduceOnly,
      positionId: positionId,
      price: parseFloat(price.toFixed(pricePrecision))
    }
    let order;
    if (reduceOnly) {
      order = orderDataForClose
    } else {
      order = orderData
    }
    const data = await this.request('POST', '/v1/order/place-order', order, true);
    return data;
  }

  /**
   * Get maker/taker fees for a symbol
   * @param {string} symbol - Contract symbol
   * @returns {Promise<Object>} - Fee structure
   */
  async getFees(symbol) {
    try {
      const symbolInfo = await this.getSymbolInfo(symbol);

      if (symbolInfo) {
        return {
          makerFee: parseFloat(symbolInfo.makerCommission || symbolInfo.makerFee || 0.0002),
          takerFee: parseFloat(symbolInfo.takerCommission || symbolInfo.takerFee || 0.0005)
        };
      }
    } catch (error) {
      console.error(`Error fetching Pi42 fees for ${symbol}:`, error.message);
    }

    console.warn(`⚠️ Using default fee rates for ${symbol}`);
    return {
      makerFee: 0.0002,
      takerFee: 0.0005
    };
  }

  /**
   * Cancel an order
   * @param {string} orderId - Order ID
   * @param {string} symbol - Contract symbol
   * @returns {Promise<Object>} - Cancellation response
   */
  async cancelOrder(orderId, symbol) {
    const data = await this.request('DELETE', '/v1/order', {
      orderId,
      symbol
    });
    return data;
  }

  /**
   * Get open orders
   * @param {string} symbol - Contract symbol (optional)
   * @returns {Promise<Array>} - Open orders
   */
  async getOpenOrders(symbol = null) {
    const params = symbol ? { symbol } : {};
    const data = await this.request('GET', '/v1/openOrders', params);
    return data || [];
  }

  /**
   * Get current leverage for a symbol
   * @param {string} symbol - Contract symbol
   * @returns {Promise<number>} - Current leverage
   */
  async getLeverage(symbol) {
    const position = await this.getPosition(symbol);
    return position ? parseInt(position.leverage) : 1;
  }

  /**
   * Change leverage for a symbol using the /update/leverage endpoint
   * @param {string} symbol - Contract symbol
   * @param {number} leverage - Desired leverage
   * @returns {Promise<Object>} - Response
   */
  async setLeverage(symbol, leverage) {
    // Validate inputs
    if (!symbol) {
      throw new Error('symbol/contractName is required');
    }
    if (!leverage || leverage < 1 || leverage > 125) {
      throw new Error('leverage must be between 1 and 125');
    }

    console.log(`🔧 Setting leverage for ${symbol} to ${leverage}x`);

    const params = {
      contractName: symbol,
      leverage: parseInt(leverage)
    };

    try {
      const result = await this.request('POST', '/v1/exchange/update/leverage', params, true);
      console.log('✅ Leverage updated successfully:', result);
      return result;
    } catch (error) {
      console.error('❌ Failed to update leverage:', error.message);
      throw error;
    }
  }

  /**
   * Set both leverage and margin mode using setPreference
   * If this fails, automatically falls back to setLeverage
   * @param {string} contractName - Contract name
   * @param {number} leverage - Leverage value
   * @param {string} marginMode - Margin mode
   * @returns {Promise<Object>} - Response
   */
  async setPreferenceWithFallback(contractName, leverage, marginMode = 'CROSS') {
    try {
      // Try the preference endpoint first
      return await this.setPreference(contractName, leverage, marginMode);
    } catch (error) {
      console.warn(`⚠️ setPreference failed: ${error.message}`);
      console.log('🔄 Falling back to setLeverage endpoint...');

      // Fall back to just setting leverage
      return await this.setLeverage(contractName, leverage);
    }
  }
}

export default new Pi42API();