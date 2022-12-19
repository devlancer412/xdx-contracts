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
import { getTime, reportGasUsed, Ship, toChainlinkPrice, toUsd, toWei } from "../../../utils";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let vault: Vault;
let vaultPriceFeed: VaultPriceFeed;
let btc: Token;
let btcPriceFeed: PriceFeed;
let usdc: Token;
let usdcPriceFeed: PriceFeed;
let avax: Token;
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

describe("Vault.increaseShortPosition", function () {
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
    avax = (await ship.connect("avax")) as Token;
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

  it("increasePosition short validations", async () => {
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));

    await vault.clearTokenConfig(usdc.address);

    await expect(
      vault.connect(bob).increasePosition(alice.address, usdc.address, btc.address, 0, false),
    ).to.be.revertedWith("Vault: invalid msg.sender");

    await expect(
      vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(1000), false),
    ).to.be.revertedWith("Vault: _collateralToken not whitelisted");

    await vault.setTokenConfig(
      usdc.address, // _token
      6, // _tokenDecimals
      10000, // _tokenWeight
      75, // _minProfitBps
      0, // _maxUsdgAmount
      true, // _isStable
      false, // _isShortable
    );

    await expect(
      vault.connect(alice).increasePosition(alice.address, avax.address, avax.address, toUsd(1000), false),
    ).to.be.revertedWith("Vault: _collateralToken must be a stableToken");
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));

    await expect(
      vault.connect(alice).increasePosition(alice.address, usdc.address, usdc.address, toUsd(1000), false),
    ).to.be.revertedWith("Vault: _indexToken must not be a stableToken");

    await vault.setTokenConfig(
      btc.address, // _token
      8, // _tokenDecimals
      10000, // _tokenWeight
      75, // _minProfitBps
      0, // _maxUsdgAmount
      false, // _isStable
      false, // _isShortable
    );

    await expect(
      vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(1000), false),
    ).to.be.revertedWith("Vault: _indexToken not shortable");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));

    await expect(
      vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(1000), false),
    ).to.be.revertedWith("Vault: _indexToken not shortable");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));

    await vault.setTokenConfig(
      btc.address, // _token
      8, // _tokenDecimals
      10000, // _tokenWeight
      75, // _minProfitBps
      0, // _maxUsdgAmount
      false, // _isStable
      true, // _isShortable
    );

    await expect(
      vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(1000), false),
    ).to.be.revertedWith("Vault: insufficient collateral for fees");
    await expect(
      vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, 0, false),
    ).to.be.revertedWith("Vault: invalid position.size");

    await usdc.mint(alice.address, toWei(1000, 18));
    await usdc.connect(alice).transfer(vault.address, toWei(9, 5));

    await expect(
      vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(1000), false),
    ).to.be.revertedWith("Vault: insufficient collateral for fees");

    await usdc.connect(alice).transfer(vault.address, toWei(4, 6));

    await expect(
      vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(1000), false),
    ).to.be.revertedWith("Vault: losses exceed collateral");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await expect(
      vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(100), false),
    ).to.be.revertedWith("Vault: liquidation fees exceed collateral");

    await usdc.connect(alice).transfer(vault.address, toWei(6, 6));

    await expect(
      vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(8), false),
    ).to.be.revertedWith("Vault: _size must be more than _collateral");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await expect(
      vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(600), false),
    ).to.be.revertedWith("Vault: maxLeverage exceeded");

    await expect(
      vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(100), false),
    ).to.be.revertedWith("Vault: reserve exceeds pool");
  });

  it("increasePosition short", async () => {
    await vault.setMaxGlobalShortSize(btc.address, toUsd(300));

    let globalDelta = await vault.getGlobalShortDelta(btc.address);
    expect(globalDelta[0]).eq(false);
    expect(globalDelta[1]).eq(0);
    expect(await xlxManager.getAumInUsdg(true)).eq(0);
    expect(await xlxManager.getAumInUsdg(false)).eq(0);

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

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(1000));

    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await usdc.mint(alice.address, toWei(1000, 6));
    await usdc.connect(alice).transfer(vault.address, toWei(500, 6));

    await expect(
      vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(99), false),
    ).to.be.revertedWith("Vault: _size must be more than _collateral");

    await expect(
      vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(501), false),
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    expect(await vault.feeReserves(usdc.address)).eq(0);
    expect(await vault.usdgAmounts(usdc.address)).eq(0);
    expect(await vault.poolAmounts(usdc.address)).eq(0);

    expect(await vault.getRedemptionCollateralUsd(usdc.address)).eq(0);
    await vault.buyUSDG(usdc.address, bob.address);
    expect(await vault.getRedemptionCollateralUsd(usdc.address)).eq("499800000000000000000000000000000");

    expect(await vault.feeReserves(usdc.address)).eq("200000"); // 0.2
    expect(await vault.usdgAmounts(usdc.address)).eq("499800000000000000000"); // 499.8
    expect(await vault.poolAmounts(usdc.address)).eq("499800000"); // 499.8

    globalDelta = await vault.getGlobalShortDelta(btc.address);
    expect(globalDelta[0]).eq(false);
    expect(globalDelta[1]).eq(0);
    expect(await xlxManager.getAumInUsdg(true)).eq("499800000000000000000");
    expect(await xlxManager.getAumInUsdg(false)).eq("499800000000000000000");

    await usdc.connect(alice).transfer(vault.address, toWei(20, 6));
    await expect(
      vault.connect(alice).increasePosition(alice.address, usdc.address, btc.address, toUsd(501), false),
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    expect(await vault.reservedAmounts(btc.address)).eq(0);
    expect(await vault.guaranteedUsd(btc.address)).eq(0);

    let position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit
    expect(position[7]).eq(0); // lastIncreasedTime

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    const tx = await vault
      .connect(alice)
      .increasePosition(alice.address, usdc.address, btc.address, toUsd(90), false);
    await reportGasUsed(tx, "increasePosition gas used");

    expect(await vault.poolAmounts(usdc.address)).eq("499800000");
    expect(await vault.reservedAmounts(usdc.address)).eq(toWei(90, 6));
    expect(await vault.guaranteedUsd(usdc.address)).eq(0);
    expect(await vault.getRedemptionCollateralUsd(usdc.address)).eq("499800000000000000000000000000000");

    const blockTime = await getTime();

    position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(19.91)); // collateral
    expect(position[2]).eq(toUsd(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(toWei(90, 6)); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit
    expect(position[7]).eq(blockTime); // lastIncreasedTime

    expect(await vault.feeReserves(usdc.address)).eq("290000"); // 0.29
    expect(await vault.usdgAmounts(usdc.address)).eq("499800000000000000000"); // 499.8
    expect(await vault.poolAmounts(usdc.address)).eq("499800000"); // 499.8

    expect(await vault.globalShortSizes(btc.address)).eq(toUsd(90));
    expect(await vault.globalShortAveragePrices(btc.address)).eq(toUsd(40000));

    globalDelta = await vault.getGlobalShortDelta(btc.address);
    expect(globalDelta[0]).eq(false);
    expect(globalDelta[1]).eq(toUsd(2.25));
    expect(await xlxManager.getAumInUsdg(true)).eq("502050000000000000000");
    expect(await xlxManager.getAumInUsdg(false)).eq("499800000000000000000");

    let delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(toUsd(2.25));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(42000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(42000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(42000));

    delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(toUsd(4.5));

    globalDelta = await vault.getGlobalShortDelta(btc.address);
    expect(globalDelta[0]).eq(false);
    expect(globalDelta[1]).eq(toUsd(4.5));
    expect(await xlxManager.getAumInUsdg(true)).eq("504300000000000000000"); // 499.8 + 4.5
    expect(await xlxManager.getAumInUsdg(false)).eq("504300000000000000000"); // 499.8 + 4.5

    await vault
      .connect(alice)
      .decreasePosition(alice.address, usdc.address, btc.address, toUsd(3), toUsd(50), false, user.address);

    position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(toUsd(40)); // size
    expect(position[1]).eq(toUsd(14.41)); // collateral
    expect(position[2]).eq(toUsd(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(toWei(40, 6)); // reserveAmount
    expect(position[5]).eq(toUsd(2.5)); // realisedPnl
    expect(position[6]).eq(false); // hasProfit
    expect(position[7]).eq(blockTime); // lastIncreasedTime

    delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(toUsd(2));

    expect(await vault.feeReserves(usdc.address)).eq("340000"); // 0.18
    expect(await vault.usdgAmounts(usdc.address)).eq("499800000000000000000"); // 499.8
    expect(await vault.poolAmounts(usdc.address)).eq("502300000"); // 502.3

    expect(await vault.globalShortSizes(btc.address)).eq(toUsd(40));
    expect(await vault.globalShortAveragePrices(btc.address)).eq(toUsd(40000));

    globalDelta = await vault.getGlobalShortDelta(btc.address);
    expect(globalDelta[0]).eq(false);
    expect(globalDelta[1]).eq(toUsd(2));
    expect(await xlxManager.getAumInUsdg(true)).eq("504300000000000000000"); // 499.8 + 4.5
    expect(await xlxManager.getAumInUsdg(false)).eq("504300000000000000000"); // 499.8 + 4.5

    await usdc.mint(vault.address, toWei(50, 6));
    await vault.connect(bob).increasePosition(bob.address, usdc.address, btc.address, toUsd(200), false);

    expect(await vault.globalShortSizes(btc.address)).eq(toUsd(240));
    expect(await vault.globalShortAveragePrices(btc.address)).eq("41652892561983471074380165289256198");

    globalDelta = await vault.getGlobalShortDelta(btc.address);
    expect(globalDelta[0]).eq(false);
    expect(globalDelta[1]).eq(toUsd(2));
    expect(await xlxManager.getAumInUsdg(true)).eq("504300000000000000000"); // 502.3 + 2
    expect(await xlxManager.getAumInUsdg(false)).eq("504300000000000000000"); // 502.3 + 2

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));

    delta = await vault.getPositionDelta(alice.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(toUsd(1));

    delta = await vault.getPositionDelta(bob.address, usdc.address, btc.address, false);
    expect(delta[0]).eq(true);
    expect(delta[1]).eq("4761904761904761904761904761904"); // 4.76

    globalDelta = await vault.getGlobalShortDelta(btc.address);
    expect(globalDelta[0]).eq(true);
    expect(globalDelta[1]).eq("3761904761904761904761904761904");
    expect(await xlxManager.getAumInUsdg(true)).eq("498538095238095238095"); // 502.3 + 1 - 4.76 => 498.53
    expect(await xlxManager.getAumInUsdg(false)).eq("492776190476190476190"); // 492.77619047619047619

    await usdc.mint(vault.address, toWei(20, 6));
    await vault.connect(user).increasePosition(user.address, usdc.address, btc.address, toUsd(60), false);

    expect(await vault.globalShortSizes(btc.address)).eq(toUsd(300));
    expect(await vault.globalShortAveragePrices(btc.address)).eq("41311475409836065573770491803278614");

    globalDelta = await vault.getGlobalShortDelta(btc.address);
    expect(globalDelta[0]).eq(true);
    expect(globalDelta[1]).eq("2261904761904761904761904761904");
    expect(await xlxManager.getAumInUsdg(true)).eq("500038095238095238095"); // 500.038095238095238095
    expect(await xlxManager.getAumInUsdg(false)).eq("492776190476190476190"); // 492.77619047619047619

    await usdc.mint(vault.address, toWei(20, 6));

    await expect(
      vault.connect(user).increasePosition(user.address, usdc.address, btc.address, toUsd(60), false),
    ).to.be.revertedWith("Vault: max shorts exceeded");
  });
});
