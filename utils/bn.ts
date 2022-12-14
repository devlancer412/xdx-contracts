import { BigNumber, ethers } from "ethers";

export const toBN = (value: number): BigNumber => {
  const valueString = value.toString();
  const valueBN = BigNumber.from(valueString);
  return valueBN;
};

export const toWei = (value: number, decimals = 18): BigNumber => {
  const valueString = value.toFixed(decimals);
  const valueWeiBN = ethers.utils.parseUnits(valueString, decimals);
  return valueWeiBN;
};

export const fromBN = (valueBN: BigNumber): number => {
  const valueString = valueBN.toString();
  const valueNumber = Number(valueString);
  return valueNumber;
};

export const fromWei = (valueWeiBN: BigNumber, decimals = 18): number => {
  const valueString = ethers.utils.formatUnits(valueWeiBN, decimals);
  const valueNumber = Number(valueString);
  return valueNumber;
};

export const toBNArray = (values: number[]): BigNumber[] => {
  const bnArray = values.map<BigNumber>((value) => toBN(value));
  return bnArray;
};

export const fromBNArray = (valuesBN: BigNumber[]): number[] => {
  const values = valuesBN.map<number>((valueBN) => fromBN(valueBN));
  return values;
};

export const toUsd = (value: number) => {
  const normalizedValue = value * Math.pow(10, 10);
  return ethers.BigNumber.from(normalizedValue).mul(ethers.BigNumber.from(10).pow(20));
};

export const toChainlinkPrice = (value: number) => {
  return value * Math.pow(10, 8);
};
