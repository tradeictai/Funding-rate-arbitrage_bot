import orderExecutor from '../core/orderExecutor.js';

/**
 * Phase 3 Test - Order Execution Module
 * Tests the order execution logic with mock data
 */

// Mock opportunity from Phase 2
const mockOpportunity = {
  token: 'BTCUSD',
  pi42Symbol: 'GRTINR',
  timestamp: Date.now(),

  // Funding rates
  FR_delta: 0.15,
  FR_pi42: 0.03,

  // Threshold
  threshold: 0.1,
  thresholdType: 'primary',

  // Phase 2 results
  phase2: {
    positionSize: {
      quantity_EX1: 100,      // Delta quantity
      quantity_EX2: 38,       // Pi42 quantity
      TP_EX1: 43000,          // Delta trading price
      TP_EX2: 11.9            // Pi42 trading price
    }
  }
};

// Mock current funding data
const mockDeltaFundingData = {
  symbol: 'BTCUSD',
  fundingRate: 0.1450,        // Slightly changed but still above threshold
  markPrice: 43000,
  nextFundingTime: Date.now() + 3600000  // 1 hour from now
};

const mockPi42FundingData = {
  symbol: 'GRTINR',
  fundingRate: 0.0280,        // Slightly changed but still above threshold
  markPrice: 11.9,
  nextFundingTime: Date.now() + 3600000  // 1 hour from now
};

/**
 * Test 1: Funding Rate Re-check
 */
function testFundingRateRecheck() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 1: Funding Rate Re-check');
  console.log('='.repeat(60));

  const result = orderExecutor.recheckFundingRate(
    mockDeltaFundingData,
    mockPi42FundingData,
    mockOpportunity.threshold
  );

  console.log('Result:', result);

  if (result.passed) {
    console.log('✅ TEST PASSED: Funding rate still exceeds threshold');
  } else {
    console.log('❌ TEST FAILED:', result.reason);
  }

  return result;
}

/**
 * Test 2: Position Side Determination
 */
function testPositionSideDetermination() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: Position Side Determination');
  console.log('='.repeat(60));

  // Test Case 1: Positive FR_first on Delta
  console.log('\nCase 1: Positive FR_first on Delta');
  const result1 = orderExecutor.determinePositionSides(0.15, 'delta', 'pi42');
  console.log('Result:', result1);
  console.log('Expected: SHORT on Delta, LONG on Pi42');
  console.log(result1.deltaSide === 'SHORT' && result1.pi42Side === 'LONG' ? '✅ PASS' : '❌ FAIL');

  // Test Case 2: Negative FR_first on Delta
  console.log('\nCase 2: Negative FR_first on Delta');
  const result2 = orderExecutor.determinePositionSides(-0.15, 'delta', 'pi42');
  console.log('Result:', result2);
  console.log('Expected: LONG on Delta, SHORT on Pi42');
  console.log(result2.deltaSide === 'LONG' && result2.pi42Side === 'SHORT' ? '✅ PASS' : '❌ FAIL');

  // Test Case 3: Positive FR_first on Pi42
  console.log('\nCase 3: Positive FR_first on Pi42');
  const result3 = orderExecutor.determinePositionSides(0.15, 'pi42', 'delta');
  console.log('Result:', result3);
  console.log('Expected: LONG on Delta, SHORT on Pi42');
  console.log(result3.deltaSide === 'LONG' && result3.pi42Side === 'SHORT' ? '✅ PASS' : '❌ FAIL');

  // Test Case 4: Negative FR_first on Pi42
  console.log('\nCase 4: Negative FR_first on Pi42');
  const result4 = orderExecutor.determinePositionSides(-0.15, 'pi42', 'delta');
  console.log('Result:', result4);
  console.log('Expected: SHORT on Delta, LONG on Pi42');
  console.log(result4.deltaSide === 'SHORT' && result4.pi42Side === 'LONG' ? '✅ PASS' : '❌ FAIL');
}

/**
 * Test 3: Full Execution Flow (Dry Run)
 */
async function testFullExecutionFlow() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 3: Full Execution Flow (Dry Run)');
  console.log('='.repeat(60));
  console.log('⚠️  Note: This will attempt real API calls if credentials are configured');
  console.log('⚠️  Ensure PAPER_TRADING_MODE=true or use mock/test API keys\n');

  try {
    // This would execute real orders if API credentials are valid
    // For testing, ensure you're in paper trading mode or using test credentials
    const result = await orderExecutor.executeArbitrageTrade(
      mockOpportunity,
      mockDeltaFundingData,
      mockPi42FundingData
    );

    console.log('\nExecution Result:', JSON.stringify(result, null, 2));

    if (result.success) {
      console.log('\n✅ TEST PASSED: Orders executed successfully');
    } else {
      console.log('\n❌ TEST FAILED:', result.reason || result.error);
      console.log('Stage:', result.stage);
    }

    return result;

  } catch (error) {
    console.error('\n❌ TEST ERROR:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Test 4: Funding Difference Calculation
 */
function testFundingDifferenceCalculation() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 4: Funding Difference Calculation');
  console.log('='.repeat(60));

  // Test Case 1: Both positive, same sign
  console.log('\nCase 1: Both positive (0.15, 0.03)');
  const diff1 = orderExecutor.calculateFundingDifference(0.15, 0.03);
  console.log('Result:', diff1);
  console.log('Expected: 0.12 (abs(0.15) - abs(0.03))');
  console.log(Math.abs(diff1 - 0.12) < 0.0001 ? '✅ PASS' : '❌ FAIL');

  // Test Case 2: Opposite signs
  console.log('\nCase 2: Opposite signs (0.15, -0.03)');
  const diff2 = orderExecutor.calculateFundingDifference(0.15, -0.03);
  console.log('Result:', diff2);
  console.log('Expected: 0.18 (abs(0.15) + abs(-0.03))');
  console.log(Math.abs(diff2 - 0.18) < 0.0001 ? '✅ PASS' : '❌ FAIL');

  // Test Case 3: Both negative, same sign
  console.log('\nCase 3: Both negative (-0.15, -0.03)');
  const diff3 = orderExecutor.calculateFundingDifference(-0.15, -0.03);
  console.log('Result:', diff3);
  console.log('Expected: 0.12 (abs(-0.15) - abs(-0.03))');
  console.log(Math.abs(diff3 - 0.12) < 0.0001 ? '✅ PASS' : '❌ FAIL');
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║              PHASE 3 - Order Executor Tests               ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  // Run tests
  testFundingDifferenceCalculation();
  testFundingRateRecheck();
  testPositionSideDetermination();

  // Full execution test (commented out by default to avoid accidental real orders)
  console.log('\n⚠️  Skipping full execution test to avoid real API calls');
  console.log('⚠️  Uncomment the line below to test with real/mock API');
  // await testFullExecutionFlow();

  console.log('\n' + '='.repeat(60));
  console.log('All tests completed!');
  console.log('='.repeat(60) + '\n');
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  runAllTests().catch(console.error);
}

export { testFundingRateRecheck, testPositionSideDetermination, testFullExecutionFlow };
