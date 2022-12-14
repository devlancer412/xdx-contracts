import { PriceFeed, Token } from "types";

type Config = [string, number, number, number, number, boolean, boolean];
export const getBnbConfig = (bnb: Token, bnbPriceFeed: PriceFeed): Config => {
  return [
    bnb.address, // _token
    18, // _tokenDecimals
    10000, // _tokenWeight
    75, // _minProfitBps,
    0, // _maxUsdgAmount
    false, // _isStable
    true, // _isShortable
  ];
};

export const getEthConfig = (eth: Token, ethPriceFeed: PriceFeed): Config => {
  return [
    eth.address, // _token
    18, // _tokenDecimals
    10000, // _tokenWeight
    75, // _minProfitBps
    0, // _maxUsdgAmount
    false, // _isStable
    true, // _isShortable
  ];
};

export const getBtcConfig = (btc: Token, btcPriceFeed: PriceFeed): Config => {
  return [
    btc.address, // _token
    8, // _tokenDecimals
    10000, // _tokenWeight
    75, // _minProfitBps
    0, // _maxUsdgAmount
    false, // _isStable
    true, // _isShortable
  ];
};

export const getDaiConfig = (dai: Token, daiPriceFeed: PriceFeed): Config => {
  return [
    dai.address, // _token
    18, // _tokenDecimals
    10000, // _tokenWeight
    75, // _minProfitBps
    0, // _maxUsdgAmount
    true, // _isStable
    false, // _isShortable
  ];
};
