import chai from "chai";
import { Token, Vault } from "../../../types";
const { expect } = chai;

export const validateVaultBalance = async (vault: Vault, token: Token, offset = 0) => {
  const poolAmount = await vault.poolAmounts(token.address);
  const feeReserve = await vault.feeReserves(token.address);
  const balance = await token.balanceOf(vault.address);
  const amount = poolAmount.add(feeReserve);
  expect(balance).gt(0);
  expect(poolAmount.add(feeReserve).add(offset)).eq(balance);
};
