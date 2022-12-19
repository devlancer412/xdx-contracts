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

describe("Vault.increaseLongPosition", function () {
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

  it("increasePosition long validations", async () => {
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));
    await vault.setMaxGasPrice("20000000000"); // 20 gwei
    await expect(
      vault.connect(bob).increasePosition(alice.address, btc.address, btc.address, 0, true),
    ).to.be.revertedWith("Vault: invalid msg.sender");
    await expect(
      vault
        .connect(bob)
        .increasePosition(alice.address, btc.address, btc.address, 0, true, { gasPrice: "21000000000" }),
    ).to.be.revertedWith("Vault: maxGasPrice exceeded");
    await vault.setMaxGasPrice(0);
    await vault.setIsLeverageEnabled(false);
    await expect(
      vault
        .connect(bob)
        .increasePosition(alice.address, btc.address, btc.address, 0, true, { gasPrice: "21000000000" }),
    ).to.be.revertedWith("Vault: leverage not enabled");
    await vault.setIsLeverageEnabled(true);
    await vault.connect(alice).addRouter(bob.address);
    await expect(
      vault.connect(bob).increasePosition(alice.address, btc.address, avax.address, 0, true),
    ).to.be.revertedWith("Vault: mismatched tokens");
    await expect(
      vault.connect(alice).increasePosition(alice.address, btc.address, avax.address, toUsd(1000), true),
    ).to.be.revertedWith("Vault: mismatched tokens");
    await expect(
      vault.connect(alice).increasePosition(alice.address, usdc.address, usdc.address, toUsd(1000), true),
    ).to.be.revertedWith("Vault: _collateralToken must not be a stableToken");
    // await expect(
    //   vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(1000), true),
    // ).to.be.revertedWith("Vault: _collateralToken not whitelisted");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));

    await expect(
      vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(1000), true),
    ).to.be.revertedWith("Vault: insufficient collateral for fees");
    await expect(
      vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, 0, true),
    ).to.be.revertedWith("Vault: invalid position.size");

    await btc.mint(alice.address, toWei(1, 8));
    await btc.connect(alice).transfer(vault.address, 2500 - 1);

    await expect(
      vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(1000), true),
    ).to.be.revertedWith("Vault: insufficient collateral for fees");

    await btc.connect(alice).transfer(vault.address, 1);

    await expect(
      vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(1000), true),
    ).to.be.revertedWith("Vault: losses exceed collateral");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await expect(
      vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(1000), true),
    ).to.be.revertedWith("Vault: fees exceed collateral");

    await btc.connect(alice).transfer(vault.address, 10000);

    await expect(
      vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(1000), true),
    ).to.be.revertedWith("Vault: liquidation fees exceed collateral");

    await btc.connect(alice).transfer(vault.address, 10000);

    await expect(
      vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(500), true),
    ).to.be.revertedWith("Vault: maxLeverage exceeded");

    await expect(
      vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(8), true),
    ).to.be.revertedWith("Vault: _size must be more than _collateral");

    await expect(
      vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(47), true),
    ).to.be.revertedWith("Vault: reserve exceeds pool");
  });

  it("increasePosition long", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));

    await btc.mint(alice.address, toWei(1, 8));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btc.connect(alice).transfer(vault.address, 117500 - 1); // 0.001174 BTC => 47

    await expect(
      vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(118), true),
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    expect(await vault.feeReserves(btc.address)).eq(0);
    expect(await vault.usdgAmounts(btc.address)).eq(0);
    expect(await vault.poolAmounts(btc.address)).eq(0);

    expect(await xlxManager.getAumInUsdg(true)).eq(0);
    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(0);
    await vault.buyUSDG(btc.address, bob.address);
    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd(46.8584));
    expect(await xlxManager.getAumInUsdg(true)).eq("48029860000000000000"); // 48.02986
    expect(await xlxManager.getAumInUsdg(false)).eq("46858400000000000000"); // 46.8584

    expect(await vault.feeReserves(btc.address)).eq(353); // (117500 - 1) * 0.3% => 353
    expect(await vault.usdgAmounts(btc.address)).eq("46858400000000000000"); // (117500 - 1 - 353) * 40000
    expect(await vault.poolAmounts(btc.address)).eq(117500 - 1 - 353);

    await btc.connect(alice).transfer(vault.address, 117500 - 1);
    await expect(
      vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(200), true),
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    await vault.buyUSDG(btc.address, bob.address);

    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd(93.7168));
    expect(await xlxManager.getAumInUsdg(true)).eq("96059720000000000000"); // 96.05972
    expect(await xlxManager.getAumInUsdg(false)).eq("93716800000000000000"); // 93.7168

    expect(await vault.feeReserves(btc.address)).eq(353 * 2); // (117500 - 1) * 0.3% * 2
    expect(await vault.usdgAmounts(btc.address)).eq("93716800000000000000"); // (117500 - 1 - 353) * 40000 * 2
    expect(await vault.poolAmounts(btc.address)).eq((117500 - 1 - 353) * 2);

    await expect(
      vault.connect(alice).increasePosition(alice.address, btc.address, btc.address, toUsd(47), true),
    ).to.be.revertedWith("Vault: insufficient collateral for fees");

    await btc.connect(alice).transfer(vault.address, 22500);

    expect(await vault.reservedAmounts(btc.address)).eq(0);
    expect(await vault.guaranteedUsd(btc.address)).eq(0);

    let position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit
    expect(position[7]).eq(0); // lastIncreasedTime

    const tx = await vault
      .connect(alice)
      .increasePosition(alice.address, btc.address, btc.address, toUsd(47), true);
    await reportGasUsed(tx, "increasePosition gas used");

    const blockTime = await getTime();

    expect(await vault.poolAmounts(btc.address)).eq(256792 - 114);
    expect(await vault.reservedAmounts(btc.address)).eq(117500);
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(38.047));
    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd(92.79));
    expect(await xlxManager.getAumInUsdg(true)).eq("95109980000000000000"); // 95.10998
    expect(await xlxManager.getAumInUsdg(false)).eq("93718200000000000000"); // 93.7182

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(47)); // size
    expect(position[1]).eq(toUsd(8.953)); // collateral, 0.000225 BTC => 9, 9 - 0.047 => 8.953
    expect(position[2]).eq(toUsd(41000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(117500); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit
    expect(position[7]).eq(blockTime); // lastIncreasedTime

    expect(await vault.feeReserves(btc.address)).eq(353 * 2 + 114); // fee is 0.047 USD => 0.00000114 BTC
    expect(await vault.usdgAmounts(btc.address)).eq("93716800000000000000"); // (117500 - 1 - 353) * 40000 * 2
    expect(await vault.poolAmounts(btc.address)).eq((117500 - 1 - 353) * 2 + 22500 - 114);

    expect(await vault.globalShortSizes(btc.address)).eq(0);
    expect(await vault.globalShortAveragePrices(btc.address)).eq(0);

    await validateVaultBalance(vault, btc);
  });

  it("increasePosition long aum", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(100000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(100000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(100000));
    await btc.mint(alice.address, toWei(1, 8));
    await btc.connect(alice).transfer(vault.address, toWei(1, 8));

    expect(await vault.feeReserves(btc.address)).eq(0);
    expect(await vault.usdgAmounts(btc.address)).eq(0);
    expect(await vault.poolAmounts(btc.address)).eq(0);

    expect(await xlxManager.getAumInUsdg(true)).eq(0);
    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(0);
    await vault.buyUSDG(btc.address, bob.address);
    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd(99700));
    expect(await xlxManager.getAumInUsdg(true)).eq(toWei(99700, 18));

    expect(await vault.feeReserves(btc.address)).eq("300000"); // 0.003 BTC
    expect(await vault.usdgAmounts(btc.address)).eq(toWei(99700, 18));
    expect(await vault.poolAmounts(btc.address)).eq("99700000"); // 0.997

    await btc.mint(alice.address, toWei(5, 7));
    await btc.connect(alice).transfer(vault.address, toWei(5, 7));

    expect(await vault.reservedAmounts(btc.address)).eq(0);
    expect(await vault.guaranteedUsd(btc.address)).eq(0);

    let position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit
    expect(position[7]).eq(0); // lastIncreasedTime

    const tx = await vault
      .connect(alice)
      .increasePosition(alice.address, btc.address, btc.address, toUsd(80000), true);
    await reportGasUsed(tx, "increasePosition gas used");

    const blockTime = await getTime();

    expect(await vault.poolAmounts(btc.address)).eq("149620000"); // 1.4962 BTC
    expect(await vault.reservedAmounts(btc.address)).eq("80000000"); // 0.8 BTC
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(30080)); // 80000 - 49920
    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd(99700));
    expect(await xlxManager.getAumInUsdg(true)).eq(toWei(99700, 18));
    expect(await xlxManager.getAumInUsdg(false)).eq(toWei(99700, 18));

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(80000)); // size
    expect(position[1]).eq(toUsd(49920)); // collateral
    expect(position[2]).eq(toUsd(100000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq("80000000"); // 0.8 BTC
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit
    expect(position[7]).eq(blockTime); // lastIncreasedTime

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(150000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(150000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(150000));

    let delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(true);
    expect(delta[1]).eq(toUsd(40000));
    expect(await xlxManager.getAumInUsdg(true)).eq(toWei(134510, 18)); // 30080 + (1.4962-0.8)*150000
    expect(await xlxManager.getAumInUsdg(false)).eq(toWei(134510, 18)); // 30080 + (1.4962-0.8)*150000

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(75000));

    delta = await vault.getPositionDelta(alice.address, btc.address, btc.address, true);
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(toUsd(40000));
    expect(await xlxManager.getAumInUsdg(true)).eq(toWei(82295, 18)); // 30080 + (1.4962-0.8)*75000
    expect(await xlxManager.getAumInUsdg(false)).eq(toWei(64890, 18)); // 30080 + (1.4962-0.8)*50000

    await vault
      .connect(alice)
      .decreasePosition(alice.address, btc.address, btc.address, 0, toUsd(80000), true, user.address);

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit
    expect(position[7]).eq(0); // lastIncreasedTime

    expect(await vault.poolAmounts(btc.address)).eq("136393334"); // 1.36393334 BTC
    expect(await vault.reservedAmounts(btc.address)).eq(0); // 0.8 BTC
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(0));
    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq("68196667000000000000000000000000000");
    expect(await xlxManager.getAumInUsdg(true)).eq("102295000500000000000000"); // 102295.0005
    expect(await xlxManager.getAumInUsdg(false)).eq("68196667000000000000000"); // 68196.667

    expect(await vault.globalShortSizes(btc.address)).eq(0);
    expect(await vault.globalShortAveragePrices(btc.address)).eq(0);

    await validateVaultBalance(vault, btc);
  });
});
