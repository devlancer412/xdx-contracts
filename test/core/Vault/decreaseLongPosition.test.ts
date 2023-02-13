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
import { validateVaultBalance } from "./shared";

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

describe("Vault.decreaseLongPosition", function () {
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

  it("decreasePosition long", async () => {
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));

    await expect(
      vault.connect(bob).decreasePosition(alice.address, btc.address, btc.address, 0, 0, true, user.address),
    ).to.be.revertedWith("Vault: invalid msg.sender");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await expect(
      vault
        .connect(alice)
        .decreasePosition(alice.address, btc.address, btc.address, 0, toUsd(1000), true, user.address),
    ).to.be.revertedWith("Vault: empty position");

    await btc.mint(bob.address, toWei(1, 8));
    await btc.connect(bob).transfer(vault.address, 250000); // 0.0025 BTC => 100 USD
    await vault.buyUSDG(btc.address, bob.address);

    await btc.mint(alice.address, toWei(1, 8));
    await btc.connect(bob).transfer(vault.address, 25000); // 0.00025 BTC => 10 USD
    await expect(
      vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(110), true),
    ).to.be.revertedWith("Vault: reserve exceeds pool");

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

    // test that minProfitBasisPoints works as expected
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000 - 1));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000 - 1));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000 - 1));
    let delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq("2195121951219512195121951219"); // ~0.00219512195 USD

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000 + 307)); // 41000 * 0.75% => 307.5
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000 + 307));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000 + 307));
    delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(true);
    expect(delta[1]).eq("0");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000 + 308));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000 + 308));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000 + 308));
    delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(true);
    expect(delta[1]).eq("676097560975609756097560975609"); // ~0.676 USD

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(45100));

    delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq("2195121951219512195121951219512"); // ~2.1951

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(46100));
    delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq("2195121951219512195121951219512"); // ~2.1951

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(47100));
    delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(true);
    expect(delta[1]).eq(toUsd(9));

    let leverage = await vault.getPositionLeverage(alice.address, btc.address, btc.address, true);
    expect(leverage).eq(90817); // ~9X leverage

    await expect(
      vault
        .connect(alice)
        .decreasePosition(alice.address, btc.address, btc.address, 0, toUsd(100), true, user.address),
    ).to.be.revertedWith("Vault: position size exceeded");

    await expect(
      vault
        .connect(alice)
        .decreasePosition(
          alice.address,
          btc.address,
          btc.address,
          toUsd(8.91),
          toUsd(50),
          true,
          user.address,
        ),
    ).to.be.revertedWith("Vault: liquidation fees exceed collateral");

    expect(await vault.feeReserves(btc.address)).eq(969);
    expect(await vault.reservedAmounts(btc.address)).eq(225000);
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.09));
    expect(await vault.poolAmounts(btc.address)).eq(274250 - 219);
    expect(await btc.balanceOf(user.address)).eq(0);

    expect(await xlxManager.getAumInUsdg(false)).eq("102202981000000000000"); // 102.202981
    expect(await xlxManager.getAumInUsdg(true)).eq("103183601000000000000"); // 103.183601

    const tx = await vault
      .connect(alice)
      .decreasePosition(alice.address, btc.address, btc.address, toUsd(3), toUsd(50), true, user.address);
    await reportGasUsed(tx, "decreasePosition gas used");

    expect(await xlxManager.getAumInUsdg(false)).eq("103917746000000000000"); // 103.917746
    expect(await xlxManager.getAumInUsdg(true)).eq("107058666000000000000"); // 107.058666

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
    expect(await vault.poolAmounts(btc.address)).eq(274250 - 219 - 16878 - 106 - 1);
    expect(await btc.balanceOf(user.address)).eq(16878); // 0.00016878 * 47100 => 7.949538 USD

    await validateVaultBalance(vault, btc, 1);
  });

  it("decreasePosition long aum", async () => {
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(500));

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(500));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(500));

    await avax.mint(vault.address, toWei(10, 18));
    await vault.buyUSDG(avax.address, bob.address);

    expect(await xlxManager.getAumInUsdg(false)).eq("4985000000000000000000"); // 4985
    expect(await xlxManager.getAumInUsdg(true)).eq("4985000000000000000000"); // 4985

    await avax.mint(vault.address, toWei(1, 18));
    await vault.connect(alice).increasePosition(alice.address, avax.address, avax.address, toUsd(1000), true);

    expect(await xlxManager.getAumInUsdg(false)).eq("4985000000000000000000"); // 4985
    expect(await xlxManager.getAumInUsdg(true)).eq("4985000000000000000000"); // 4985

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(750));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(750));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(750));

    expect(await xlxManager.getAumInUsdg(false)).eq("7227000000000000000000"); // 7227
    expect(await xlxManager.getAumInUsdg(true)).eq("7227000000000000000000"); // 7227

    await vault
      .connect(alice)
      .decreasePosition(alice.address, avax.address, avax.address, toUsd(0), toUsd(500), true, user.address);

    expect(await xlxManager.getAumInUsdg(false)).eq("7227000000000000000250"); // 7227.00000000000000025
    expect(await xlxManager.getAumInUsdg(true)).eq("7227000000000000000250"); // 7227.00000000000000025

    await vault
      .connect(alice)
      .decreasePosition(
        alice.address,
        avax.address,
        avax.address,
        toUsd(250),
        toUsd(100),
        true,
        user.address,
      );

    expect(await xlxManager.getAumInUsdg(false)).eq("7227000000000000000250"); // 7227.00000000000000025
    expect(await xlxManager.getAumInUsdg(true)).eq("7227000000000000000250"); // 7227.00000000000000025
  });

  it("decreasePosition long minProfitBasisPoints", async () => {
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));

    await expect(
      vault.connect(bob).decreasePosition(alice.address, btc.address, btc.address, 0, 0, true, user.address),
    ).to.be.revertedWith("Vault: invalid msg.sender");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await expect(
      vault
        .connect(alice)
        .decreasePosition(alice.address, btc.address, btc.address, 0, toUsd(1000), true, user.address),
    ).to.be.revertedWith("Vault: empty position");

    await btc.mint(bob.address, toWei(1, 8));
    await btc.connect(bob).transfer(vault.address, 250000); // 0.0025 BTC => 100 USD
    await vault.buyUSDG(btc.address, bob.address);

    await btc.mint(alice.address, toWei(1, 8));
    await btc.connect(bob).transfer(vault.address, 25000); // 0.00025 BTC => 10 USD
    await expect(
      vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(110), true),
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    await vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(90), true);

    const position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(9.91)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toUsd(41000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(225000); // reserveAmount, 0.00225 * 40,000 => 90

    // test that minProfitBasisPoints works as expected
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000 - 1));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000 - 1));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000 - 1));
    let delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq("2195121951219512195121951219"); // ~0.00219512195 USD

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000 + 307)); // 41000 * 0.75% => 307.5
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000 + 307));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000 + 307));
    delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(true);
    expect(delta[1]).eq("0");

    await advanceTimeAndBlock(50 * 60);

    delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(true);
    expect(delta[1]).eq("0");

    await advanceTimeAndBlock(10 * 60 + 10);

    delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(true);
    expect(delta[1]).eq("673902439024390243902439024390"); // 0.67390243902
  });

  it("decreasePosition long with loss", async () => {
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

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40790));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40690));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40590));

    expect(await vault.feeReserves(btc.address)).eq(969);
    expect(await vault.reservedAmounts(btc.address)).eq(225000);
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.09));
    expect(await vault.poolAmounts(btc.address)).eq(274250 - 219);
    expect(await btc.balanceOf(user.address)).eq(0);

    const delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(toUsd(0.9));

    await expect(
      vault
        .connect(alice)
        .decreasePosition(alice.address, btc.address, btc.address, toUsd(4), toUsd(50), true, user.address),
    ).to.be.revertedWith("liquidation fees exceed collateral");

    const tx = await vault
      .connect(alice)
      .decreasePosition(alice.address, btc.address, btc.address, toUsd(0), toUsd(50), true, user.address);
    await reportGasUsed(tx, "decreasePosition gas used");

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(40)); // size
    expect(position[1]).eq(toUsd(9.36)); // collateral
    expect(position[2]).eq(toUsd(41000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(100000); // reserveAmount, 0.00100 * 40,000 => 40
    expect(position[5]).eq(toUsd(0.5)); // pnl
    expect(position[6]).eq(false);

    expect(await vault.feeReserves(btc.address)).eq(969 + 122); // 0.00000122 * 40790 => ~0.05 USD
    expect(await vault.reservedAmounts(btc.address)).eq(100000);
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(30.64));
    expect(await vault.poolAmounts(btc.address)).eq(274250 - 219 - 122);
    expect(await btc.balanceOf(user.address)).eq(0);

    await vault
      .connect(alice)
      .decreasePosition(alice.address, btc.address, btc.address, toUsd(0), toUsd(40), true, user.address);

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount
    expect(position[5]).eq(0); // pnl
    expect(position[6]).eq(true);

    expect(await vault.feeReserves(btc.address)).eq(969 + 122 + 98); // 0.00000098 * 40790 => ~0.04 USD
    expect(await vault.reservedAmounts(btc.address)).eq(0);
    expect(await vault.guaranteedUsd(btc.address)).eq(0);
    expect(await vault.poolAmounts(btc.address)).eq(274250 - 219 - 122 - 98 - 21868);
    expect(await btc.balanceOf(user.address)).eq(21868); // 0.00021868 * 40790 => ~8.92 USD

    await validateVaultBalance(vault, btc);
  });
});
