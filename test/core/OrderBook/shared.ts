import { expect } from "chai";
import { BigNumber, BigNumberish } from "ethers";
import { toUsd, toWei } from "../../../utils";

export const PRICE_PRECISION = BigNumber.from(10).pow(30);
export const BASIS_POINTS_DIVISOR = 10000;
export const BTC_PRICE = 60000;
export const AVAX_PRICE = 300;

export const defaultExecutionFee = toWei(1500000, 9);
export const defaultSizeDelta = toUsd(100000);
export const defaultCollateralDelta = toUsd(BTC_PRICE);
export const defaultTriggerPrice = toUsd(53000);
export const defaultTriggerRatio = 0;

export const validateOrderFields = (order: any, fields: any) => {
  for (const [key, value] of Object.entries(fields)) {
    if (value === true) expect((order as any)[key], key).to.be.true;
    if (value === false) expect((order as any)[key], key).to.be.false;
    expect((order as any)[key], key).to.be.equal(value);
  }
};

export const positionWrapper = (position: any[]) => {
  return {
    size: position[0],
    collateral: position[1],
    averagePrice: position[2],
    entryFundingRate: position[3],
    reserveAmount: position[4],
  };
};

export const getTriggerRatio = (tokenAUsd: BigNumberish, tokenBUsd: BigNumber) => {
  return tokenBUsd.mul(PRICE_PRECISION).div(tokenAUsd);
};
