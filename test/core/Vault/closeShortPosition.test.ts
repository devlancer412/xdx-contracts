import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  VaultPriceFeed__factory,
  Token,
  Vault__factory,
  Vault,
  VaultPriceFeed,
  PriceFeed,
  XlxManager,
  XlxManager__factory,
} from "../../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { reportGasUsed, Ship, toChainlinkPrice, toUsd, toWei } from "../../../utils";
import { validateVaultBalance } from "./shared";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let vault: Vault;
let vaultPriceFeed: VaultPriceFeed;
let btc: Token;
let btcPriceFeed: PriceFeed;
let usdc: Token;
let usdcPriceFeed: PriceFeed;
let avaxPriceFeed: PriceFeed;

let xlxManager: XlxManager;

let alice: SignerWithAddress;
let bob: SignerWithAddress;
let user: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture(["vault", "vaultPriceFeed", "usdg", "tokens", "xlxManager"]);

  return {
    ship,
    accounts,
    users,
  };
});

describe("Vault.closeShortPosition", function () {
  beforeEach(async function () {
    const { accounts, users } = await setup();

    alice = accounts.alice;
    bob = accounts.bob;
    user = users[0];

    vault = await ship.connect(Vault__factory);
    vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
    xlxManager = await ship.connect(XlxManager__factory);

    btc = (await ship.connect("btc")) as Token;
    btcPriceFeed = (await ship.connect("btcPriceFeed")) as PriceFeed;
    usdc = (await ship.connect("usdc")) as Token;
    usdcPriceFeed = (await ship.connect("usdcPriceFeed")) as PriceFeed;
    avaxPriceFeed = (await ship.connect("avaxPriceFeed")) as PriceFeed;

    await vault.setFees(
      50, // _taxBasisPoints
      20, // _stableTaxBasisPoints
      30, // _mintBurnFeeBasisPoints
      30, // _swapFeeBasisPoints
      4, // _stableSwapFeeBasisPoints
      10, // _marginFeeBasisPoints
      toUsd(5), // _liquidationFeeUsd
      60 * 60, // _minProfitTime
      false, // _hasDynamicFees
    );
    await vault.setFundingRate(60 * 60, 600, 600);

    await xlxManager.setCooldownDuration(24 * 60 * 60);
    await xlxManager.setShortsTrackerAveragePriceWeight(10000);
    await xlxManager.setInPrivateMode(false);
    await vaultPriceFeed.setIsSecondaryPriceEnabled(false);

    await vault.setInManagerMode(false);
  });

  it("close short position", async () => {
    await vault.setFees(
      50, // _taxBasisPoints
      10, // _stableTaxBasisPoints
      4, // _mintBurnFeeBasisPoints
      30, // _swapFeeBasisPoints
      4, // _stableSwapFeeBasisPoints
      10, // _marginFeeBasisPoints
      toUsd(5), // _liquidationFeeUsd
      0, // _minProfitTime
      false, // _hasDynamicFees
    );

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));

    await usdc.mint(alice.address, toWei(1000, 6));
    await usdc.connect(alice).transfer(vault.address, toWei(100, 6));
    await vault.buyUSDG(usdc.address, bob.address);
    expect(await vault.feeReserves(usdc.address)).eq("40000"); // 0.04

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await usdc.connect(alice).transfer(vault.address, toWei(10, 6));
    await vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(90), false);

    let position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(9.91)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toUsd(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(toWei(90, 6)); // reserveAmount
    expect(position[5]).eq(0); // pnl
    expect(position[6]).eq(true); // hasRealisedProfit

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(36000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(36000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(36000));
    const delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(true);
    expect(delta[1]).eq(toUsd(9));

    const leverage = await vault.getPositionLeverage(alice.address, usdc.address, btc.address, false);
    expect(leverage).eq(90817); // ~9X leverage

    expect(await vault.feeReserves(usdc.address)).eq("130000"); // 0.13, 0.04 + 0.09
    expect(await vault.reservedAmounts(usdc.address)).eq(toWei(90, 6));
    expect(await vault.guaranteedUsd(usdc.address)).eq(0);
    expect(await vault.poolAmounts(usdc.address)).eq("99960000"); // 99.96
    expect(await usdc.balanceOf(user.address)).eq(0);

    const tx = await vault
      .connect(alice)
      .decreasePosition(alice.address, usdc.address, btc.address, toUsd(3), toUsd(90), false, user.address);
    await reportGasUsed(tx, "decreasePosition gas used");

    position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount
    expect(position[5]).eq(0); // pnl
    expect(position[6]).eq(true); // hasRealisedProfit

    expect(await vault.feeReserves(usdc.address)).eq("220000"); // 0.22, 0.04 + 0.09 + 0.09
    expect(await vault.reservedAmounts(usdc.address)).eq(0);
    expect(await vault.guaranteedUsd(usdc.address)).eq(0);
    expect(await vault.poolAmounts(usdc.address)).eq("90960000"); // 90.96
    expect(await usdc.balanceOf(user.address)).eq("18820000"); // 18.82
  });

  it("close short position with loss", async () => {
    await vault.setFees(
      50, // _taxBasisPoints
      10, // _stableTaxBasisPoints
      4, // _mintBurnFeeBasisPoints
      30, // _swapFeeBasisPoints
      4, // _stableSwapFeeBasisPoints
      10, // _marginFeeBasisPoints
      toUsd(5), // _liquidationFeeUsd
      0, // _minProfitTime
      false, // _hasDynamicFees
    );

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));

    await usdc.mint(alice.address, toWei(1000, 6));
    await usdc.connect(alice).transfer(vault.address, toWei(100, 6));
    await vault.buyUSDG(usdc.address, bob.address);
    expect(await vault.feeReserves(usdc.address)).eq("40000"); // 0.04

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await usdc.connect(alice).transfer(vault.address, toWei(10, 6));
    await vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(90), false);

    let position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(9.91)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toUsd(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(toWei(90, 6)); // reserveAmount
    expect(position[5]).eq(0); // pnl
    expect(position[6]).eq(true); // hasRealisedProfit

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    const delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq("2250000000000000000000000000000"); // 2.25

    const leverage = await vault.getPositionLeverage(alice.address, usdc.address, btc.address, false);
    expect(leverage).eq(90817); // ~9X leverage

    expect(await vault.feeReserves(usdc.address)).eq("130000"); // 0.13, 0.04 + 0.09
    expect(await vault.reservedAmounts(usdc.address)).eq(toWei(90, 6));
    expect(await vault.guaranteedUsd(usdc.address)).eq(0);
    expect(await vault.poolAmounts(usdc.address)).eq("99960000"); // 99.96
    expect(await usdc.balanceOf(user.address)).eq(0);

    const tx = await vault
      .connect(alice)
      .decreasePosition(alice.address, usdc.address, btc.address, toUsd(3), toUsd(90), false, user.address);
    await reportGasUsed(tx, "decreasePosition gas used");

    position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount
    expect(position[5]).eq(0); // pnl
    expect(position[6]).eq(true); // hasRealisedProfit

    expect(await vault.feeReserves(usdc.address)).eq("220000"); // 0.22, 0.04 + 0.09 + 0.09
    expect(await vault.reservedAmounts(usdc.address)).eq(0);
    expect(await vault.guaranteedUsd(usdc.address)).eq(0);
    expect(await vault.poolAmounts(usdc.address)).eq("102210000"); // 102.21
    expect(await usdc.balanceOf(user.address)).eq("7570000"); // 7.57
  });
});
