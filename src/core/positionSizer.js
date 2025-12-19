import deltaAPI from '../services/deltaAPI.js';
import pi42API from '../services/pi42API.js';
import config from '../config/config.js';

/**
 * Position Sizer - Phase 2
 * Calculates optimal position sizes based on available balances and leverage
 * Determines exact quantities using orderbook depth analysis
 */
class PositionSizer {
  constructor() {
    this.leverage = config.trading.leverage;
    this.useFundPct = config.trading.useFundPct;
    this.maxPositionUSD = config.trading.maxPositionSizeUSD;
    this.minPositionUSD = config.trading.minPositionSizeUSD;
    this.orderbookDepth = config.trading.orderbookDepth;
  }

  /**
   * Normalize orderbook format from different exchanges
   * @param {Object} orderbook - Raw orderbook data
   * @param {string} exchange - Exchange name ('delta' or 'pi42')
   * @returns {Object} - Normalized orderbook with bids/asks arrays
   */
  normalizeOrderbook(orderbook, exchange) {
    if (exchange === 'delta') {
      const buyOrders = orderbook.buy || [];
      const sellOrders = orderbook.sell || [];

      return {
        bids: buyOrders.map(order => {
          if (Array.isArray(order)) {
            return { price: parseFloat(order[0]), size: parseFloat(order[1]) };
          } else {
            return { price: parseFloat(order.price), size: parseFloat(order.size) };
          }
        }),
        asks: sellOrders.map(order => {
          if (Array.isArray(order)) {
            return { price: parseFloat(order[0]), size: parseFloat(order[1]) };
          } else {
            return { price: parseFloat(order.price), size: parseFloat(order.size) };
          }
        })
      };
    } else {
      // Pi42 format
      return {
        bids: (orderbook.bids || []).map(order => {
          if (Array.isArray(order)) {
            return { price: parseFloat(order[0]), size: parseFloat(order[1]) };
          } else {
            return { price: parseFloat(order.price), size: parseFloat(order.size) };
          }
        }),
        asks: (orderbook.asks || []).map(order => {
          if (Array.isArray(order)) {
            return { price: parseFloat(order[0]), size: parseFloat(order[1]) };
          } else {
            return { price: parseFloat(order.price), size: parseFloat(order.size) };
          }
        })
      };
    }
  }

  /**
   * Calculate trading price from orderbook depth for a given quantity
   * Walks through orderbook until required quantity is matched
   * @param {Object} orderbook - Normalized orderbook
   * @param {string} side - 'buy' or 'sell'
   * @param {number} quantity - Required quantity in base currency
   * @returns {Object} - { tradingPrice, totalCost, feasible }
   */
  calculateTradingPriceFromOrderbook(orderbook, side, quantity) {
    // 🔒 Normalize quantity
    const execQty = Math.abs(quantity);

    if (execQty === 0) {
      return {
        tradingPrice: 0,
        totalCost: 0,
        totalQtyFilled: 0,
        feasible: false,
        reason: 'Quantity is zero'
      };
    }

    // For 'buy' orders → take from asks
    // For 'sell' orders → take from bids
    const orders = side === 'buy' ? orderbook.asks : orderbook.bids;

    if (!orders || orders.length === 0) {
      return {
        tradingPrice: 0,
        totalCost: 0,
        totalQtyFilled: 0,
        feasible: false,
        reason: 'Empty orderbook'
      };
    }

    let remainingQty = execQty;
    let totalCost = 0;
    let totalQtyFilled = 0;

    for (const order of orders) {
      if (remainingQty <= 0) break;

      const fillQty = Math.min(remainingQty, order.size);
      totalCost += fillQty * order.price;
      totalQtyFilled += fillQty;
      remainingQty -= fillQty;
    }

    if (remainingQty > 0) {
      return {
        tradingPrice: 0,
        totalCost,
        totalQtyFilled,
        feasible: false,
        reason: `Insufficient liquidity: needed ${execQty}, filled ${totalQtyFilled}`
      };
    }

    const tradingPrice = totalCost / totalQtyFilled;

    return {
      tradingPrice,
      totalCost,
      totalQtyFilled,
      feasible: true
    };
  }

  /**
   * Get balances from both exchanges
   * @returns {Promise<Object>} - Balances from both exchanges
   */
  async getBalances() {
    try {
      const [deltaBalance, pi42Balance] = await Promise.all([
        deltaAPI.getAssetBalance('USD'),
        pi42API.getAssetBalance('USDT')
      ]);


      console.log(`Fetched Balances -> Delta: $${deltaBalance.toFixed(2)}, Pi42: $${pi42Balance.toFixed(2)}`);
      return {
        delta: deltaBalance,
        pi42: pi42Balance,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Error fetching balances:', error);
      throw error;
    }
  }

  /**
   * Calculate position size for an opportunity
   * Uses orderbook depth to determine exact trading quantities and prices
   *
   * Algorithm:
   * 1. Temp_Q_ex1 = (70% of capital) / LTP_ex1
   * 2. TP_EX1 = Trading price from orderbook for Temp_Q_ex1
   * 3. A_Q_ex1 = (70% of capital) / TP_EX1 (Actual quantity)
   * 4. TP_EX2 = Trading price from orderbook for A_Q_ex1
   *
   * @param {Object} opportunity - Opportunity object from Phase 1
   * @returns {Promise<Object>} - Position sizing details
   */
  async calculatePositionSize(opportunity) {
    console.log('\n💰 Calculating Position Size with Orderbook Depth...', opportunity);
    console.log('━'.repeat(60));

    // Get current balances
    const balances = await this.getBalances();

    console.log(`Delta Balance:   $${balances.delta.toFixed(2)} USDT`);
    console.log(`Pi42 Balance:    $${balances.pi42.toFixed(2)} USDT`);

    // Find the minimum balance (limiting factor)
    const minBalance = Math.min(balances.delta, balances.pi42);
    console.log(`Min Balance:     $${minBalance.toFixed(2)} USDT`);

    // Check if we have sufficient balance
    if (minBalance < this.minPositionUSD) {
      console.log(`❌ Insufficient balance (min required: $${this.minPositionUSD})`);
      return {
        canTrade: false,
        reason: 'Insufficient balance',
        minBalance,
        requiredBalance: this.minPositionUSD
      };
    }

    // Calculate 70% of total capital with leverage
    const capitalToUse = minBalance * this.useFundPct * this.leverage;
    console.log(`Capital to Use:   $${capitalToUse.toFixed(2)} USDT (${this.useFundPct * 100}% × ${this.leverage}x)`);

    // Apply maximum position size limit
    const effectiveCapital = Math.min(capitalToUse, this.maxPositionUSD);
    console.log(`Effective Capital: $${effectiveCapital.toFixed(2)} USDT (max: $${this.maxPositionUSD})`);

    // Get mark prices (LTP)
    const LTP_delta = parseFloat(opportunity.price_delta);
    const LTP_pi42 = parseFloat(opportunity.price_pi42);

    if (!LTP_delta || !LTP_pi42) {
      throw new Error(`Invalid mark prices: Delta=${opportunity.price_delta}, Pi42=${opportunity.price_pi42}`);
    }

    console.log(`LTP Delta:        $${LTP_delta.toFixed(8)}`);
    console.log(`LTP Pi42:         $${LTP_pi42.toFixed(8)}`);

    // Determine trading sides based on funding rate difference
    // If Delta FR > Pi42 FR: Short Delta (sell), Long Pi42 (buy)
    // If Pi42 FR > Delta FR: Long Delta (buy), Short Pi42 (sell)
    const deltaSide = opportunity.FR_delta > opportunity.FR_pi42 ? 'sell' : 'buy';
    const pi42Side = opportunity.FR_delta > opportunity.FR_pi42 ? 'buy' : 'sell';

    console.log(`\nTrading Direction:`);
    console.log(`Delta Side:       ${deltaSide.toUpperCase()}`);
    console.log(`Pi42 Side:        ${pi42Side.toUpperCase()}`);

    // Step 1: Calculate Temp_Q_ex1 (temporary quantity for exchange 1 - Delta)
    const Temp_Q_ex1 = effectiveCapital / LTP_delta;
    console.log(`\nStep 1: Temp_Q_ex1 = ${Temp_Q_ex1.toFixed(8)} (${effectiveCapital.toFixed(2)} / ${LTP_delta.toFixed(8)})`);

    // Step 2: Fetch orderbook for Delta and calculate TP_EX1
    console.log(`\nStep 2: Fetching Delta orderbook...`);
    const deltaOrderbookRaw = await deltaAPI.getOrderbook(opportunity.token, this.orderbookDepth);
    const deltaOrderbook = this.normalizeOrderbook(deltaOrderbookRaw, 'delta');

    const deltaTPResult = this.calculateTradingPriceFromOrderbook(deltaOrderbook, deltaSide, Temp_Q_ex1);

    if (!deltaTPResult.feasible) {
      console.log(`❌ Cannot execute on Delta: ${deltaTPResult.reason}`);
      return {
        canTrade: false,
        reason: `Delta orderbook insufficient: ${deltaTPResult.reason}`,
        balances
      };
    }

    const TP_EX1 = deltaTPResult.tradingPrice;
    console.log(`TP_EX1 (Delta):   $${TP_EX1.toFixed(8)}`);

    // Step 3: Calculate A_Q_ex1 (actual quantity)
    const A_Q_ex1 = effectiveCapital / TP_EX1;
    console.log(`\nStep 3: A_Q_ex1 = ${A_Q_ex1.toFixed(8)} (${effectiveCapital.toFixed(2)} / ${TP_EX1.toFixed(8)})`);

    // Step 4: Fetch orderbook for Pi42 and calculate TP_EX2
    console.log(`\nStep 4: Fetching Pi42 orderbook...`);
    const pi42OrderbookRaw = await pi42API.getOrderbook(opportunity.pi42Symbol, this.orderbookDepth);
    const pi42Orderbook = this.normalizeOrderbook(pi42OrderbookRaw, 'pi42');

    const pi42TPResult = this.calculateTradingPriceFromOrderbook(pi42Orderbook, pi42Side, A_Q_ex1);

    if (!pi42TPResult.feasible) {
      console.log(`❌ Cannot execute on Pi42: ${pi42TPResult.reason}`);
      return {
        canTrade: false,
        reason: `Pi42 orderbook insufficient: ${pi42TPResult.reason}`,
        balances
      };
    }

    const TP_EX2 = pi42TPResult.tradingPrice;
    console.log(`TP_EX2 (Pi42):    $${TP_EX2.toFixed(8)}`);

    // Calculate margin required (without leverage)
    const marginRequired = effectiveCapital / this.leverage;
    console.log(`\nMargin Required:  $${marginRequired.toFixed(2)} USDT`);

    // Verify we have enough margin on both exchanges
    if (balances.delta < marginRequired || balances.pi42 < marginRequired) {
      console.log(`❌ Insufficient margin for position`);
      return {
        canTrade: false,
        reason: 'Insufficient margin',
        marginRequired,
        balances
      };
    }

    console.log('━'.repeat(60));
    console.log('✅ Position sizing complete\n');

    return {
      canTrade: true,

      // Actual quantity to trade (same on both exchanges)
      actualQuantity: A_Q_ex1,

      // Trading prices
      tradingPriceDelta: TP_EX1,
      tradingPricePi42: TP_EX2,

      // Position sizes in USD
      positionSizeUSD: effectiveCapital,

      // Margin and leverage
      marginRequired,
      leverage: this.leverage,

      // Balances
      balances,
      minBalance,

      // Breakdown by exchange
      breakdown: {
        delta: {
          side: deltaSide,
          quantity: A_Q_ex1,
          tradingPrice: TP_EX1,
          sizeUSD: A_Q_ex1 * TP_EX1,
          marginRequired,
          availableBalance: balances.delta,
          orderbook: deltaOrderbook
        },
        pi42: {
          side: pi42Side,
          quantity: A_Q_ex1,
          tradingPrice: TP_EX2,
          sizeUSD: A_Q_ex1 * TP_EX2,
          marginRequired,
          availableBalance: balances.pi42,
          orderbook: pi42Orderbook
        }
      }
    };
  }

  /**
   * Validate if position can be entered safely
   * @param {Object} positionSize - Position size calculation result
   * @returns {boolean} - True if safe to enter
   */
  validatePosition(positionSize) {
    if (!positionSize.canTrade) {
      return false;
    }

    // Check if position size is within limits
    if (positionSize.positionSizeUSD < this.minPositionUSD) {
      console.log(`⚠️  Position too small: $${positionSize.positionSizeUSD.toFixed(2)} < $${this.minPositionUSD}`);
      return false;
    }

    if (positionSize.positionSizeUSD > this.maxPositionUSD) {
      console.log(`⚠️  Position too large: $${positionSize.positionSizeUSD.toFixed(2)} > $${this.maxPositionUSD}`);
      return false;
    }

    // Check margin availability on both exchanges
    if (positionSize.marginRequired > positionSize.breakdown.delta.availableBalance) {
      console.log(`⚠️  Insufficient margin on Delta`);
      return false;
    }

    if (positionSize.marginRequired > positionSize.breakdown.pi42.availableBalance) {
      console.log(`⚠️  Insufficient margin on Pi42`);
      return false;
    }

    // Validate actual quantities are positive
    if (positionSize.actualQuantity <= 0) {
      console.log(`⚠️  Invalid quantity: ${positionSize.actualQuantity}`);
      return false;
    }

    return true;
  }

  /**
   * Get recommended leverage for a symbol
   * @param {string} symbol - Contract symbol
   * @returns {number} - Recommended leverage
   */
  getRecommendedLeverage() {
    // For funding rate arbitrage, moderate leverage is safer
    // High leverage increases liquidation risk
    return this.leverage;
  }
}

export default new PositionSizer();
