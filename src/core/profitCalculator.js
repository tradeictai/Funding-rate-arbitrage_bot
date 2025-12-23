import deltaAPI from '../services/deltaAPI.js';
import pi42API from '../services/pi42API.js';
import config from '../config/config.js';

/**
 * Profit Calculator - Phase 2
 * Calculates expected profit after fees, slippage, and other costs
 */
class ProfitCalculator {
  constructor() {
    this.minNetProfitPct = config.trading.minNetProfitPct;
  }

  /**
   * Fetch trading fees from both exchanges
   * @param {string} deltaSymbol - Delta symbol
   * @param {string} pi42Symbol - Pi42 symbol
   * @returns {Promise<Object>} - Fee structure from both exchanges
   */
  async getFees(deltaSymbol, pi42Symbol) {
    try {
      const [deltaFees, pi42Fees] = await Promise.all([
        deltaAPI.getFees(deltaSymbol),
        pi42API.getFees(pi42Symbol)
      ]);

      return {
        delta: deltaFees,
        pi42: pi42Fees
      };
    } catch (error) {
      console.error('Error fetching fees:', error);
      // Use default fees if API call fails
      return {
        delta: { makerFee: 0.0002, takerFee: 0.0005 }, // 0.02% / 0.05%
        pi42: { makerFee: 0.0002, takerFee: 0.0005 }   // 0.02% / 0.05%
      };
    }
  }

  /**
   * Calculate funding rate profit
   * This is the main profit from the funding rate differential
   *
   * @param {number} fundingDiff - Funding rate differential (%)
   * @param {number} positionSizeUSD - Position size in USD
   * @param {number} leverage - Leverage used
   * @returns {Object} - Funding profit details
   */
  calculateFundingProfit(fundingDiff, positionSizeUSD, leverage) {
    // Funding rate is applied to the notional value (position size × leverage)
    // But we only care about the differential, not the absolute funding
    const notionalValue = positionSizeUSD;

    // Funding profit = notional × funding_differential / 100
    const fundingProfitUSD = notionalValue * (fundingDiff / 100);

    // As a percentage of our margin (invested capital)
    const marginInvested = positionSizeUSD / leverage;
    const fundingProfitPct = (fundingProfitUSD / marginInvested) * 100;

    return {
      fundingProfitUSD,
      fundingProfitPct,
      notionalValue,
      marginInvested
    };
  }

  /**
   * Calculate trading fees
   * @param {Object} fees - Fee structure
   * @param {Object} liquidityAnalysis - Liquidity analysis results
   * @param {number} positionSizeUSD - Position size in USD
   * @param {boolean} useMakerOrders - Whether to use maker (limit) orders
   * @returns {Object} - Fee costs
   */
  calculateTradingFees(fees, liquidityAnalysis, positionSizeUSD, useMakerOrders = true) {
    // Determine which fee to use (maker or taker)
    const deltaFeeRate = useMakerOrders ? fees.delta.makerFee : fees.delta.takerFee;
    const pi42FeeRate = useMakerOrders ? fees.pi42.makerFee : fees.pi42.takerFee;

    // Opening fees (entering positions on both exchanges)
    const deltaOpenFeeUSD = positionSizeUSD * deltaFeeRate;
    const pi42OpenFeeUSD = positionSizeUSD * pi42FeeRate;

    // Closing fees (exiting positions on both exchanges)
    const deltaCloseFeeUSD = positionSizeUSD * deltaFeeRate;
    const pi42CloseFeeUSD = positionSizeUSD * pi42FeeRate;

    // Total fees
    const totalFeeUSD = deltaOpenFeeUSD + pi42OpenFeeUSD + deltaCloseFeeUSD + pi42CloseFeeUSD;
    const totalFeePct = (totalFeeUSD / positionSizeUSD) * 100;

    return {
      deltaOpen: deltaOpenFeeUSD,
      pi42Open: pi42OpenFeeUSD,
      deltaClose: deltaCloseFeeUSD,
      pi42Close: pi42CloseFeeUSD,
      totalUSD: totalFeeUSD,
      totalPct: totalFeePct,
      breakdown: {
        delta: deltaOpenFeeUSD + deltaCloseFeeUSD,
        pi42: pi42OpenFeeUSD + pi42CloseFeeUSD
      }
    };
  }

  /**
   * Calculate slippage costs
   * @param {Object} liquidityAnalysis - Liquidity analysis results
   * @param {number} positionSizeUSD - Position size in USD
   * @returns {Object} - Slippage costs
   */
  calculateSlippageCosts(liquidityAnalysis, positionSizeUSD) {
    const deltaSlippagePct = liquidityAnalysis.slippage.delta.slippagePct;
    const pi42SlippagePct = liquidityAnalysis.slippage.pi42.slippagePct;

    const deltaSlippageUSD = positionSizeUSD * (deltaSlippagePct / 100);
    const pi42SlippageUSD = positionSizeUSD * (pi42SlippagePct / 100);

    const totalSlippageUSD = deltaSlippageUSD + pi42SlippageUSD;
    const totalSlippagePct = (totalSlippageUSD / positionSizeUSD) * 100;

    return {
      delta: deltaSlippageUSD,
      pi42: pi42SlippageUSD,
      totalUSD: totalSlippageUSD,
      totalPct: totalSlippagePct
    };
  }

  /**
   * Calculate comprehensive profit analysis
   * @param {Object} opportunity - Opportunity from Phase 1
   * @param {Object} positionSize - Position sizing details
   * @param {Object} liquidityAnalysis - Liquidity analysis
   * @returns {Promise<Object>} - Complete profit analysis
   */
  async calculateProfit(opportunity, positionSize, liquidityAnalysis) {
    console.log('\n💵 Calculating Profit...');
    console.log('━'.repeat(60));

    const { token, pi42Symbol, fundingDiff } = opportunity;
    const { positionSizeUSD, leverage } = positionSize;

    // 1. Calculate funding profit (main source of profit)
    const fundingProfit = this.calculateFundingProfit(fundingDiff, positionSizeUSD, leverage);

    console.log(`Funding Diff:     ${fundingDiff.toFixed(4)}%`);
    console.log(`Position Size:    $${positionSizeUSD.toFixed(2)} USD`);
    console.log(`Leverage:         ${leverage}x`);
    console.log(`Margin Invested:  $${fundingProfit.marginInvested.toFixed(2)} USD`);
    console.log(`Funding Profit:   $${fundingProfit.fundingProfitUSD.toFixed(2)} (${fundingProfit.fundingProfitPct.toFixed(4)}% ROI)`);

    // 2. Get trading fees
    const fees = await this.getFees(token, pi42Symbol);
    const tradingFees = this.calculateTradingFees(fees, liquidityAnalysis, positionSizeUSD, true);

    console.log(`\nTrading Fees:`);
    console.log(`  Delta:          $${tradingFees.breakdown.delta.toFixed(2)} (${(fees.delta.makerFee * 200 * 100).toFixed(3)}%)`);
    console.log(`  Pi42:           $${tradingFees.breakdown.pi42.toFixed(2)} (${(fees.pi42.makerFee * 200 * 100).toFixed(3)}%)`);
    console.log(`  Total:          $${tradingFees.totalUSD.toFixed(2)} (${tradingFees.totalPct.toFixed(4)}%)`);

    // 3. Calculate slippage costs
    const slippageCosts = this.calculateSlippageCosts(liquidityAnalysis, positionSizeUSD);

    console.log(`\nSlippage Costs:`);
    console.log(`  Delta:          $${slippageCosts.delta.toFixed(2)}`);
    console.log(`  Pi42:           $${slippageCosts.pi42.toFixed(2)}`);
    console.log(`  Total:          $${slippageCosts.totalUSD.toFixed(2)} (${slippageCosts.totalPct.toFixed(4)}%)`);

    // 4. Calculate net profit
    const totalCostsUSD = tradingFees.totalUSD + slippageCosts.totalUSD;
    const netProfitUSD = fundingProfit.fundingProfitUSD - totalCostsUSD;
    const netProfitPct = (netProfitUSD / fundingProfit.marginInvested) * 100;

    console.log(`\n━'.repeat(60)}`);
    console.log(`Gross Profit:     $${fundingProfit.fundingProfitUSD.toFixed(2)}`);
    console.log(`Total Costs:      $${totalCostsUSD.toFixed(2)}`);
    console.log(`Net Profit:       $${netProfitUSD.toFixed(2)}`);
    console.log(`Net ROI:          ${netProfitPct.toFixed(4)}% (on $${fundingProfit.marginInvested.toFixed(2)} margin)`);

    // 5. Check if profit meets minimum threshold
    const profitable = netProfitPct >= this.minNetProfitPct;

    if (!profitable) {
      console.log(`❌ Net profit ${netProfitPct.toFixed(4)}% below minimum ${this.minNetProfitPct}%`);
    } else {
      console.log(`✅ Profitable opportunity!`);
    }

    console.log('━'.repeat(60) + '\n');

    return {
      profitable,
      netProfitUSD,
      netProfitPct,
      fundingProfit,
      tradingFees,
      slippageCosts,
      totalCostsUSD,
      breakdown: {
        grossProfit: fundingProfit.fundingProfitUSD,
        fees: tradingFees.totalUSD,
        slippage: slippageCosts.totalUSD,
        netProfit: netProfitUSD
      },
      percentages: {
        fundingDiff: fundingDiff,
        fees: tradingFees.totalPct,
        slippage: slippageCosts.totalPct,
        netROI: netProfitPct
      }
    };
  }

  /**
   * Validate if profit is acceptable
   * @param {Object} profitAnalysis - Profit analysis result
   * @returns {boolean} - True if acceptable
   */
  validateProfit(profitAnalysis) {
    if (!profitAnalysis.profitable) {
      return false;
    }

    // Additional validation: ensure net profit is positive
    if (profitAnalysis.netProfitUSD <= 0) {
      console.log(`⚠️  Net profit is negative or zero`);
      return false;
    }

    return true;
  }

  /**
   * Generate profit summary for logging
   * @param {Object} profitAnalysis - Profit analysis result
   * @returns {string} - Formatted summary
   */
  generateSummary(profitAnalysis) {
    return `
╔════════════════════════════════════════════════════════════╗
║                   PROFIT ANALYSIS SUMMARY                   ║
╚════════════════════════════════════════════════════════════╝

  Gross Profit:      $${profitAnalysis.breakdown.grossProfit.toFixed(2)}
  Trading Fees:     -$${profitAnalysis.breakdown.fees.toFixed(2)}
  Slippage:         -$${profitAnalysis.breakdown.slippage.toFixed(2)}
  ───────────────────────────────────────────────────────────
  Net Profit:        $${profitAnalysis.breakdown.netProfit.toFixed(2)}
  Net ROI:           ${profitAnalysis.percentages.netROI.toFixed(4)}%

  Status:            ${profitAnalysis.profitable ? '✅ PROFITABLE' : '❌ NOT PROFITABLE'}
`;
  }
}

export default new ProfitCalculator();
