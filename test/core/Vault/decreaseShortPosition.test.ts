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
import { advanceTimeAndBlock, reportGasUsed, Ship, toChainlinkPrice, toUsd, toWei } from "../../../utils";

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

describe("Vault.decreaseShortPosition", function () {
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

  it("decreasePosition short", async () => {
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
    await expect(
      vault.connect(bob).decreasePosition(alice.address, btc.address, btc.address, 0, 0, false, user.address),
    ).to.be.revertedWith("Vault: invalid msg.sender");

    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    await expect(
      vault
        .connect(alice)
        .decreasePosition(alice.address, usdc.address, btc.address, 0, toUsd(1000), false, user.address),
    ).to.be.revertedWith("Vault: empty position");

    await usdc.mint(alice.address, toWei(1000, 6));
    await usdc.connect(alice).transfer(vault.address, toWei(100, 6));
    await vault.buyUSDG(usdc.address, bob.address);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    expect(await xlxManager.getAumInUsdg(false), "aum min 0").eq("99960000000000000000"); // 99.96
    expect(await xlxManager.getAumInUsdg(true), "aum max 0").eq("99960000000000000000"); // 99.96

    await usdc.connect(alice).transfer(vault.address, toWei(10, 6));
    await vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(90), false);

    expect(await xlxManager.getAumInUsdg(false), "aum min 1").eq("99960000000000000000"); // 99.96
    expect(await xlxManager.getAumInUsdg(true), "aum max 1").eq("102210000000000000000"); // 102.21

    let position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(9.91)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toUsd(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(toWei(90, 6)); // reserveAmount
    expect(position[5]).eq(0); // pnl
    expect(position[6]).eq(true); // hasRealisedProfit

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(44000));
    let delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(toUsd(9));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(1));
    delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(toUsd(9));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(1));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(1));
    delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(true);
    expect(delta[1]).eq(toUsd(89.99775));

    let leverage = await vault.getPositionLeverage(alice.address, usdc.address, btc.address, false);
    expect(leverage).eq(90817); // ~9X leverage

    await expect(
      vault
        .connect(alice)
        .decreasePosition(alice.address, usdc.address, btc.address, 0, toUsd(100), false, user.address),
    ).to.be.revertedWith("Vault: position size exceeded");

    await expect(
      vault
        .connect(alice)
        .decreasePosition(alice.address, usdc.address, btc.address, toUsd(5), toUsd(50), false, user.address),
    ).to.be.revertedWith("Vault: liquidation fees exceed collateral");

    expect(await vault.feeReserves(usdc.address)).eq("130000"); // 0.13, 0.4 + 0.9
    expect(await vault.reservedAmounts(usdc.address)).eq(toWei(90, 6));
    expect(await vault.guaranteedUsd(usdc.address)).eq(0);
    expect(await vault.poolAmounts(usdc.address)).eq("99960000"); // 99.96
    expect(await usdc.balanceOf(user.address)).eq(0);

    expect(await xlxManager.getAumInUsdg(false), "aum min 2").eq("9962250000000000000"); // 9.96225
    expect(await xlxManager.getAumInUsdg(true), "aum max 2").eq("9962250000000000000"); // 9.96225

    const tx = await vault
      .connect(alice)
      .decreasePosition(alice.address, usdc.address, btc.address, toUsd(3), toUsd(50), false, user.address);
    await reportGasUsed(tx, "decreasePosition gas used");

    expect(await xlxManager.getAumInUsdg(false), "aum min 3").eq("9962250000000000000"); // 9.96225
    expect(await xlxManager.getAumInUsdg(true), "aum max 3").eq("9962250000000000000"); // 9.96225

    position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(toUsd(40)); // size
    expect(position[1]).eq(toUsd(9.91 - 3)); // collateral
    expect(position[2]).eq(toUsd(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(toWei(40, 6)); // reserveAmount
    expect(position[5]).eq(toUsd(49.99875)); // pnl
    expect(position[6]).eq(true); // hasRealisedProfit

    expect(await vault.feeReserves(usdc.address)).eq("180000"); // 0.18, 0.4 + 0.9 + 0.5
    expect(await vault.reservedAmounts(usdc.address)).eq(toWei(40, 6));
    expect(await vault.guaranteedUsd(usdc.address)).eq(0);
    expect(await vault.poolAmounts(usdc.address)).eq("49961250"); // 49.96125
    expect(await usdc.balanceOf(user.address)).eq("52948750"); // 52.94875

    // (9.91-3) + 0.44 + 49.70125 + 52.94875 => 110

    leverage = await vault.getPositionLeverage(alice.address, usdc.address, btc.address, false);
    expect(leverage).eq(57887); // ~5.8X leverage
  });

  it("decreasePosition short minProfitBasisPoints", async () => {
    await vault.setFees(
      50, // _taxBasisPoints
      10, // _stableTaxBasisPoints
      4, // _mintBurnFeeBasisPoints
      30, // _swapFeeBasisPoints
      4, // _stableSwapFeeBasisPoints
      10, // _marginFeeBasisPoints
      toUsd(5), // _liquidationFeeUsd
      60 * 60, // _minProfitTime
      false, // _hasDynamicFees
    );

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));
    await expect(
      vault.connect(bob).decreasePosition(alice.address, btc.address, btc.address, 0, 0, false, user.address),
    ).to.be.revertedWith("Vault: invalid msg.sender");

    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    await expect(
      vault
        .connect(alice)
        .decreasePosition(alice.address, usdc.address, btc.address, 0, toUsd(1000), false, user.address),
    ).to.be.revertedWith("Vault: empty position");

    await usdc.mint(alice.address, toWei(1000, 6));
    await usdc.connect(alice).transfer(vault.address, toWei(100, 6));
    await vault.buyUSDG(usdc.address, bob.address);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    expect(await xlxManager.getAumInUsdg(false), "aum min 4").eq("99960000000000000000"); // 99.96
    expect(await xlxManager.getAumInUsdg(true), "aum max 4").eq("99960000000000000000"); // 99.96

    await usdc.connect(alice).transfer(vault.address, toWei(10, 6));
    await vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(90), false);

    expect(await xlxManager.getAumInUsdg(false), "aum min 5").eq("99960000000000000000"); // 99.96
    expect(await xlxManager.getAumInUsdg(true), "aum max 5").eq("102210000000000000000"); // 102.21

    const position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(9.91)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toUsd(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(toWei(90, 6)); // reserveAmount
    expect(position[5]).eq(0); // pnl
    expect(position[6]).eq(true); // hasRealisedProfit

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39701)); // 40,000 * (100 - 0.75)% => 39700
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39701));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39701));
    let delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(true);
    expect(delta[1]).eq(toUsd(0));

    await advanceTimeAndBlock(50 * 60);

    delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(true);
    expect(delta[1]).eq("0");

    await advanceTimeAndBlock(10 * 60 + 10);

    delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(true);
    expect(delta[1]).eq("672750000000000000000000000000"); // 0.67275
  });

  it("decreasePosition short with loss", async () => {
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

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    expect(await xlxManager.getAumInUsdg(false), "aum min 6").eq("99960000000000000000"); // 99.96
    expect(await xlxManager.getAumInUsdg(true), "aum max 6").eq("99960000000000000000"); // 99.96

    await usdc.connect(alice).transfer(vault.address, toWei(10, 6));
    await vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(90), false);

    expect(await xlxManager.getAumInUsdg(false), "aum min 7").eq("99960000000000000000"); // 99.96
    expect(await xlxManager.getAumInUsdg(true), "aum max 7").eq("102210000000000000000"); // 102.21

    let position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(9.91)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toUsd(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(toWei(90, 6)); // reserveAmount
    expect(position[5]).eq(0); // pnl
    expect(position[6]).eq(true); // hasRealisedProfit

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40400));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40400));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40400));
    const delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(toUsd(0.9));

    const leverage = await vault.getPositionLeverage(alice.address, usdc.address, btc.address, false);
    expect(leverage).eq(90817); // ~9X leverage

    expect(await vault.feeReserves(usdc.address)).eq("130000"); // 0.13
    expect(await vault.reservedAmounts(usdc.address)).eq(toWei(90, 6));
    expect(await vault.guaranteedUsd(usdc.address)).eq(0);
    expect(await vault.poolAmounts(usdc.address)).eq("99960000"); // 99.96
    expect(await usdc.balanceOf(user.address)).eq(0);

    await expect(
      vault
        .connect(alice)
        .decreasePosition(alice.address, usdc.address, btc.address, toUsd(4), toUsd(50), false, user.address),
    ).to.be.revertedWith("Vault: liquidation fees exceed collateral");

    expect(await xlxManager.getAumInUsdg(false), "aum min 7").eq("100860000000000000000"); // 100.86
    expect(await xlxManager.getAumInUsdg(true), "aum max 7").eq("100860000000000000000"); // 100.86

    await vault
      .connect(alice)
      .decreasePosition(alice.address, usdc.address, btc.address, toUsd(0), toUsd(50), false, user.address);

    expect(await xlxManager.getAumInUsdg(false), "aum min 8").eq("100860000000000000000"); // 100.86
    expect(await xlxManager.getAumInUsdg(true), "aum max 8").eq("100860000000000000000"); // 100.86

    position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(toUsd(40)); // size
    expect(position[1]).eq(toUsd(9.36)); // collateral, 9.91 - 0.5 (losses) - 0.05 (fees)
    expect(position[2]).eq(toUsd(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(toWei(40, 6)); // reserveAmount
    expect(position[5]).eq(toUsd(0.5)); // pnl
    expect(position[6]).eq(false); // hasRealisedProfit

    expect(await vault.feeReserves(usdc.address)).eq("180000"); // 0.18
    expect(await vault.reservedAmounts(usdc.address)).eq(toWei(40, 6)); // 40
    expect(await vault.guaranteedUsd(usdc.address)).eq(0);
    expect(await vault.poolAmounts(usdc.address)).eq("100460000"); // 100.46
    expect(await usdc.balanceOf(user.address)).eq(0);

    await vault
      .connect(alice)
      .decreasePosition(alice.address, usdc.address, btc.address, toUsd(0), toUsd(40), false, user.address);

    position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount
    expect(position[5]).eq(0); // pnl
    expect(position[6]).eq(true); // hasRealisedProfit

    expect(await vault.feeReserves(usdc.address)).eq("220000"); // 0.22
    expect(await vault.reservedAmounts(usdc.address)).eq(0);
    expect(await vault.guaranteedUsd(usdc.address)).eq(0);
    expect(await vault.poolAmounts(usdc.address)).eq("100860000"); // 100.86
    expect(await usdc.balanceOf(user.address)).eq("8920000"); // 8.92
  });
});
