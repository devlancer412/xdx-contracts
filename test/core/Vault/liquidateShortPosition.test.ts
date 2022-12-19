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
let avax: Token;
let usdc: Token;
let usdcPriceFeed: PriceFeed;
let avaxPriceFeed: PriceFeed;

let xlxManager: XlxManager;

let deployer: SignerWithAddress;
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

describe.only("Vault.liquidateShortPosition", function () {
  beforeEach(async function () {
    const { accounts, users } = await setup();

    deployer = accounts.deployer;
    alice = accounts.alice;
    bob = accounts.bob;
    user = users[0];

    vault = await ship.connect(Vault__factory);
    vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
    xlxManager = await ship.connect(XlxManager__factory);

    btc = (await ship.connect("btc")) as Token;
    btcPriceFeed = (await ship.connect("btcPriceFeed")) as PriceFeed;
    avax = (await ship.connect("avax")) as Token;
    avaxPriceFeed = (await ship.connect("avaxPriceFeed")) as PriceFeed;
    usdc = (await ship.connect("usdc")) as Token;
    usdcPriceFeed = (await ship.connect("usdcPriceFeed")) as PriceFeed;

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

  it("liquidate short", async () => {
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
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await expect(
      vault.connect(alice).liquidatePosition(alice.address, usdc.address, btc.address, false, user.address),
    ).to.be.revertedWith("Vault: empty position");

    expect(await vault.globalShortSizes(btc.address)).eq(0);
    expect(await vault.globalShortAveragePrices(btc.address)).eq(0);
    expect(await xlxManager.getAumInUsdg(true)).eq(0);

    await usdc.mint(alice.address, toWei(1000, 6));
    await usdc.connect(alice).transfer(vault.address, toWei(100, 6));
    await vault.buyUSDG(usdc.address, bob.address);

    await usdc.connect(alice).transfer(vault.address, toWei(10, 6));
    await vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(90), false);

    let position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(9.91)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toUsd(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(toWei(90, 6)); // reserveAmount

    expect(await vault.globalShortSizes(btc.address)).eq(toUsd(90));
    expect(await vault.globalShortAveragePrices(btc.address)).eq(toUsd(40000));
    expect(await xlxManager.getAumInUsdg(false)).eq("99960000000000000000"); // 99.96

    expect((await vault.validateLiquidation(alice.address, usdc.address, btc.address, false, false))[0]).eq(
      0,
    );

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39000));

    let delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(true);
    expect(delta[1]).eq(toUsd(2.25)); // 1000 / 40,000 * 90
    expect((await vault.validateLiquidation(alice.address, usdc.address, btc.address, false, false))[0]).eq(
      0,
    );

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(toUsd(2.25));
    expect((await vault.validateLiquidation(alice.address, usdc.address, btc.address, false, false))[0]).eq(
      0,
    );

    await expect(
      vault.liquidatePosition(alice.address, usdc.address, btc.address, false, user.address),
    ).to.be.revertedWith("Vault: position cannot be liquidated");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(42500));
    delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq("5625000000000000000000000000000"); // 2500 / 40,000 * 90 => 5.625
    expect((await vault.validateLiquidation(alice.address, usdc.address, btc.address, false, false))[0]).eq(
      1,
    );

    position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(9.91)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toUsd(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(toWei(90, 6)); // reserveAmount

    expect(await vault.feeReserves(usdc.address)).eq("130000"); // 0.13
    expect(await vault.reservedAmounts(usdc.address)).eq(toWei(90, 6));
    expect(await vault.guaranteedUsd(usdc.address)).eq(0);
    expect(await vault.poolAmounts(usdc.address)).eq("99960000");
    expect(await usdc.balanceOf(user.address)).eq(0);

    const tx = await vault.liquidatePosition(alice.address, usdc.address, btc.address, false, user.address);
    await reportGasUsed(tx, "liquidatePosition gas used");

    position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount

    expect(await vault.feeReserves(usdc.address)).eq("220000"); // 0.22
    expect(await vault.reservedAmounts(usdc.address)).eq(0);
    expect(await vault.guaranteedUsd(usdc.address)).eq(0);
    expect(await vault.poolAmounts(usdc.address)).eq("104780000"); // 104.78
    expect(await usdc.balanceOf(user.address)).eq(toWei(5, 6));

    expect(await vault.globalShortSizes(btc.address)).eq(0);
    expect(await vault.globalShortAveragePrices(btc.address)).eq(toUsd(40000));
    expect(await xlxManager.getAumInUsdg(true)).eq("104780000000000000000"); // 104.78

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));

    await usdc.connect(alice).transfer(vault.address, toWei(20, 6));
    await vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(100), false);

    expect(await vault.globalShortSizes(btc.address)).eq(toUsd(100));
    expect(await vault.globalShortAveragePrices(btc.address)).eq(toUsd(50000));
    expect(await xlxManager.getAumInUsdg(true)).eq("104780000000000000000"); // 104.78

    position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    await validateVaultBalance(vault, usdc, position[1].mul(toWei(10, 6)).div(toWei(10, 30)));
  });

  it("automatic stop-loss", async () => {
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
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await expect(
      vault.connect(alice).liquidatePosition(alice.address, usdc.address, btc.address, false, user.address),
    ).to.be.revertedWith("Vault: empty position");

    expect(await vault.globalShortSizes(btc.address)).eq(0);
    expect(await vault.globalShortAveragePrices(btc.address)).eq(0);
    expect(await xlxManager.getAumInUsdg(true)).eq(0);

    await usdc.mint(alice.address, toWei(1001, 6));
    await usdc.connect(alice).transfer(vault.address, toWei(1001, 6));
    await vault.buyUSDG(usdc.address, bob.address);

    await usdc.mint(alice.address, toWei(100, 6));
    await usdc.connect(alice).transfer(vault.address, toWei(100, 6));
    await vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(1000), false);

    let position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(toUsd(1000)); // size
    expect(position[1]).eq(toUsd(99)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toUsd(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(toWei(1000, 6)); // reserveAmount

    expect(await vault.globalShortSizes(btc.address)).eq(toUsd(1000));
    expect(await vault.globalShortAveragePrices(btc.address)).eq(toUsd(40000));
    expect(await xlxManager.getAumInUsdg(false)).eq("1000599600000000000000"); // 1000.5996

    expect((await vault.validateLiquidation(alice.address, usdc.address, btc.address, false, false))[0]).eq(
      0,
    );

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39000));

    let delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(true);
    expect(delta[1]).eq(toUsd(25)); // 1000 / 40,000 * 1000
    expect((await vault.validateLiquidation(alice.address, usdc.address, btc.address, false, false))[0]).eq(
      0,
    );

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(toUsd(25));
    expect((await vault.validateLiquidation(alice.address, usdc.address, btc.address, false, false))[0]).eq(
      0,
    );

    await expect(
      vault.liquidatePosition(alice.address, usdc.address, btc.address, false, user.address),
    ).to.be.revertedWith("Vault: position cannot be liquidated");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(45000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(45000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(45000));
    delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(toUsd(125)); // 5000 / 40,000 * 1000 => 125
    expect((await vault.validateLiquidation(alice.address, usdc.address, btc.address, false, false))[0]).eq(
      1,
    );

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(43600));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(43600));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(43600));
    delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(toUsd(90)); // 3600 / 40,000 * 1000 => 90
    expect((await vault.validateLiquidation(alice.address, usdc.address, btc.address, false, false))[0]).eq(
      2,
    );

    position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(toUsd(1000)); // size
    expect(position[1]).eq(toUsd(99)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toUsd(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(toWei(1000, 6)); // reserveAmount

    expect(await vault.feeReserves(usdc.address)).eq("1400400"); // 1.4004
    expect(await vault.reservedAmounts(usdc.address)).eq(toWei(1000, 6));
    expect(await vault.guaranteedUsd(usdc.address)).eq(0);
    expect(await vault.poolAmounts(usdc.address)).eq("1000599600"); // 1000.5996
    expect(await usdc.balanceOf(deployer.address)).eq(0);
    expect(await usdc.balanceOf(alice.address)).eq(0);
    expect(await usdc.balanceOf(bob.address)).eq(0);
    expect(await usdc.balanceOf(user.address)).eq(0);
    expect(await vault.globalShortSizes(btc.address)).eq(toUsd(1000));
    expect(await vault.globalShortAveragePrices(btc.address)).eq(toUsd(40000));
    expect(await xlxManager.getAumInUsdg(true)).eq("1090599600000000000000"); // 1090.5996

    const tx = await vault.liquidatePosition(alice.address, usdc.address, btc.address, false, user.address);
    await reportGasUsed(tx, "liquidatePosition gas used");

    position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount

    expect(await vault.feeReserves(usdc.address)).eq("2400400"); // 2.4004
    expect(await vault.reservedAmounts(usdc.address)).eq(0);
    expect(await vault.guaranteedUsd(usdc.address)).eq(0);
    expect(await vault.poolAmounts(usdc.address)).eq("1090599600"); // 1090.5996
    expect(await usdc.balanceOf(deployer.address)).eq(0);
    expect(await usdc.balanceOf(alice.address)).eq(toWei(8, 6));
    expect(await usdc.balanceOf(bob.address)).eq(0);
    expect(await usdc.balanceOf(user.address)).eq(0);

    expect(await vault.globalShortSizes(btc.address)).eq(0);
    expect(await vault.globalShortAveragePrices(btc.address)).eq(toUsd(40000));
    expect(await xlxManager.getAumInUsdg(true)).eq("1090599600000000000000"); // 1090.5996

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));

    await usdc.mint(alice.address, toWei(20, 6));
    await usdc.connect(alice).transfer(vault.address, toWei(20, 6));
    await vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(100), false);

    expect(await vault.globalShortSizes(btc.address)).eq(toUsd(100));
    expect(await vault.globalShortAveragePrices(btc.address)).eq(toUsd(50000));
    expect(await xlxManager.getAumInUsdg(true)).eq("1090599600000000000000"); // 1090.5996

    position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    await validateVaultBalance(vault, usdc, position[1].mul(toWei(10, 6)).div(toWei(10, 30)));
  });

  it("global AUM", async () => {
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
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await expect(
      vault.connect(alice).liquidatePosition(alice.address, usdc.address, btc.address, false, user.address),
    ).to.be.revertedWith("Vault: empty position");

    expect(await vault.globalShortSizes(btc.address)).eq(0);
    expect(await vault.globalShortAveragePrices(btc.address)).eq(0);
    expect(await xlxManager.getAumInUsdg(true)).eq(0);

    await usdc.mint(alice.address, toWei(1001, 6));
    await usdc.connect(alice).transfer(vault.address, toWei(1001, 6));
    await vault.buyUSDG(usdc.address, bob.address);

    await usdc.mint(alice.address, toWei(100, 6));
    await usdc.connect(alice).transfer(vault.address, toWei(100, 6));
    await vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(1000), false);

    let position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(toUsd(1000)); // size
    expect(position[1]).eq(toUsd(99)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toUsd(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(toWei(1000, 6)); // reserveAmount

    expect(await vault.globalShortSizes(btc.address)).eq(toUsd(1000));
    expect(await vault.globalShortAveragePrices(btc.address)).eq(toUsd(40000));
    expect(await xlxManager.getAumInUsdg(false)).eq("1000599600000000000000"); // 1000.5996

    expect((await vault.validateLiquidation(alice.address, usdc.address, btc.address, false, false))[0]).eq(
      0,
    );

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39000));

    let delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(true);
    expect(delta[1]).eq(toUsd(25)); // 1000 / 40,000 * 1000
    expect((await vault.validateLiquidation(alice.address, usdc.address, btc.address, false, false))[0]).eq(
      0,
    );

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(toUsd(25));
    expect((await vault.validateLiquidation(alice.address, usdc.address, btc.address, false, false))[0]).eq(
      0,
    );

    await expect(
      vault.liquidatePosition(alice.address, usdc.address, btc.address, false, user.address),
    ).to.be.revertedWith("Vault: position cannot be liquidated");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(45000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(45000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(45000));
    delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(toUsd(125)); // 5000 / 40,000 * 1000 => 125
    expect((await vault.validateLiquidation(alice.address, usdc.address, btc.address, false, false))[0]).eq(
      1,
    );

    position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(toUsd(1000)); // size
    expect(position[1]).eq(toUsd(99)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toUsd(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(toWei(1000, 6)); // reserveAmount

    expect(await vault.feeReserves(usdc.address)).eq("1400400"); // 1.4004
    expect(await vault.reservedAmounts(usdc.address)).eq(toWei(1000, 6));
    expect(await vault.guaranteedUsd(usdc.address)).eq(0);
    expect(await vault.poolAmounts(usdc.address)).eq("1000599600"); // 1000.5996
    expect(await usdc.balanceOf(deployer.address)).eq(0);
    expect(await usdc.balanceOf(alice.address)).eq(0);
    expect(await usdc.balanceOf(bob.address)).eq(0);
    expect(await usdc.balanceOf(user.address)).eq(0);
    expect(await vault.globalShortSizes(btc.address)).eq(toUsd(1000));
    expect(await vault.globalShortAveragePrices(btc.address)).eq(toUsd(40000));
    expect(await xlxManager.getAumInUsdg(true)).eq("1125599600000000000000"); // 1125.5996

    const tx = await vault.liquidatePosition(alice.address, usdc.address, btc.address, false, user.address);
    await reportGasUsed(tx, "liquidatePosition gas used");

    position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount

    expect(await vault.feeReserves(usdc.address)).eq("2400400"); // 2.4004
    expect(await vault.reservedAmounts(usdc.address)).eq(0);
    expect(await vault.guaranteedUsd(usdc.address)).eq(0);
    expect(await vault.poolAmounts(usdc.address)).eq("1093599600"); // 1093.5996
    expect(await usdc.balanceOf(deployer.address)).eq(0);
    expect(await usdc.balanceOf(alice.address)).eq(0);
    expect(await usdc.balanceOf(bob.address)).eq(0);
    expect(await usdc.balanceOf(user.address)).eq(toWei(5, 6));

    expect(await vault.globalShortSizes(btc.address)).eq(0);
    expect(await vault.globalShortAveragePrices(btc.address)).eq(toUsd(40000));
    expect(await xlxManager.getAumInUsdg(true)).eq("1093599600000000000000"); // 1093.5996

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));

    await usdc.mint(alice.address, toWei(20, 6));
    await usdc.connect(alice).transfer(vault.address, toWei(20, 6));
    await vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(100), false);

    expect(await vault.globalShortSizes(btc.address)).eq(toUsd(100));
    expect(await vault.globalShortAveragePrices(btc.address)).eq(toUsd(50000));
    expect(await xlxManager.getAumInUsdg(true)).eq("1093599600000000000000"); // 1093.5996

    position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    await validateVaultBalance(vault, usdc, position[1].mul(toWei(10, 6)).div(toWei(10, 30)));
  });
});
