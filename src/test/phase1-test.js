import ArbitrageEngine from '../core/arbitrageEngine.js';
import symbolMapper from '../utils/symbolMapper.js';

/**
 * Phase 1 Test Suite
 * Tests token selection, timing verification, and threshold checking
 */

class Phase1Tester {
  constructor() {
    this.engine = null;
    this.testResults = [];
  }

  /**
   * Run all Phase 1 tests
   */
  async runAllTests() {
    console.clear();
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║   Phase 1 Test Suite                                      ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    try {
      // Test 1: Symbol Mapper
      await this.testSymbolMapper();

      // Test 2: Configuration
      await this.testConfiguration();

      // Test 3: Exchange Connections
      await this.testExchangeConnections();

      // Test 4: Funding Rate Collection
      await this.testFundingRateCollection();

      // Test 5: Threshold Checking Logic
      await this.testThresholdChecking();

      // Test 6: Timing Alignment
      await this.testTimingAlignment();

      // Test 7: Opportunity Detection
      await this.testOpportunityDetection();

      // Display results
      this.displayResults();

    } catch (error) {
      console.error('\n❌ Test Suite Failed:', error);
    } finally {
      if (this.engine) {
        await this.engine.stop();
      }
    }
  }

  /**
   * Test 1: Symbol Mapper
   */
  async testSymbolMapper() {
    console.log('━'.repeat(60));
    console.log('Test 1: Symbol Mapper');
    console.log('━'.repeat(60));

    const tests = [
      { delta: 'BTCUSD', pi42: 'BTC_USDT' },
      { delta: 'ETHUSD', pi42: 'ETH_USDT' },
      { delta: 'SOLUSD', pi42: 'SOL_USDT' }
    ];

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
      const pi42Result = symbolMapper.deltaToPi42(test.delta);
      const deltaResult = symbolMapper.pi42ToDelta(test.pi42);

      if (pi42Result === test.pi42 && deltaResult === test.delta) {
        console.log(`✅ ${test.delta} ⇄ ${test.pi42} - PASS`);
        passed++;
      } else {
        console.log(`❌ ${test.delta} ⇄ ${test.pi42} - FAIL`);
        failed++;
      }
    }

    const supportedSymbols = symbolMapper.getSupportedDeltaSymbols();
    console.log(`\n📊 Total Supported Symbols: ${supportedSymbols.length}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}\n`);

    this.testResults.push({
      name: 'Symbol Mapper',
      passed,
      failed,
      total: tests.length
    });
  }

  /**
   * Test 2: Configuration
   */
  async testConfiguration() {
    console.log('━'.repeat(60));
    console.log('Test 2: Configuration');
    console.log('━'.repeat(60));

    const { default: config } = await import('../config/config.js');

    const checks = [
      { name: 'Primary Threshold (TH1)', value: config.trading.primaryThreshold, expected: 0.75 },
      { name: 'Secondary Threshold (TH2)', value: config.trading.secondaryThreshold, expected: 0.45 },
      { name: 'Leverage', value: config.trading.leverage, expected: 10 },
      { name: 'Use Fund %', value: config.trading.useFundPct, expected: 0.70 },
      { name: 'Funding Time Window', value: config.trading.fundingTimeWindowSeconds, expected: 60 }
    ];

    let passed = 0;
    let failed = 0;

    for (const check of checks) {
      if (check.value === check.expected) {
        console.log(`✅ ${check.name}: ${check.value} - PASS`);
        passed++;
      } else {
        console.log(`❌ ${check.name}: ${check.value} (expected ${check.expected}) - FAIL`);
        failed++;
      }
    }

    console.log(`\n✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}\n`);

    this.testResults.push({
      name: 'Configuration',
      passed,
      failed,
      total: checks.length
    });
  }

  /**
   * Test 3: Exchange Connections
   */
  async testExchangeConnections() {
    console.log('━'.repeat(60));
    console.log('Test 3: Exchange Connections');
    console.log('━'.repeat(60));

    this.engine = new ArbitrageEngine();

    return new Promise((resolve) => {
      let deltaConnected = false;
      let pi42Connected = false;

      const checkCompletion = () => {
        if (deltaConnected && pi42Connected) {
          console.log('\n✅ Both exchanges connected successfully\n');
          this.testResults.push({
            name: 'Exchange Connections',
            passed: 2,
            failed: 0,
            total: 2
          });
          resolve();
        }
      };

      this.engine.deltaExchange.on('connected', () => {
        console.log('✅ Delta Exchange - Connected');
        deltaConnected = true;
        checkCompletion();
      });

      this.engine.pi42Exchange.on('connected', () => {
        console.log('✅ Pi42 Exchange - Connected');
        pi42Connected = true;
        checkCompletion();
      });

      // Timeout after 15 seconds
      setTimeout(() => {
        if (!deltaConnected || !pi42Connected) {
          console.log('\n❌ Connection timeout\n');
          this.testResults.push({
            name: 'Exchange Connections',
            passed: (deltaConnected ? 1 : 0) + (pi42Connected ? 1 : 0),
            failed: (deltaConnected ? 0 : 1) + (pi42Connected ? 0 : 1),
            total: 2
          });
          resolve();
        }
      }, 15000);

      this.engine.start();
    });
  }

  /**
   * Test 4: Funding Rate Collection
   */
  async testFundingRateCollection() {
    console.log('━'.repeat(60));
    console.log('Test 4: Funding Rate Collection');
    console.log('━'.repeat(60));

    return new Promise((resolve) => {
      let deltaDataReceived = false;
      let pi42DataReceived = false;

      const checkCompletion = () => {
        if (deltaDataReceived && pi42DataReceived) {
          console.log('\n✅ Funding rate data received from both exchanges\n');
          this.testResults.push({
            name: 'Funding Rate Collection',
            passed: 2,
            failed: 0,
            total: 2
          });
          resolve();
        }
      };

      this.engine.deltaExchange.on('update', (data) => {
        if (!deltaDataReceived && data.fundingRate !== null) {
          console.log(`✅ Delta - Received funding rate for ${data.symbol}: ${data.fundingRate.toFixed(4)}%`);
          deltaDataReceived = true;
          checkCompletion();
        }
      });

      this.engine.pi42Exchange.on('batchUpdate', () => {
        if (!pi42DataReceived) {
          const allData = this.engine.pi42Exchange.getAllFundingData();
          if (allData.size > 0) {
            const firstSymbol = Array.from(allData.values())[0];
            console.log(`✅ Pi42 - Received funding rates for ${allData.size} symbols`);
            console.log(`   Example: ${firstSymbol.symbol}: ${firstSymbol.fundingRate.toFixed(4)}%`);
            pi42DataReceived = true;
            checkCompletion();
          }
        }
      });

      // Timeout after 20 seconds
      setTimeout(() => {
        if (!deltaDataReceived || !pi42DataReceived) {
          console.log('\n❌ Data collection timeout\n');
          this.testResults.push({
            name: 'Funding Rate Collection',
            passed: (deltaDataReceived ? 1 : 0) + (pi42DataReceived ? 1 : 0),
            failed: (deltaDataReceived ? 0 : 1) + (pi42DataReceived ? 0 : 1),
            total: 2
          });
          resolve();
        }
      }, 20000);
    });
  }

  /**
   * Test 5: Threshold Checking Logic
   */
  async testThresholdChecking() {
    console.log('━'.repeat(60));
    console.log('Test 5: Threshold Checking Logic');
    console.log('━'.repeat(60));

    const testCases = [
      // Both positive
      { FR_first: 1.0, FR_second: 0.2, expectedDiff: 0.8, shouldPassTH1: true, description: 'Both positive, diff > TH1' },
      { FR_first: 0.8, FR_second: 0.3, expectedDiff: 0.5, shouldPassTH2: true, description: 'Both positive, TH2 < diff < TH1' },
      { FR_first: 0.5, FR_second: 0.2, expectedDiff: 0.3, shouldPassTH2: false, description: 'Both positive, diff < TH2' },

      // Both negative
      { FR_first: -1.0, FR_second: -0.2, expectedDiff: 0.8, shouldPassTH1: true, description: 'Both negative, diff > TH1' },
      { FR_first: -0.8, FR_second: -0.3, expectedDiff: 0.5, shouldPassTH2: true, description: 'Both negative, TH2 < diff < TH1' },

      // Opposite signs
      { FR_first: 1.0, FR_second: -0.2, expectedDiff: 1.2, shouldPassTH1: true, description: 'Opposite signs, positive first' },
      { FR_first: -1.0, FR_second: 0.2, expectedDiff: 1.2, shouldPassTH1: true, description: 'Opposite signs, negative first' }
    ];

    let passed = 0;
    let failed = 0;

    for (const testCase of testCases) {
      const diff = this.engine.calculateFundingDifference(testCase.FR_first, testCase.FR_second);
      const thresholdResult = this.engine.checkThresholds(diff);

      const diffMatches = Math.abs(diff - testCase.expectedDiff) < 0.0001;
      const th1Matches = testCase.shouldPassTH1 === undefined || thresholdResult.passed === testCase.shouldPassTH1;
      const th2Matches = testCase.shouldPassTH2 === undefined || thresholdResult.passed === testCase.shouldPassTH2;

      if (diffMatches && th1Matches && th2Matches) {
        console.log(`✅ ${testCase.description}`);
        console.log(`   FR_first: ${testCase.FR_first}%, FR_second: ${testCase.FR_second}%`);
        console.log(`   Calculated diff: ${diff.toFixed(4)}%, Expected: ${testCase.expectedDiff.toFixed(4)}%`);
        console.log(`   Threshold: ${thresholdResult.passed ? thresholdResult.type : 'none'}\n`);
        passed++;
      } else {
        console.log(`❌ ${testCase.description} - FAIL`);
        console.log(`   Expected diff: ${testCase.expectedDiff.toFixed(4)}%, Got: ${diff.toFixed(4)}%\n`);
        failed++;
      }
    }

    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}\n`);

    this.testResults.push({
      name: 'Threshold Checking',
      passed,
      failed,
      total: testCases.length
    });
  }

  /**
   * Test 6: Timing Alignment
   */
  async testTimingAlignment() {
    console.log('━'.repeat(60));
    console.log('Test 6: Timing Alignment');
    console.log('━'.repeat(60));

    const now = Date.now();
    const testCases = [
      { FT_EX1: now + 3600000, FT_EX2: now + 3600000, shouldAlign: true, description: 'Exact same time' },
      { FT_EX1: now + 3600000, FT_EX2: now + 3600030, shouldAlign: true, description: '30 seconds apart' },
      { FT_EX1: now + 3600000, FT_EX2: now + 3600059, shouldAlign: true, description: '59 seconds apart' },
      { FT_EX1: now + 3600000, FT_EX2: now + 3600065, shouldAlign: false, description: '65 seconds apart' },
      { FT_EX1: now + 3600000, FT_EX2: now + 3700000, shouldAlign: false, description: 'Different funding periods' }
    ];

    let passed = 0;
    let failed = 0;

    for (const testCase of testCases) {
      const timeDiff = Math.abs(testCase.FT_EX1 - testCase.FT_EX2) / 1000;
      const aligned = timeDiff <= this.engine.fundingTimeWindow;

      if (aligned === testCase.shouldAlign) {
        console.log(`✅ ${testCase.description}`);
        console.log(`   Time diff: ${timeDiff.toFixed(2)}s, Threshold: ${this.engine.fundingTimeWindow}s`);
        console.log(`   Aligned: ${aligned}\n`);
        passed++;
      } else {
        console.log(`❌ ${testCase.description} - FAIL`);
        console.log(`   Expected aligned: ${testCase.shouldAlign}, Got: ${aligned}\n`);
        failed++;
      }
    }

    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}\n`);

    this.testResults.push({
      name: 'Timing Alignment',
      passed,
      failed,
      total: testCases.length
    });
  }

  /**
   * Test 7: Opportunity Detection
   */
  async testOpportunityDetection() {
    console.log('━'.repeat(60));
    console.log('Test 7: Opportunity Detection (Live)');
    console.log('━'.repeat(60));
    console.log('Monitoring for opportunities for 30 seconds...\n');

    return new Promise((resolve) => {
      let opportunitiesDetected = 0;

      this.engine.on('opportunity', (opportunity) => {
        opportunitiesDetected++;
        console.log(`✅ Opportunity #${opportunitiesDetected} detected:`);
        console.log(`   Token: ${opportunity.token}`);
        console.log(`   Funding Diff: ${opportunity.fundingDiff.toFixed(4)}%`);
        console.log(`   Threshold Type: ${opportunity.thresholdType}`);
        console.log(`   Delta FR: ${opportunity.FR_delta.toFixed(4)}%`);
        console.log(`   Pi42 FR: ${opportunity.FR_pi42.toFixed(4)}%\n`);
      });

      setTimeout(() => {
        console.log(`\n📊 Total Opportunities Detected: ${opportunitiesDetected}\n`);
        this.testResults.push({
          name: 'Opportunity Detection',
          passed: opportunitiesDetected > 0 ? 1 : 0,
          failed: opportunitiesDetected > 0 ? 0 : 1,
          total: 1,
          note: `${opportunitiesDetected} opportunities detected`
        });
        resolve();
      }, 30000);
    });
  }

  /**
   * Display test results summary
   */
  displayResults() {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║   Test Results Summary                                     ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    let totalPassed = 0;
    let totalFailed = 0;
    let totalTests = 0;

    this.testResults.forEach((result) => {
      totalPassed += result.passed;
      totalFailed += result.failed;
      totalTests += result.total;

      const percentage = ((result.passed / result.total) * 100).toFixed(1);
      const status = result.failed === 0 ? '✅' : '⚠️';

      console.log(`${status} ${result.name.padEnd(30)} ${result.passed}/${result.total} (${percentage}%)`);
      if (result.note) {
        console.log(`   ${result.note}`);
      }
    });

    console.log('\n' + '─'.repeat(60));
    const overallPercentage = ((totalPassed / totalTests) * 100).toFixed(1);
    console.log(`Overall: ${totalPassed}/${totalTests} tests passed (${overallPercentage}%)`);
    console.log('─'.repeat(60) + '\n');

    if (totalFailed === 0) {
      console.log('🎉 All tests passed! Phase 1 is ready.\n');
    } else {
      console.log(`⚠️  ${totalFailed} test(s) failed. Please review.\n`);
    }
  }
}

// Run tests
const tester = new Phase1Tester();
tester.runAllTests();
