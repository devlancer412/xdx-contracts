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
  PancakePair__factory,
} from "../../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { reportGasUsed, Ship, toChainlinkPrice, toUsd, toWei } from "../../../utils";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let vault: Vault;
let vaultPriceFeed: VaultPriceFeed;
let btc: Token;
let btcPriceFeed: PriceFeed;
let avax: Token;
let usdcPriceFeed: PriceFeed;
let avaxPriceFeed: PriceFeed;
let eth: Token;

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

describe("Vault.liquidateLongPosition", function () {
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
    usdcPriceFeed = (await ship.connect("usdcPriceFeed")) as PriceFeed;
    eth = (await ship.connect("eth")) as Token;

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

  it("liquidate long", async () => {
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await expect(
      vault.connect(alice).liquidatePosition(alice.address, btc.address, btc.address, true, user.address),
    ).to.be.revertedWith("Vault: empty position");

    await btc.mint(bob.address, toWei(1, 8));
    await btc.connect(bob).transfer(vault.address, 250000); // 0.0025 BTC => 100 USD
    await vault.buyUSDG(btc.address, bob.address);

    await btc.mint(alice.address, toWei(1, 8));
    await btc.connect(bob).transfer(vault.address, 25000); // 0.00025 BTC => 10 USD

    expect(await xlxManager.getAumInUsdg(false)).eq("99700000000000000000"); // 99.7
    expect(await xlxManager.getAumInUsdg(true)).eq("102192500000000000000"); // 102.1925

    await vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(90), true);

    expect(await xlxManager.getAumInUsdg(false)).eq("99702400000000000000"); // 99.7024
    expect(await xlxManager.getAumInUsdg(true)).eq("100192710000000000000"); // 100.19271

    let position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(9.91)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toUsd(41000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(225000); // reserveAmount, 0.00225 * 40,000 => 90

    expect((await vault.validateLiquidation(alice.address, btc.address, btc.address, true, false))[0]).eq(0);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(43500));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(43500));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(43500));

    let delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(true);
    expect(delta[1]).eq("5487804878048780487804878048780"); // ~5.48
    expect((await vault.validateLiquidation(alice.address, btc.address, btc.address, true, false))[0]).eq(0);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39000));
    delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq("4390243902439024390243902439024"); // ~4.39
    expect((await vault.validateLiquidation(alice.address, btc.address, btc.address, true, false))[0]).eq(0);

    await expect(
      vault.liquidatePosition(alice.address, btc.address, btc.address, true, user.address),
    ).to.be.revertedWith("Vault: position cannot be liquidated");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(38700));
    delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq("5048780487804878048780487804878"); // ~5.04
    expect((await vault.validateLiquidation(alice.address, btc.address, btc.address, true, false))[0]).eq(1);

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(9.91)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toUsd(41000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(225000); // reserveAmount, 0.00225 * 40,000 => 90

    expect(await vault.feeReserves(btc.address)).eq(969);
    expect(await vault.reservedAmounts(btc.address)).eq(225000);
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.09));
    expect(await vault.poolAmounts(btc.address)).eq(274250 - 219);
    expect(await btc.balanceOf(user.address)).eq(0);

    expect(await vault.inPrivateLiquidationMode()).eq(false);
    await vault.setInPrivateLiquidationMode(true);
    expect(await vault.inPrivateLiquidationMode()).eq(true);

    await expect(
      vault.connect(bob).liquidatePosition(alice.address, btc.address, btc.address, true, user.address),
    ).to.be.revertedWith("Vault: invalid liquidator");

    expect(await vault.isLiquidator(bob.address)).eq(false);
    await vault.setLiquidator(bob.address, true);
    expect(await vault.isLiquidator(bob.address)).eq(true);

    expect(await xlxManager.getAumInUsdg(false)).eq("99064997000000000000"); // 99.064997
    expect(await xlxManager.getAumInUsdg(true)).eq("101418485000000000000"); // 101.418485

    const tx = await vault
      .connect(bob)
      .liquidatePosition(alice.address, btc.address, btc.address, true, user.address);
    await reportGasUsed(tx, "liquidatePosition gas used");

    expect(await xlxManager.getAumInUsdg(false)).eq("101522097000000000000"); // 101.522097
    expect(await xlxManager.getAumInUsdg(true)).eq("114113985000000000000"); // 114.113985

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount

    expect(await vault.feeReserves(btc.address)).eq(1175);
    expect(await vault.reservedAmounts(btc.address)).eq(0);
    expect(await vault.guaranteedUsd(btc.address)).eq(0);
    expect(await vault.poolAmounts(btc.address)).eq(262756 - 219 - 206);
    expect(await btc.balanceOf(user.address)).eq(11494); // 0.00011494 * 43500 => ~5

    expect(await btc.balanceOf(vault.address)).eq(263506);

    const balance = await btc.balanceOf(vault.address);
    const poolAmount = await vault.poolAmounts(btc.address);
    const feeReserve = await vault.feeReserves(btc.address);
    expect(poolAmount.add(feeReserve).sub(balance)).eq(0);

    await vault.withdrawFees(btc.address, alice.address);

    await btc.mint(vault.address, 1000);
    await vault.buyUSDG(btc.address, bob.address);
  });

  it("automatic stop-loss", async () => {
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await expect(
      vault.connect(alice).liquidatePosition(alice.address, btc.address, btc.address, true, user.address),
    ).to.be.revertedWith("Vault: empty position");

    await btc.mint(bob.address, toWei(1, 8));
    await btc.connect(bob).transfer(vault.address, 5000000); // 0.05 BTC => 2000 USD
    await vault.buyUSDG(btc.address, bob.address);

    await btc.mint(bob.address, toWei(1, 8));
    await btc.connect(bob).transfer(vault.address, 250000); // 0.0025 BTC => 100 USD
    await vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(1000), true);

    let position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(1000)); // size
    expect(position[1]).eq(toUsd(99)); // collateral, 100 - 1000 * 0.1%
    expect(position[2]).eq(toUsd(41000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq("2500000"); // reserveAmount, 0.025 * 40,000 => 1000

    expect((await vault.validateLiquidation(alice.address, btc.address, btc.address, true, false))[0]).eq(0);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(43500));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(43500));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(43500));

    let delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(true);
    expect(delta[1]).eq("60975609756097560975609756097560"); // ~60.9756097561
    expect((await vault.validateLiquidation(alice.address, btc.address, btc.address, true, false))[0]).eq(0);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39000));
    delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq("48780487804878048780487804878048"); // ~48.7804878049
    expect((await vault.validateLiquidation(alice.address, btc.address, btc.address, true, false))[0]).eq(0);

    await expect(
      vault.liquidatePosition(alice.address, btc.address, btc.address, true, user.address),
    ).to.be.revertedWith("Vault: position cannot be liquidated");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(37760));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(37760));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(37760));

    delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq("79024390243902439024390243902439"); // ~79.0243902439
    expect((await vault.validateLiquidation(alice.address, btc.address, btc.address, true, false))[0]).eq(2);

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(1000)); // size
    expect(position[1]).eq(toUsd(99)); // collateral, 100 - 1000 * 0.1%
    expect(position[2]).eq(toUsd(41000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq("2500000"); // reserveAmount, 0.025 * 40,000 => 1000

    expect(await vault.feeReserves(btc.address)).eq("17439");
    expect(await vault.reservedAmounts(btc.address)).eq("2500000");
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(901));
    expect(await vault.poolAmounts(btc.address)).eq(5000000 + 250000 - 17439);
    expect(await btc.balanceOf(deployer.address)).eq(0);
    expect(await btc.balanceOf(alice.address)).eq(0);
    expect(await btc.balanceOf(bob.address)).eq("194750000");
    expect(await btc.balanceOf(user.address)).eq(0);

    const tx = await vault.liquidatePosition(alice.address, btc.address, btc.address, true, user.address);
    await reportGasUsed(tx, "liquidatePosition gas used");

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount

    expect(await vault.feeReserves(btc.address)).eq(17439 + 2648);
    expect(await vault.reservedAmounts(btc.address)).eq(0);
    expect(await vault.guaranteedUsd(btc.address)).eq(0);
    expect(await vault.poolAmounts(btc.address)).eq(5000000 + 250000 - 17439 - 2648 - 50253);
    expect(await btc.balanceOf(deployer.address)).eq(0);
    expect(await btc.balanceOf(alice.address)).eq("50253"); // 50253 / (10**8) * 37760 => 18.9755328
    expect(await btc.balanceOf(bob.address)).eq("194750000");
    expect(await btc.balanceOf(user.address)).eq(0);

    expect(await btc.balanceOf(vault.address)).eq(5000000 + 250000 - 50253);

    const balance = await btc.balanceOf(vault.address);
    const poolAmount = await vault.poolAmounts(btc.address);
    const feeReserve = await vault.feeReserves(btc.address);
    expect(poolAmount.add(feeReserve).sub(balance)).eq(0);

    await vault.withdrawFees(btc.address, alice.address);

    await btc.mint(vault.address, 1000);
    await vault.buyUSDG(btc.address, bob.address);
  });

  it("excludes AMM price", async () => {
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(600));
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));

    const avaxUsdc = (await ship.deploy(PancakePair__factory)).contract;
    await avaxUsdc.setReserves(toWei(1000, 18), toWei(1000 * 1000, 18));

    const ethAvax = (await ship.deploy(PancakePair__factory)).contract;
    await ethAvax.setReserves(toWei(800, 18), toWei(100, 18));

    const btcAvax = (await ship.deploy(PancakePair__factory)).contract;
    await btcAvax.setReserves(toWei(25, 18), toWei(1000, 18));

    await vaultPriceFeed.setTokens(btc.address, eth.address, avax.address);
    await vaultPriceFeed.setPairs(avaxUsdc.address, ethAvax.address, btcAvax.address);

    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btc.mint(bob.address, toWei(1, 8));
    await btc.connect(bob).transfer(vault.address, 250000); // 0.0025 BTC => 100 USD
    await vault.buyUSDG(btc.address, bob.address);

    await btc.mint(alice.address, toWei(1, 8));
    await btc.connect(bob).transfer(vault.address, 25000); // 0.00025 BTC => 10 USD
    await vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(90), true);

    let position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(9.91)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toUsd(41000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(225000); // reserveAmount, 0.00225 * 40,000 => 90

    expect((await vault.validateLiquidation(alice.address, btc.address, btc.address, true, false))[0]).eq(0);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(43500));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(43500));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(43500));

    let delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(true);
    expect(delta[1]).eq("5487804878048780487804878048780"); // ~5.4878
    expect((await vault.validateLiquidation(alice.address, btc.address, btc.address, true, false))[0]).eq(0);

    await btcAvax.setReserves(toWei(26, 18), toWei(1000, 18));
    delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(true);
    expect(delta[1]).eq("5487804878048780487804878048780"); // ~5.4878
    expect((await vault.validateLiquidation(alice.address, btc.address, btc.address, true, false))[0]).eq(0);

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(9.91)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toUsd(41000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(225000); // reserveAmount, 0.00225 * 40,000 => 90

    expect(await vault.feeReserves(btc.address)).eq(969);
    expect(await vault.reservedAmounts(btc.address)).eq(225000);
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.09));
    expect(await vault.poolAmounts(btc.address)).eq(274250 - 219);
    expect(await btc.balanceOf(user.address)).eq(0);

    await expect(
      vault.liquidatePosition(alice.address, btc.address, btc.address, true, user.address),
    ).to.be.revertedWith("Vault: position cannot be liquidated");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(38700));

    const tx = await vault.liquidatePosition(alice.address, btc.address, btc.address, true, user.address);
    await reportGasUsed(tx, "liquidatePosition gas used");

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount

    expect(await vault.feeReserves(btc.address)).eq(1175);
    expect(await vault.reservedAmounts(btc.address)).eq(0);
    expect(await vault.guaranteedUsd(btc.address)).eq(0);
    expect(await vault.poolAmounts(btc.address)).eq(262756 - 219 - 206);
    expect(await btc.balanceOf(user.address)).eq(11494); // 0.00011494 * 43500 => ~5
  });
});
