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

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let vault: Vault;
let vaultPriceFeed: VaultPriceFeed;
let btc: Token;
let btcPriceFeed: PriceFeed;
let avax: Token;
let avaxPriceFeed: PriceFeed;
let usdc: Token;
let usdcPriceFeed: PriceFeed;

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

describe("Vault.withdrawCollateral", function () {
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

  it("withdraw collateral", async () => {
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btc.mint(bob.address, toWei(1, 8));
    await btc.connect(bob).transfer(vault.address, 250000); // 0.0025 BTC => 100 USD
    await vault.buyUSDG(btc.address, bob.address);

    await btc.mint(alice.address, toWei(1, 8));
    await btc.connect(bob).transfer(vault.address, 25000); // 0.00025 BTC => 10 USD
    await expect(
      vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(110), true),
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    await vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(90), true);

    let position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(9.91)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toUsd(41000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(225000); // reserveAmount, 0.00225 * 40,000 => 90

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(45100));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(46100));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(47100));

    let leverage = await vault.getPositionLeverage(alice.address, btc.address, btc.address, true);
    expect(leverage).eq(90817); // ~9X leverage

    expect(await vault.feeReserves(btc.address)).eq(969);
    expect(await vault.reservedAmounts(btc.address)).eq(225000);
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.09));
    expect(await vault.poolAmounts(btc.address)).eq(274250 - 219);
    expect(await btc.balanceOf(user.address)).eq(0);

    const tx0 = await vault
      .connect(alice)
      .decreasePosition(alice.address, btc.address, btc.address, toUsd(3), toUsd(50), true, user.address);
    await reportGasUsed(tx0, "decreasePosition gas used");

    leverage = await vault.getPositionLeverage(alice.address, btc.address, btc.address, true);
    expect(leverage).eq(57887); // ~5.8X leverage

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(40)); // size
    expect(position[1]).eq(toUsd(9.91 - 3)); // collateral
    expect(position[2]).eq(toUsd(41000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq((225000 / 90) * 40); // reserveAmount, 0.00225 * 40,000 => 90
    expect(position[5]).eq(toUsd(5)); // pnl
    expect(position[6]).eq(true);

    expect(await vault.feeReserves(btc.address)).eq(969 + 106); // 0.00000106 * 45100 => ~0.05 USD
    expect(await vault.reservedAmounts(btc.address)).eq((225000 / 90) * 40);
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(33.09));
    expect(await vault.poolAmounts(btc.address)).eq(274250 - 16878 - 106 - 1 - 219);
    expect(await btc.balanceOf(user.address)).eq(16878); // 0.00016878 * 47100 => 7.949538 USD

    await expect(
      vault
        .connect(alice)
        .decreasePosition(alice.address, btc.address, btc.address, toUsd(3), 0, true, user.address),
    ).to.be.revertedWith("Vault: liquidation fees exceed collateral");

    const tx1 = await vault
      .connect(alice)
      .decreasePosition(alice.address, btc.address, btc.address, toUsd(1), 0, true, user.address);
    await reportGasUsed(tx1, "withdraw collateral gas used");

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(40)); // size
    expect(position[1]).eq(toUsd(9.91 - 3 - 1)); // collateral
    expect(position[2]).eq(toUsd(41000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq((225000 / 90) * 40); // reserveAmount, 0.00225 * 40,000 => 90
    expect(position[5]).eq(toUsd(5)); // pnl
    expect(position[6]).eq(true);

    expect(await vault.feeReserves(btc.address)).eq(969 + 106); // 0.00000106 * 45100 => ~0.05 USD
    expect(await vault.reservedAmounts(btc.address)).eq((225000 / 90) * 40);
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(34.09));
    expect(await vault.poolAmounts(btc.address)).eq(274250 - 16878 - 106 - 1 - 2123 - 219); // 0.00002123* 47100 => 1 USD
    expect(await btc.balanceOf(user.address)).eq(16878 + 2123);
  });

  it("withdraw during cooldown duration", async () => {
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btc.mint(bob.address, toWei(1, 8));
    await btc.connect(bob).transfer(vault.address, 250000); // 0.0025 BTC => 100 USD
    await vault.buyUSDG(btc.address, bob.address);

    await btc.mint(alice.address, toWei(1, 8));
    await btc.connect(bob).transfer(vault.address, 25000); // 0.00025 BTC => 10 USD
    await expect(
      vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(110), true),
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    await vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(90), true);
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(45100));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(46100));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(47100));

    // it's okay to withdraw AND decrease size with at least same proportion (e.g. if leverage is decreased or the same)
    await vault
      .connect(alice)
      .decreasePosition(alice.address, btc.address, btc.address, toUsd(1), toUsd(10), true, user.address);

    // it's also okay to fully close position
    const position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    await vault
      .connect(alice)
      .decreasePosition(
        alice.address,
        btc.address,
        btc.address,
        position[1],
        position[0],
        true,
        user.address,
      );

    await btc.connect(bob).transfer(vault.address, 25000); // 0.00025 BTC => 10 USD
    await vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(30), true);
  });

  it("withdraw collateral long", async () => {
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(500));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(500));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(500));

    await avax.mint(vault.address, toWei(10, 18));
    await vault.buyUSDG(avax.address, bob.address);

    expect(await xlxManager.getAumInUsdg(false)).eq("4985000000000000000000"); // 4985
    expect(await xlxManager.getAumInUsdg(true)).eq("4985000000000000000000"); // 4985

    await avax.mint(vault.address, toWei(1, 18));
    await vault.connect(alice).increasePosition(alice.address, avax.address, avax.address, toUsd(2000), true);

    expect(await xlxManager.getAumInUsdg(false)).eq("4985000000000000000000"); // 4985
    expect(await xlxManager.getAumInUsdg(true)).eq("4985000000000000000000"); // 4985

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(750));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(750));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(750));

    expect(await xlxManager.getAumInUsdg(false)).eq("6726500000000000000000"); // 6726.5
    expect(await xlxManager.getAumInUsdg(true)).eq("6726500000000000000000"); // 6726.5

    await avax.mint(vault.address, toWei(1, 18));
    await vault.connect(alice).increasePosition(alice.address, avax.address, avax.address, toUsd(0), true);

    expect(await xlxManager.getAumInUsdg(false)).eq("6726500000000000000000"); // 6726.5
    expect(await xlxManager.getAumInUsdg(true)).eq("6726500000000000000000"); // 6726.5

    await vault
      .connect(alice)
      .decreasePosition(alice.address, avax.address, avax.address, toUsd(500), toUsd(0), true, user.address);

    expect(await xlxManager.getAumInUsdg(false)).eq("6726500000000000000500"); // 6726.5000000000000005
    expect(await xlxManager.getAumInUsdg(true)).eq("6726500000000000000500"); // 6726.5000000000000005

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(400));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(400));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(400));

    expect(await xlxManager.getAumInUsdg(false)).eq("4171733333333333333600"); // 4171.7333333333333336
    expect(await xlxManager.getAumInUsdg(true)).eq("4171733333333333333600"); // 4171.7333333333333336

    await vault
      .connect(alice)
      .decreasePosition(alice.address, avax.address, avax.address, toUsd(250), toUsd(0), true, user.address);

    expect(await xlxManager.getAumInUsdg(false)).eq("4171733333333333333600"); // 4171.7333333333333336
    expect(await xlxManager.getAumInUsdg(true)).eq("4171733333333333333600"); // 4171.7333333333333336

    await vault
      .connect(alice)
      .decreasePosition(alice.address, avax.address, avax.address, toUsd(0), toUsd(250), true, user.address);

    expect(await xlxManager.getAumInUsdg(false)).eq("4171733333333333333600"); // 4171.7333333333333336
    expect(await xlxManager.getAumInUsdg(true)).eq("4171733333333333333600"); // 4171.7333333333333336
  });

  it("withdraw collateral short", async () => {
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(500));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(500));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(500));

    await usdc.mint(vault.address, toWei(8000, 6));
    await vault.buyUSDG(usdc.address, bob.address);

    expect(await xlxManager.getAumInUsdg(false)).eq("7976000000000000000000"); // 7976
    expect(await xlxManager.getAumInUsdg(true)).eq("7976000000000000000000"); // 7976

    await usdc.mint(vault.address, toWei(500, 6));
    await vault
      .connect(alice)
      .increasePosition(alice.address, usdc.address, avax.address, toUsd(2000), false);

    expect(await xlxManager.getAumInUsdg(false)).eq("7976000000000000000000"); // 7976
    expect(await xlxManager.getAumInUsdg(true)).eq("7976000000000000000000"); // 7976

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(525));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(525));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(525));

    expect(await xlxManager.getAumInUsdg(false)).eq("8076000000000000000000"); // 8076
    expect(await xlxManager.getAumInUsdg(true)).eq("8076000000000000000000"); // 8076

    await usdc.mint(vault.address, toWei(500, 6));
    await vault.connect(alice).increasePosition(alice.address, usdc.address, avax.address, toUsd(0), false);

    expect(await xlxManager.getAumInUsdg(false)).eq("8076000000000000000000"); // 8076
    expect(await xlxManager.getAumInUsdg(true)).eq("8076000000000000000000"); // 8076

    await vault
      .connect(alice)
      .decreasePosition(alice.address, usdc.address, avax.address, toUsd(500), toUsd(0), false, user.address);

    expect(await xlxManager.getAumInUsdg(false)).eq("8076000000000000000000"); // 8076
    expect(await xlxManager.getAumInUsdg(true)).eq("8076000000000000000000"); // 8076

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(475));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(475));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(475));

    expect(await xlxManager.getAumInUsdg(false)).eq("7876000000000000000000"); // 7876
    expect(await xlxManager.getAumInUsdg(true)).eq("7876000000000000000000"); // 7876

    await vault
      .connect(alice)
      .decreasePosition(alice.address, usdc.address, avax.address, toUsd(0), toUsd(500), false, user.address);

    expect(await xlxManager.getAumInUsdg(false)).eq("7876000000000000000000"); // 7876
    expect(await xlxManager.getAumInUsdg(true)).eq("7876000000000000000000"); // 7876
  });
});
