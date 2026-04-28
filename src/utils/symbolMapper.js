/**
 * Symbol Mapper - Handles conversion between Delta and Pi42 symbol formats
 * Delta format: BTCUSD, ETHUSD, SOLUSD
 * Pi42 format: BTC_USDT, ETH_USDT, SOL_USDT
 */

class SymbolMapper {
  constructor() {
    // Manual mapping for common tokens
    //     this.deltaToPi42Map = new Map([
    //   ['ETHUSD', 'ETHUSDT'],
    //   ['AAVEUSD', 'AAVEUSDT'],  // Note: AAVEUSDT may not exist; verify if needed
    //   ['AAVEUSD', 'AAVEUSDT'],
    //   ['ADAUSD', 'ADAUSDT'],    // Note: ADAUSDT may not exist; verify if needed
    //   ['ADAUSD', 'ADAUSDT'],
    //   ['ALGOUSD', 'ALGOUSDT'],  // Note: ALGOUSDT may not exist; verify if needed
    //   ['ALGOUSD', 'ALGOUSDT'],
    //   ['ALTUSD', 'ALTUSDT'],
    //   ['APTUSD', 'APTUSDT'],
    //   ['ARBUSD', 'ARBUSDT'],
    //   ['ARUSD', 'ARUSDT'],
    //   ['ATOMUSD', 'ATOMUSDT'],
    //   ['ATOMUSD', 'ATOMUSDT'],
    //   ['AVAXUSD', 'AVAXUSDT'],  // Note: AVAXUSDT may not exist; verify if needed
    //   ['AVAXUSD', 'AVAXUSDT'],
    //   ['AXSUSD', 'AXSUSDT'],
    //   ['BBUSD', 'BBUSDT'],
    //   ['BCHUSD', 'BCHUSDT'],    // Note: BCHUSDT may not exist; verify if needed
    //   ['BCHUSD', 'BCHUSDT'],
    //   ['BNBUSD', 'BNBUSDT'],     // Note: BNBUSDT may not exist; verify if needed
    //   ['BNBUSD', 'BNBUSDT'],
    //   ['BONKUSD', 'BONKUSDT'],
    //   ['BTCUSD', 'BTCUSDT'],
    //   ['CHZUSD', 'CHZUSDT'],
    //   ['CRVUSD', 'CRVUSDT'],
    //   ['DOGEUSD', 'DOGEUSDT'],  // Note: DOGEUSDT may not exist; verify if needed
    //   ['DOGEUSD', 'DOGEUSDT'],
    //   ['DOTUSD', 'DOTUSDT'],    // Note: DOTUSDT may not exist; verify if needed
    //   ['DOTUSD', 'DOTUSDT'],
    //   ['DYDXUSD', 'DYDXUSDT'],
    //   ['ENAUSD', 'ENAUSDT'],
    //   ['EOSUSD', 'EOSUSDT'],
    //   ['ETHFIUSD', 'ETHFIUSDT'],
    //   ['ETHUSD', 'ETHUSDT'],
    //   ['FILUSD', 'FILUSDT'],
    //   ['FLOKIUSD', 'FLOKIUSDT'],
    //   ['FTMUSD', 'FTMUSDT'],
    //   ['INJUSD', 'INJUSDT'],
    //   ['JTOUSD', 'JTOUSDT'],
    //   ['LDOUSD', 'LDOUSDT'],
    //   ['LINKUSD', 'LINKUSDT'],  // Note: LINKUSDT may not exist; verify if needed
    //   ['LINKUSD', 'LINKUSDT'],
    //   ['LTCUSD', 'LTCUSDT'],    // Note: LTCUSDT may not exist; verify if needed
    //   ['LTCUSD', 'LTCUSDT'],
    //   ['MANAUSD', 'MANAUSDT'],
    //   ['MANTAUSD', 'MANTAUSDT'],
    //   ['MASKUSD', 'MASKUSDT'],
    //   ['MATICUSD', 'MATICUSDT'],// Note: MATICUSDT may not exist; verify if needed
    //   ['MATICUSD', 'MATICUSDT'],
    //   ['MEMEUSD', 'MEMEUSDT'],
    //   ['NEARUSD', 'NEARUSDT'],
    //   ['NOTUSD', 'NOTUSDT'],
    //   ['ONDOUSD', 'ONDOUSDT'],
    //   ['OPUSD', 'OPUSDT'],
    //   ['ORDIUSD', 'ORDIUSDT'],
    //   ['PENDLEUSD', 'PENDLEUSDT'],
    //   ['PEOPLEUSD', 'PEOPLEUSDT'],
    //   ['PEPEUSD', 'PEPEUSDT'],
    //   ['RSRUSD', 'RSRUSDT'],
    //   ['RUNEUSD', 'RUNEUSDT'],
    //   ['SANDUSD', 'SANDUSDT'],
    //   ['SEIUSD', 'SEIUSDT'],
    //   ['SOLUSD', 'SOLUSDT'],    // Note: SOLUSDT may not exist; verify if needed
    //   ['SOLUSD', 'SOLUSDT'],
    //   ['STRKUSD', 'STRKUSDT'],
    //   ['STXUSD', 'STXUSDT'],
    //   ['SUIUSD', 'SUIUSDT'],
    //   ['SUSHIUSD', 'SUSHIUSDT'],
    //   ['THETAUSD', 'THETAUSDT'],
    //   ['TIAUSD', 'TIAUSDT'],
    //   ['TRBUSD', 'TRBUSDT'],
    //   ['TRXUSD', 'TRXUSDT'],
    //   ['UNIUSD', 'UNIUSDT'],    // Note: UNIUSDT may not exist; verify if needed
    //   ['UNIUSD', 'UNIUSDT'],
    //   ['WIFUSD', 'WIFUSDT'],
    //   ['WLDUSD', 'WLDUSDT'],
    //   ['XAIUSD', 'XAIUSDT'],
    //   ['XRPUSD', 'XRPUSDT'],    // Note: XRPUSDT may not exist; verify if needed
    //   ['XRPUSD', 'XRPUSDT'],
    //   ['EDENUSD', 'EDENUSDT'],
    //   ['POLUSD', 'POLUSDT'],
    // ]);

    this.deltaToPi42Map = new Map([
      ["EDENUSD", "EDENUSDT"],
      ["POLUSD", "POLUSDT"],
      ["AUCTIONUSD", "AUCTIONUSDT"],
      ["WIFUSD", "WIFUSDT"],
      ["TRBUSD", "TRBUSDT"],
      ["ZROUSD", "ZROUSDT"],
      // ['RSRUSD', 'RSRUSDT'],
      ["SONICUSD", "SONICUSDT"],
      ["MUBARAKUSD", "MUBARAKUSDT"],
      ["HYPEUSD", "HYPEUSDT"],
      ["RAREUSD", "RAREUSDT"],
      ["MASKUSD", "MASKUSDT"],
      ["ENSUSD", "ENSUSDT"],
      // ['WLDUSD', 'WLDUSDT'],
      ["PENDLEUSD", "PENDLEUSDT"],
      ["1MBABYDOGEUSD", "1MBABYDOGEUSDT"],
      ["TRXUSD", "TRXUSDT"],
      // ['BNBUSD', 'BNBUSDT'],
      // ['ALGOUSD', 'ALGOUSDT'],
      // ['LDOUSD', 'LDOUSDT'],
      ["INITUSD", "INITUSDT"],
      ["PROVEUSD", "PROVEUSDT"],
      ["MOVEUSD", "MOVEUSDT"],
      // ["VINEUSD", "VINEUSDT"],
      ["SKLUSD", "SKLUSDT"],
      ["BCHUSD", "BCHUSDT"],
      ["LISTAUSD", "LISTAUSDT"],
      ["GLMUSD", "GLMUSDT"],
      // ['UNIUSD', 'UNIUSDT'],
      // ['ATOMUSD', 'ATOMUSDT'],
      ["EIGENUSD", "EIGENUSDT"],
      // ['MANAUSD', 'MANAUSDT'],
      ["AIXBTUSD", "AIXBTUSDT"],
      // ['DYDXUSD', 'DYDXUSDT'],
      // ['SANDUSD', 'SANDUSDT'],
      ["MELANIAUSD", "MELANIAUSDT"],
      // ['KSMUSD', 'KSMUSDT'],
      ["VIRTUALUSD", "VIRTUALUSDT"],
      ["SUSD", "SUSDT"],
      ["VANAUSD", "VANAUSDT"],
      ["IOUSD", "IOUSDT"],
      // ['XLMUSD', 'XLMUSDT'],
      ["ETHUSD", "ETHUSDT"],
      ["SAHARAUSD", "SAHARAUSDT"],
      ["SOLVUSD", "SOLVUSDT"],
      ["CAKEUSD", "CAKEUSDT"],
      ["MEMEUSD", "MEMEUSDT"],
      ["LAYERUSD", "LAYERUSDT"],
      // ['DOTUSD', 'DOTUSDT'],
      ["ZKUSD", "ZKUSDT"],
      ["SUNUSD", "SUNUSDT"],
      // ['STXUSD', 'STXUSDT'],
      // ['ZECUSD', 'ZECUSDT'],
      ["PUMPUSD", "PUMPUSDT"],
      ["PNUTUSD", "PNUTUSDT"],
      ["ASTERUSD", "ASTERUSDT"],
      ["JTOUSD", "JTOUSDT"],
      ["SPXUSD", "SPXUSDT"],
      // ['ADAUSD', 'ADAUSDT'],
      ["BIOUSD", "BIOUSDT"],
      ["IPUSD", "IPUSDT"],
      ["BBUSD", "BBUSDT"],
      // ['PEOPLEUSD', 'PEOPLEUSDT'],
      ["XRPUSD", "XRPUSDT"],
      ["TOWNSUSD", "TOWNSUSDT"],
      ["LTCUSD", "LTCUSDT"],
      ["GOATUSD", "GOATUSDT"],
      ["ONDOUSD", "ONDOUSDT"],
      ["USUALUSD", "USUALUSDT"],
      // ['ARBUSD', 'ARBUSDT'],
      // ['SUSHIUSD', 'SUSHIUSDT'],
      ["AAVEUSD", "AAVEUSDT"],
      ["MANTAUSD", "MANTAUSDT"],
      ["API3USD", "API3USDT"],
      ["RUNEUSD", "RUNEUSDT"],
      ["ENAUSD", "ENAUSDT"],
      ["HIVEUSD", "HIVEUSDT"],
      // ['JASMYUSD', 'JASMYUSDT'],
      // ['SEIUSD', 'SEIUSDT'],
      // ['APTUSD', 'APTUSDT'],
      ["SOLUSD", "SOLUSDT"],
      ["TRUMPUSD", "TRUMPUSDT"],
      ["TAOUSD", "TAOUSDT"],
      ["POPCATUSD", "POPCATUSDT"],
      ["SUIUSD", "SUIUSDT"],
      ["ORDIUSD", "ORDIUSDT"],
      ["VVVUSD", "VVVUSDT"],
      ["XPLUSD", "XPLUSDT"],
      ["MEUSD", "MEUSDT"],
      ["DOGEUSD", "DOGEUSDT"],
      ["AVAAIUSD", "AVAAIUSDT"],
      // ['ETCUSD', 'ETCUSDT'],
      ["PENGUUSD", "PENGUUSDT"],
      ["XAIUSD", "XAIUSDT"],
      ["ALTUSD", "ALTUSDT"],
      ["SAGAUSD", "SAGAUSDT"],
      ["MOODENGUSD", "MOODENGUSDT"],
      ["TIAUSD", "TIAUSDT"],
      ["BTCUSD", "BTCUSDT"],
      ["INJUSD", "INJUSDT"],
      ["BMTUSD", "BMTUSDT"],
      // ['IOTAUSD', 'IOTAUSDT'],
      ["ETHFIUSD", "ETHFIUSDT"],
      ["BERAUSD", "BERAUSDT"],
      ["JUPUSD", "JUPUSDT"],
      ["HBARUSD", "HBARUSDT"],
      ["GRIFFAINUSD", "GRIFFAINUSDT"],
      ["ACTUSD", "ACTUSDT"],
      ["FARTCOINUSD", "FARTCOINUSDT"],
      ["DOGSUSD", "DOGSUSDT"],
      ["1000SATSUSD", "1000SATSUSDT"],
      ["BLURUSD", "BLURUSDT"],
      ["WCTUSD", "WCTUSDT"],
      ["SIGNUSD", "SIGNUSDT"],
      // ['GALAUSD', 'GALAUSDT'],
      // ['FILUSD', 'FILUSDT'],
      ["ARCUSD", "ARCUSDT"],
      ["KAITOUSD", "KAITOUSDT"],
      ["OMUSD", "OMUSDT"],
      ["SWARMSUSD", "SWARMSUSDT"],
      ["COOKIEUSD", "COOKIEUSDT"],
      ["FFUSD", "FFUSDT"],
      ["REDUSD", "REDUSDT"],
      ["AVAXUSD", "AVAXUSDT"],
      // ['OPUSD', 'OPUSDT'],
      ["NOTUSD", "NOTUSDT"],
      // ['NEARUSD', 'NEARUSDT'],
      ["WLFIUSD", "WLFIUSDT"],
      // ['LINKUSD', 'LINKUSDT'],
      ["SOPHUSD", "SOPHUSDT"],
    ]);
    // Reverse mapping
    this.pi42ToDeltaMap = new Map(
      Array.from(this.deltaToPi42Map.entries()).map(([k, v]) => [v, k]),
    );

    // Extract base tokens for dynamic mapping
    this.baseTokens = new Set(
      Array.from(this.deltaToPi42Map.keys()).map((s) =>
        this.extractBaseToken(s),
      ),
    );
  }

  /**
   * Extract base token from Delta symbol (BTCUSD -> BTC)
   */
  extractBaseToken(deltaSymbol) {
    return deltaSymbol.replace(/USD$/, "");
  }

  /**
   * Convert Delta symbol to Pi42 symbol
   * @param {string} deltaSymbol - e.g., "BTCUSD"
   * @returns {string|null} - e.g., "BTC_USDT" or null if not found
   */
  deltaToPi42(deltaSymbol) {
    // Check direct mapping first
    if (this.deltaToPi42Map.has(deltaSymbol)) {
      return this.deltaToPi42Map.get(deltaSymbol);
    }

    // Try dynamic conversion
    const baseToken = this.extractBaseToken(deltaSymbol);
    if (baseToken && deltaSymbol.endsWith("USD")) {
      return `${baseToken}_USDT`;
    }

    return null;
  }

  /**
   * Convert Pi42 symbol to Delta symbol
   * @param {string} pi42Symbol - e.g., "BTC_USDT"
   * @returns {string|null} - e.g., "BTCUSD" or null if not found
   */
  pi42ToDelta(pi42Symbol) {
    // Check direct mapping first
    if (this.pi42ToDeltaMap.has(pi42Symbol)) {
      return this.pi42ToDeltaMap.get(pi42Symbol);
    }

    // Try dynamic conversion
    if (pi42Symbol.endsWith("_USDT")) {
      const baseToken = pi42Symbol.replace(/_USDT$/, "");
      return `${baseToken}USD`;
    }

    return null;
  }

  /**
   * Check if a token pair exists on both exchanges
   * @param {string} deltaSymbol
   * @returns {boolean}
   */
  isSupported(deltaSymbol) {
    return this.deltaToPi42(deltaSymbol) !== null;
  }

  /**
   * Get all supported Delta symbols
   * @returns {Array<string>}
   */
  getSupportedDeltaSymbols() {
    return Array.from(this.deltaToPi42Map.keys());
  }

  /**
   * Get all supported Pi42 symbols
   * @returns {Array<string>}
   */
  getSupportedPi42Symbols() {
    return Array.from(this.pi42ToDeltaMap.keys());
  }

  /**
   * Add custom mapping
   * @param {string} deltaSymbol
   * @param {string} pi42Symbol
   */
  addMapping(deltaSymbol, pi42Symbol) {
    this.deltaToPi42Map.set(deltaSymbol, pi42Symbol);
    this.pi42ToDeltaMap.set(pi42Symbol, deltaSymbol);
  }
}

export default new SymbolMapper();
