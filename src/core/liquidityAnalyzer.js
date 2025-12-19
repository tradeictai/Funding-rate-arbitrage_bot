import deltaAPI from '../services/deltaAPI.js';
import pi42API from '../services/pi42API.js';
import config from '../config/config.js';

/**
 * Liquidity Analyzer - Phase 2
 * Analyzes orderbook depth and estimates slippage
 */
class LiquidityAnalyzer {
  constructor() {
    this.orderbookDepth = config.trading.orderbookDepth;
    this.minLiquidityMultiplier = config.trading.minLiquidityMultiplier;
    this.maxSlippagePct = config.trading.maxSlippagePct;
  }

  /**
   * Fetch orderbooks from both exchanges
   * @param {string} deltaSymbol - Delta symbol (e.g., 'BTCUSD')
   * @param {string} pi42Symbol - Pi42 symbol (e.g., 'BTC_USDT')
   * @returns {Promise<Object>} - Orderbooks from both exchanges
   */
  async getOrderbooks(deltaSymbol, pi42Symbol) {
    try {
      const [deltaOrderbook, pi42Orderbook] = await Promise.all([
        deltaAPI.getOrderbook(deltaSymbol, this.orderbookDepth),
        pi42API.getOrderbook(pi42Symbol, this.orderbookDepth)
      ]);
        
      // console.log('Fetched Orderbooks from Delta and Pi42', deltaOrderbook);
      // console.log('Fetched Orderbooks from Delta and Pi42', pi42Orderbook);
      return {
        delta: this.normalizeOrderbook(deltaOrderbook, 'delta'),
        pi42: this.normalizeOrderbook(pi42Orderbook, 'pi42')
      };
    } catch (error) {
      console.error('Error fetching orderbooks:', error);
      throw error;
    }
  }

  /**
   * Normalize orderbook format from different exchanges
   * @param {Object} orderbook - Raw orderbook data
   * @param {string} exchange - Exchange name
   * @returns {Object} - Normalized orderbook
   */
  normalizeOrderbook(orderbook, exchange) {
    if (exchange === 'delta') {
      // Delta format can be:
      // 1. Objects: { buy: [{ price, size, depth }, ...], sell: [...] }
      // 2. Arrays: { buy: [[price, size], ...], sell: [[price, size], ...] }
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
      // Pi42 format: { bids: [[price, size], ...], asks: [[price, size], ...] }
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
   * Calculate available liquidity for a given position size
   * @param {Object} orderbook - Normalized orderbook
   * @param {string} side - 'buy' or 'sell'
   * @param {number} positionSizeBase - Position size in base currency
   * @returns {Object} - Liquidity analysis
   */
  calculateLiquidity(orderbook, side, positionSizeBase) {
    const orders = side === 'buy' ? orderbook.asks : orderbook.bids;

    if (!orders || orders.length === 0) {
      return {
        available: 0,
        sufficient: false,
        depth: 0
      };
    }

    // Calculate total liquidity available
    const totalLiquidity = orders.reduce((sum, order) => sum + order.size, 0);

    // Check if we have enough liquidity (position size × multiplier)
    const requiredLiquidity = positionSizeBase * this.minLiquidityMultiplier;
    const sufficient = totalLiquidity >= requiredLiquidity;

    return {
      available: totalLiquidity,
      required: requiredLiquidity,
      sufficient,
      depth: orders.length,
      multiplier: totalLiquidity / positionSizeBase
    };
  }

  /**
   * Estimate slippage for a market order
   * @param {Object} orderbook - Normalized orderbook
   * @param {string} side - 'buy' or 'sell'
   * @param {number} positionSizeBase - Position size in base currency
   * @returns {Object} - Slippage estimation
   */
  estimateSlippage(orderbook, side, positionSizeBase) {
    const orders = side === 'buy' ? orderbook.asks : orderbook.bids;

    if (!orders || orders.length === 0) {
      return {
        slippagePct: 100,
        avgExecutionPrice: 0,
        worstPrice: 0
      };
    }

    const bestPrice = orders[0].price;
    let remainingSize = positionSizeBase;
    let totalCost = 0;
    let worstPrice = bestPrice;

    // Walk through the orderbook
    for (const order of orders) {
      if (remainingSize <= 0) break;

      const fillSize = Math.min(remainingSize, order.size);
      totalCost += fillSize * order.price;
      worstPrice = order.price;
      remainingSize -= fillSize;
    }

    if (remainingSize > 0) {
      // Not enough liquidity in orderbook
      return {
        slippagePct: 100,
        avgExecutionPrice: 0,
        worstPrice: 0,
        insufficient: true
      };
    }

    const avgExecutionPrice = totalCost / positionSizeBase;
    const slippagePct = Math.abs((avgExecutionPrice - bestPrice) / bestPrice) * 100;

    return {
      slippagePct,
      avgExecutionPrice,
      bestPrice,
      worstPrice,
      insufficient: false
    };
  }

  /**
   * Analyze liquidity for an arbitrage opportunity
   * @param {Object} opportunity - Opportunity from Phase 1
   * @param {Object} positionSize - Position size from PositionSizer
   * @returns {Promise<Object>} - Comprehensive liquidity analysis
   */
  async analyzeLiquidity(opportunity, positionSize) {
    console.log('\n📊 Analyzing Liquidity...');
    console.log('━'.repeat(60));

    const { actualQuantity, breakdown } = positionSize;

    // Use orderbooks already fetched in positionSize
    const deltaOrderbook = breakdown.delta.orderbook;
    const pi42Orderbook = breakdown.pi42.orderbook;

    // Get trading sides from positionSize
    const deltaSide = breakdown.delta.side;
    const pi42Side = breakdown.pi42.side;

    console.log(`Delta Side:       ${deltaSide.toUpperCase()}`);
    console.log(`Pi42 Side:        ${pi42Side.toUpperCase()}`);
    console.log(`Actual Quantity:  ${actualQuantity.toFixed(8)}`);

    // Analyze liquidity on both exchanges
    const deltaLiquidity = this.calculateLiquidity(deltaOrderbook, deltaSide, actualQuantity);
    const pi42Liquidity = this.calculateLiquidity(pi42Orderbook, pi42Side, actualQuantity);

    console.log(`\nDelta Liquidity:  ${deltaLiquidity.available.toFixed(6)} (${deltaLiquidity.multiplier.toFixed(2)}x)`);
    console.log(`Pi42 Liquidity:   ${pi42Liquidity.available.toFixed(6)} (${pi42Liquidity.multiplier.toFixed(2)}x)`);

    // Check if liquidity is sufficient
    if (!deltaLiquidity.sufficient) {
      console.log(`❌ Insufficient liquidity on Delta`);
      console.log('━'.repeat(60));
      return {
        canExecute: false,
        reason: 'Insufficient liquidity on Delta',
        deltaLiquidity,
        pi42Liquidity
      };
    }

    if (!pi42Liquidity.sufficient) {
      console.log(`❌ Insufficient liquidity on Pi42`);
      console.log('━'.repeat(60));
      return {
        canExecute: false,
        reason: 'Insufficient liquidity on Pi42',
        deltaLiquidity,
        pi42Liquidity
      };
    }

    // Estimate slippage
    const deltaSlippage = this.estimateSlippage(deltaOrderbook, deltaSide, actualQuantity);
    const pi42Slippage = this.estimateSlippage(pi42Orderbook, pi42Side, actualQuantity);

    console.log(`\nDelta Slippage:   ${deltaSlippage.slippagePct.toFixed(4)}%`);
    console.log(`Pi42 Slippage:    ${pi42Slippage.slippagePct.toFixed(4)}%`);

    // Check if slippage is acceptable
    if (deltaSlippage.slippagePct > this.maxSlippagePct) {
      console.log(`❌ Excessive slippage on Delta (max: ${this.maxSlippagePct}%)`);
      console.log('━'.repeat(60));
      return {
        canExecute: false,
        reason: 'Excessive slippage on Delta',
        deltaSlippage,
        pi42Slippage
      };
    }

    if (pi42Slippage.slippagePct > this.maxSlippagePct) {
      console.log(`❌ Excessive slippage on Pi42 (max: ${this.maxSlippagePct}%)`);
      console.log('━'.repeat(60));
      return {
        canExecute: false,
        reason: 'Excessive slippage on Pi42',
        deltaSlippage,
        pi42Slippage
      };
    }

    const totalSlippagePct = deltaSlippage.slippagePct + pi42Slippage.slippagePct;
    console.log(`Total Slippage:   ${totalSlippagePct.toFixed(4)}%`);

    console.log('━'.repeat(60));
    console.log('✅ Liquidity analysis complete\n');

    return {
      canExecute: true,
      orderbooks: {
        delta: deltaOrderbook,
        pi42: pi42Orderbook
      },
      liquidity: {
        delta: deltaLiquidity,
        pi42: pi42Liquidity
      },
      slippage: {
        delta: deltaSlippage,
        pi42: pi42Slippage,
        total: totalSlippagePct
      },
      execution: {
        deltaSide,
        pi42Side,
        deltaAvgPrice: deltaSlippage.avgExecutionPrice,
        pi42AvgPrice: pi42Slippage.avgExecutionPrice
      }
    };
  }
}

export default new LiquidityAnalyzer();
