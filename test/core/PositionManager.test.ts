import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  Timelock,
  Timelock__factory,
  Token,
  Vault,
  XlxManager,
  USDG,
  Router,
  VaultPriceFeed,
  ShortsTracker,
  Vault__factory,
  XlxManager__factory,
  USDG__factory,
  Router__factory,
  VaultPriceFeed__factory,
  ShortsTracker__factory,
  PositionManager,
  OrderBook,
  PositionManager__factory,
  OrderBook__factory,
} from "../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { advanceTime, reportGasUsed, Ship, toChainlinkPrice, toUsd, toWei } from "../../utils";
import { PriceFeed } from "types";
import { BigNumberish, constants, utils, BigNumber } from "ethers";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let vault: Vault;
let xlxManager: XlxManager;
let usdg: USDG;
let router: Router;
let vaultPriceFeed: VaultPriceFeed;
let avax: Token;
let avaxPriceFeed: PriceFeed;
let btc: Token;
let btcPriceFeed: PriceFeed;
let usdc: Token;
let shortsTracker: ShortsTracker;
let positionManager: PositionManager;
let orderBook: OrderBook;
let timelock: Timelock;

let alice: SignerWithAddress;
let bob: SignerWithAddress;
let deployer: SignerWithAddress;
let signer1: SignerWithAddress;
let signer2: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture([
    "vault",
    "xlxManager",
    "usdg",
    "router",
    "vaultPriceFeed",
    "tokens",
    "shortsTracker",
    "positionManager",
    "timelock",
  ]);

  return {
    ship,
    accounts,
    users,
  };
});

describe("PositionManager", () => {
  beforeEach(async () => {
    const { accounts } = await setup();

    alice = accounts.alice;
    bob = accounts.bob;
    deployer = accounts.deployer;
    signer1 = accounts.signer1;
    signer2 = accounts.signer2;

    vault = await ship.connect(Vault__factory);
    xlxManager = await ship.connect(XlxManager__factory);
    usdg = await ship.connect(USDG__factory);
    router = await ship.connect(Router__factory);
    vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
    avax = (await ship.connect("avax")) as Token;
    avaxPriceFeed = (await ship.connect("avaxPriceFeed")) as PriceFeed;
    btc = (await ship.connect("btc")) as Token;
    btcPriceFeed = (await ship.connect("btcPriceFeed")) as PriceFeed;
    usdc = (await ship.connect("usdc")) as Token;
    shortsTracker = await ship.connect(ShortsTracker__factory);
    positionManager = await ship.connect(PositionManager__factory);
    orderBook = await ship.connect(OrderBook__factory);
    timelock = await ship.connect(Timelock__factory);

    await xlxManager.setCooldownDuration(24 * 60 * 60);
    await xlxManager.setShortsTrackerAveragePriceWeight(10000);
    await xlxManager.setInPrivateMode(false);
    await vaultPriceFeed.setIsSecondaryPriceEnabled(false);

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
    await vault.setManager(xlxManager.address, false);
    await usdg.removeVault(xlxManager.address);

    await positionManager.setDepositFee(50);
    await positionManager.setShouldValidateIncreaseOrder(true);
    await timelock.setContractHandler(positionManager.address, false);

    await vault.setInManagerMode(false);
    await avax.mint(bob.address, toWei(1000, 18));
    await avax.connect(bob).approve(router.address, toWei(1000, 18));
    await router
      .connect(bob)
      .swap([avax.address, usdg.address], toWei(1000, 18), toWei(29000, 18), bob.address);

    await usdc.mint(bob.address, toWei(500000, 6));
    await usdc.connect(bob).approve(router.address, toWei(300000, 6));
    await router
      .connect(bob)
      .swap([usdc.address, usdg.address], toWei(300000, 6), toWei(29000, 18), bob.address);

    await btc.mint(bob.address, toWei(10, 8));
    await btc.connect(bob).approve(router.address, toWei(10, 8));
    await router.connect(bob).swap([btc.address, usdg.address], toWei(10, 8), toWei(59000, 18), bob.address);

    await router.addPlugin(orderBook.address);
    await router.connect(alice).approvePlugin(orderBook.address);
  });

  it("inits", async () => {
    expect(await positionManager.router(), "router").eq(router.address);
    expect(await positionManager.vault(), "vault").eq(vault.address);
    expect(await positionManager.weth(), "weth").eq(avax.address);
    expect(await positionManager.depositFee()).eq(50);
    expect(await positionManager.gov(), "gov").eq(deployer.address);
  });

  it("setDepositFee", async () => {
    await expect(positionManager.connect(alice).setDepositFee(10)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    expect(await positionManager.depositFee()).eq(50);
    await positionManager.connect(deployer).setDepositFee(10);
    expect(await positionManager.depositFee()).eq(10);
  });

  it("approve", async () => {
    await expect(positionManager.connect(alice).approve(avax.address, bob.address, 10)).to.be.revertedWith(
      "Governable: forbidden",
    );

    expect(await avax.allowance(positionManager.address, bob.address)).eq(0);
    await positionManager.connect(deployer).approve(avax.address, bob.address, 10);
    expect(await avax.allowance(positionManager.address, bob.address)).eq(10);
  });

  it("setOrderKeeper", async () => {
    await expect(positionManager.connect(alice).setOrderKeeper(bob.address, true)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    await positionManager.setAdmin(alice.address);

    expect(await positionManager.isOrderKeeper(bob.address)).eq(false);
    await positionManager.connect(alice).setOrderKeeper(bob.address, true);
    expect(await positionManager.isOrderKeeper(bob.address)).eq(true);
  });

  it("setLiquidator", async () => {
    await expect(positionManager.connect(alice).setLiquidator(bob.address, true)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    await positionManager.setAdmin(alice.address);

    expect(await positionManager.isLiquidator(bob.address)).eq(false);
    await positionManager.connect(alice).setLiquidator(bob.address, true);
    expect(await positionManager.isLiquidator(bob.address)).eq(true);
  });

  it("setPartner", async () => {
    await expect(positionManager.connect(alice).setPartner(bob.address, true)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    await positionManager.setAdmin(alice.address);

    expect(await positionManager.isPartner(bob.address)).eq(false);
    await positionManager.connect(alice).setPartner(bob.address, true);
    expect(await positionManager.isPartner(bob.address)).eq(true);
  });

  it("setInLegacyMode", async () => {
    await expect(positionManager.connect(alice).setInLegacyMode(true)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    await positionManager.setAdmin(alice.address);

    expect(await positionManager.inLegacyMode()).eq(false);
    await positionManager.connect(alice).setInLegacyMode(true);
    expect(await positionManager.inLegacyMode()).eq(true);
  });

  it("setShouldValidateIncreaseOrder", async () => {
    await expect(positionManager.connect(alice).setShouldValidateIncreaseOrder(false)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    await positionManager.setAdmin(alice.address);

    expect(await positionManager.shouldValidateIncreaseOrder()).eq(true);
    await positionManager.connect(alice).setShouldValidateIncreaseOrder(false);
    expect(await positionManager.shouldValidateIncreaseOrder()).eq(false);
  });

  it("increasePosition and decreasePosition", async () => {
    await expect(
      positionManager
        .connect(alice)
        .increasePosition([btc.address], btc.address, toWei(1, 7), 0, 0, true, toUsd(100000)),
    ).to.be.revertedWith("PositionManager: forbidden");

    await vault.setGov(timelock.address);
    await router.addPlugin(positionManager.address);
    await router.connect(alice).approvePlugin(positionManager.address);

    await btc.connect(alice).approve(router.address, toWei(1, 8));
    await btc.mint(alice.address, toWei(3, 8));

    await positionManager.setInLegacyMode(true);
    await expect(
      positionManager
        .connect(alice)
        .increasePosition([btc.address], btc.address, toWei(1, 7), 0, 0, true, toUsd(100000)),
    ).to.be.revertedWith("Timelock: forbidden");

    // path length should be 1 or 2
    await expect(
      positionManager
        .connect(alice)
        .increasePosition(
          [btc.address, avax.address, usdc.address],
          btc.address,
          toWei(1, 7),
          0,
          0,
          true,
          toUsd(100000),
        ),
    ).to.be.revertedWith("PositionManager: invalid _path.length");

    await timelock.setContractHandler(positionManager.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);

    await usdc.mint(alice.address, toWei(20000, 6));
    await usdc.connect(alice).approve(router.address, toWei(20000, 6));

    // too low desired price
    await expect(
      positionManager
        .connect(alice)
        .increasePosition(
          [usdc.address, btc.address],
          btc.address,
          toWei(200, 6),
          "323333",
          toUsd(2000),
          true,
          toUsd(50000),
        ),
    ).to.be.revertedWith("BasePositionManager: mark price higher than limit");

    // too big minOut
    await expect(
      positionManager
        .connect(alice)
        .increasePosition(
          [usdc.address, btc.address],
          btc.address,
          toWei(200, 6),
          "1332333",
          toUsd(2000),
          true,
          toUsd(60000),
        ),
    ).to.be.revertedWith("BasePositionManager: insufficient amountOut");

    await positionManager
      .connect(alice)
      .increasePosition(
        [usdc.address, btc.address],
        btc.address,
        toWei(200, 6),
        "323333",
        toUsd(2000),
        true,
        toUsd(60000),
      );

    let position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(2000)); // size
    expect(position[1]).eq("197380000000000000000000000000000"); // collateral, 197.38
    expect(position[2]).eq(toUsd(60000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq("3333333"); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit)

    // deposit
    // should deduct extra fee
    await positionManager
      .connect(alice)
      .increasePosition([btc.address], btc.address, "500000", 0, 0, true, toUsd(60000));

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(2000)); // size
    expect(position[1]).eq("495880000000000000000000000000000"); // collateral, 495.88, 495.88 - 197.38 => 298.5, 1.5 for fees
    expect(position[2]).eq(toUsd(60000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq("3333333"); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit

    expect(await btc.balanceOf(positionManager.address)).eq(2500); // 2500 / (10**8) * 60000 => 1.5
    await positionManager.approve(btc.address, bob.address, 5000);
    expect(await btc.balanceOf(signer1.address)).eq(0);
    await btc.connect(bob).transferFrom(positionManager.address, signer1.address, 2500);
    expect(await btc.balanceOf(signer1.address)).eq(2500);

    // leverage is decreased because of big amount of collateral
    // should deduct extra fee
    await positionManager
      .connect(alice)
      .increasePosition([btc.address], btc.address, "500000", 0, toUsd(300), true, toUsd(100000));

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(2300)); // size
    expect(position[1]).eq("794080000000000000000000000000000"); // collateral, 794.08, 794.08 - 495.88 => 298.2, 1.5 for collateral fee, 0.3 for size delta fee

    // regular position increase, no extra fee applied
    await positionManager
      .connect(alice)
      .increasePosition([btc.address], btc.address, "500000", 0, toUsd(1000), true, toUsd(100000));
    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(3300)); // size
    expect(position[1]).eq("1093080000000000000000000000000000"); // collateral, 1093.08, 1093.08 - 794.08 => 299, 1.0 for size delta fee

    await positionManager.setInLegacyMode(false);
    await expect(
      positionManager
        .connect(alice)
        .decreasePosition(btc.address, btc.address, position[1], position[0], true, alice.address, 0),
    ).to.be.revertedWith("PositionManager: forbidden");
    await positionManager.setInLegacyMode(true);

    expect(await btc.balanceOf(alice.address)).to.be.equal("298500000");
    await positionManager
      .connect(alice)
      .decreasePosition(btc.address, btc.address, position[1], position[0], true, alice.address, 0);
    expect(await btc.balanceOf(alice.address)).to.be.equal("300316300");
    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral

    await positionManager.setInLegacyMode(false);
    await expect(
      positionManager
        .connect(alice)
        .increasePosition(
          [usdc.address, btc.address],
          btc.address,
          toWei(200, 18),
          "323333",
          toUsd(2000),
          true,
          toUsd(60000),
        ),
    ).to.be.revertedWith("PositionManager: forbidden");

    // // partners should have access in non-legacy mode
    expect(await positionManager.isPartner(alice.address)).to.be.false;
    await positionManager.setPartner(alice.address, true);
    expect(await positionManager.isPartner(alice.address)).to.be.true;
    await positionManager
      .connect(alice)
      .increasePosition(
        [usdc.address, btc.address],
        btc.address,
        toWei(200, 6),
        "323333",
        toUsd(2000),
        true,
        toUsd(60000),
      );
  });

  it("increasePositionETH and decreasePositionETH", async () => {
    await expect(
      positionManager
        .connect(alice)
        .increasePositionETH([avax.address], avax.address, 0, 0, true, toUsd(100000), {
          value: toWei(1, 18),
        }),
    ).to.be.revertedWith("PositionManager: forbidden");

    await vault.setGov(timelock.address);
    await router.addPlugin(positionManager.address);
    await router.connect(alice).approvePlugin(positionManager.address);

    await positionManager.setInLegacyMode(true);
    await expect(
      positionManager
        .connect(alice)
        .increasePositionETH([avax.address], avax.address, 0, 0, true, toUsd(100000), {
          value: toWei(1, 18),
        }),
    ).to.be.revertedWith("Timelock: forbidden");

    // path[0] should always be weth
    await expect(
      positionManager
        .connect(alice)
        .increasePositionETH([btc.address], avax.address, 0, 0, true, toUsd(100000), {
          value: toWei(1, 18),
        }),
    ).to.be.revertedWith("PositionManager: invalid _path");

    // path length should be 1 or 2
    await expect(
      positionManager
        .connect(alice)
        .increasePositionETH(
          [avax.address, usdc.address, btc.address],
          avax.address,
          0,
          0,
          true,
          toUsd(100000),
          { value: toWei(1, 18) },
        ),
    ).to.be.revertedWith("PositionManager: invalid _path.length");

    await timelock.setContractHandler(positionManager.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);

    await usdc.mint(alice.address, toWei(20000, 18));
    await usdc.connect(alice).approve(router.address, toWei(20000, 18));

    // too low desired price
    await expect(
      positionManager
        .connect(alice)
        .increasePositionETH([avax.address], avax.address, 0, toUsd(2000), true, toUsd(200), {
          value: toWei(1, 18),
        }),
    ).to.be.revertedWith("BasePositionManager: mark price higher than limit");

    let position = await vault.getPosition(alice.address, avax.address, avax.address, true);

    await positionManager
      .connect(alice)
      .increasePositionETH([avax.address], avax.address, 0, toUsd(2000), true, toUsd(100000), {
        value: toWei(1, 18),
      });
    position = await vault.getPosition(alice.address, avax.address, avax.address, true);
    expect(position[0]).eq(toUsd(2000));
    expect(position[1]).eq("298000000000000000000000000000000");

    // deposit
    // should deduct extra fee
    await positionManager
      .connect(alice)
      .increasePositionETH([avax.address], avax.address, 0, 0, true, toUsd(60000), {
        value: toWei(1, 18),
      });
    position = await vault.getPosition(alice.address, avax.address, avax.address, true);
    expect(position[0]).eq(toUsd(2000)); // size
    expect(position[1]).eq("596500000000000000000000000000000"); // collateral, 298 + 300 - 1.5 (300 * 0.5%) = 596.5

    expect(await avax.balanceOf(positionManager.address)).eq(toWei(5, 15)); // 1 * 0.5%

    // leverage is decreased because of big amount of collateral
    // should deduct extra fee
    await positionManager
      .connect(alice)
      .increasePositionETH([avax.address], avax.address, 0, toUsd(300), true, toUsd(60000), {
        value: toWei(1, 18),
      });
    position = await vault.getPosition(alice.address, avax.address, avax.address, true);
    expect(position[0]).eq(toUsd(2300)); // size
    expect(position[1]).eq("894700000000000000000000000000000"); // collateral, 596.5 + 300 - 0.3 - 1.5 = 894.7

    // regular position increase, no extra fee applied
    await positionManager
      .connect(alice)
      .increasePositionETH([avax.address], avax.address, 0, toUsd(1000), true, toUsd(60000), {
        value: toWei(1, 18),
      });
    position = await vault.getPosition(alice.address, avax.address, avax.address, true);
    expect(position[0]).eq(toUsd(3300)); // size
    expect(position[1]).eq("1193700000000000000000000000000000"); // collateral, 894.7 + 300 - 1 = 1193.7

    await positionManager.setInLegacyMode(false);
    await expect(
      positionManager
        .connect(alice)
        .decreasePositionETH(avax.address, avax.address, position[1], position[0], true, alice.address, 0),
    ).to.be.revertedWith("PositionManager: forbidden");
    await positionManager.setInLegacyMode(true);

    const balanceBefore = await ship.provider.getBalance(alice.address);
    await positionManager
      .connect(alice)
      .decreasePositionETH(avax.address, avax.address, position[1], position[0], true, alice.address, 0);
    const balanceAfter = await ship.provider.getBalance(alice.address);
    expect(balanceAfter.gt(balanceBefore));
    position = await vault.getPosition(alice.address, avax.address, avax.address, true);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral

    await positionManager.setInLegacyMode(false);
    await expect(
      positionManager
        .connect(alice)
        .increasePositionETH([avax.address], avax.address, 0, toUsd(1000), true, toUsd(60000), {
          value: toWei(1, 18),
        }),
    ).to.be.revertedWith("PositionManager: forbidden");

    // partners should have access in non-legacy mode
    expect(await positionManager.isPartner(alice.address)).to.be.false;
    await positionManager.setPartner(alice.address, true);
    expect(await positionManager.isPartner(alice.address)).to.be.true;
    await positionManager
      .connect(alice)
      .increasePositionETH([avax.address], avax.address, 0, toUsd(1000), true, toUsd(60000), {
        value: toWei(1, 18),
      });
  });

  it("increasePositionETH with swap", async () => {
    await vault.setGov(timelock.address);
    await timelock.setContractHandler(positionManager.address, true);
    await router.addPlugin(positionManager.address);
    await router.connect(alice).approvePlugin(positionManager.address);

    await timelock.setShouldToggleIsLeverageEnabled(true);
    await positionManager.setInLegacyMode(true);
    await positionManager
      .connect(alice)
      .increasePositionETH([avax.address, btc.address], btc.address, 0, toUsd(2000), true, toUsd(60000), {
        value: toWei(1, 18),
      });

    let position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(2000)); // size
    expect(position[1]).eq("297100000000000000000000000000000"); // collateral, 297.1, 300 - 297.1 => 2.9, 0.9 fee for swap, 2.0 fee for size delta

    await positionManager
      .connect(alice)
      .increasePositionETH([avax.address, btc.address], btc.address, 0, 0, true, toUsd(60000), {
        value: toWei(1, 18),
      });

    position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).eq(toUsd(2000)); // size
    expect(position[1]).eq("594704200000000000000000000000000"); // collateral, 594.7042, 594.7042 - 297.1 => 297.6042, 300 - 297.6042 => 2.3958, ~1.5 + 0.9 fee for swap
  });

  it("increasePosition and increasePositionETH to short", async () => {
    await vault.setGov(timelock.address);
    await timelock.setContractHandler(positionManager.address, true);
    await router.addPlugin(positionManager.address);
    await router.connect(alice).approvePlugin(positionManager.address);

    await usdc.mint(alice.address, toWei(200, 6));
    await usdc.connect(alice).approve(router.address, toWei(200, 6));

    await timelock.setShouldToggleIsLeverageEnabled(true);
    await positionManager.setInLegacyMode(true);
    await positionManager
      .connect(alice)
      .increasePositionETH([avax.address, usdc.address], btc.address, 0, toUsd(3000), false, 0, {
        value: toWei(1, 18),
      });

    let position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(toUsd(3000));
    expect(position[1]).eq("296100000000000000000000000000000");

    await btc.mint(alice.address, toWei(1, 8));
    await btc.connect(alice).approve(router.address, toWei(1, 8));
    await positionManager
      .connect(alice)
      .increasePosition([btc.address, usdc.address], avax.address, "500000", 0, toUsd(3000), false, 0);

    position = await vault.getPosition(alice.address, usdc.address, avax.address, false);
    expect(position[0]).eq(toUsd(3000));
    expect(position[1]).eq("296100000000000000000000000000000");
  });

  it("decreasePositionAndSwap and decreasePositionAndSwapETH", async () => {
    await vault.setGov(timelock.address);
    await router.addPlugin(positionManager.address);
    await router.connect(alice).approvePlugin(positionManager.address);

    await positionManager.setInLegacyMode(true);

    await timelock.setContractHandler(positionManager.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);

    await usdc.mint(alice.address, toWei(20000, 6));
    await usdc.connect(alice).approve(router.address, toWei(20000, 6));

    await avax.deposit({ value: toWei(10, 18) });

    // avax Long
    await positionManager
      .connect(alice)
      .increasePosition(
        [usdc.address, avax.address],
        avax.address,
        toWei(200, 6),
        0,
        toUsd(2000),
        true,
        toUsd(60000),
      );

    let position = await vault.getPosition(alice.address, avax.address, avax.address, true);
    expect(position[0]).eq(toUsd(2000)); // size

    let params: [string[], string, BigNumberish, BigNumberish, boolean, string, BigNumberish] = [
      [avax.address, usdc.address], // path
      avax.address, // indexToken
      position[1], // collateralDelta
      position[0], // sizeDelta
      true, // isLong
      alice.address, // reciever
      0, // price
    ];

    await positionManager.setInLegacyMode(false);
    await expect(
      positionManager.connect(alice).decreasePositionAndSwap(...params, toWei(200, 18)),
    ).to.be.revertedWith("PositionManager: forbidden");
    await positionManager.setInLegacyMode(true);

    // too high minOut
    await expect(
      positionManager.connect(alice).decreasePositionAndSwap(...params, toWei(200, 18)),
    ).to.be.revertedWith("BasePositionManager: insufficient amountOut");

    // invalid path[0] == path[1]
    params[0] = [avax.address, avax.address];
    await expect(positionManager.connect(alice).decreasePositionAndSwap(...params, 0)).to.be.revertedWith(
      "Vault: invalid tokens",
    );

    // path.length > 2
    params[0] = [avax.address, usdc.address, avax.address];
    await expect(positionManager.connect(alice).decreasePositionAndSwap(...params, 0)).to.be.revertedWith(
      "PositionManager: invalid _path.length",
    );

    params[0] = [avax.address, usdc.address];
    const usdcBalance = await usdc.balanceOf(alice.address);
    await positionManager.connect(alice).decreasePositionAndSwap(...params, 0);
    expect(await usdc.balanceOf(alice.address)).to.be.equal(usdcBalance.add("194813600"));

    position = await vault.getPosition(alice.address, avax.address, avax.address, true);
    expect(position[0]).eq(0); // size

    // BTC Short
    await positionManager
      .connect(alice)
      .increasePosition([usdc.address], btc.address, toWei(200, 6), 0, toUsd(2000), false, toUsd(60000));

    position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(toUsd(2000)); // size

    params = [
      [usdc.address, avax.address], // path
      btc.address, // indexToken
      position[1], // collateralDelta
      position[0], // sizeDelta
      false, // isLong
      alice.address, // reciever
      toUsd(60000), // price
    ];
    await positionManager.setInLegacyMode(false);
    await expect(
      positionManager.connect(alice).decreasePositionAndSwapETH(...params, toWei(200, 18)),
    ).to.be.revertedWith("PositionManager: forbidden");
    await positionManager.setInLegacyMode(true);

    await expect(
      positionManager.connect(alice).decreasePositionAndSwapETH(...params, toWei(200, 18)),
    ).to.be.revertedWith("BasePositionManager: insufficient amountOut");

    params[0] = [usdc.address, usdc.address];
    await expect(positionManager.connect(alice).decreasePositionAndSwapETH(...params, 0)).to.be.revertedWith(
      "PositionManager: invalid _path",
    );

    params[0] = [usdc.address, btc.address, avax.address];
    await expect(positionManager.connect(alice).decreasePositionAndSwapETH(...params, 0)).to.be.revertedWith(
      "PositionManager: invalid _path.length",
    );

    params[0] = [usdc.address, avax.address];
    const avaxBalance = await ship.provider.getBalance(alice.address);
    await positionManager.connect(alice).decreasePositionAndSwapETH(...params, 0);
    expect((await ship.provider.getBalance(alice.address)).gt(avaxBalance)).to.be.true;

    position = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(position[0]).eq(0); // size
  });

  it("executeSwapOrder", async () => {
    await usdc.mint(alice.address, toWei(1000, 6));
    await usdc.connect(alice).approve(router.address, toWei(100, 6));
    await orderBook.connect(alice).createSwapOrder(
      [usdc.address, btc.address],
      toWei(100, 6), //amountIn,
      0,
      0,
      true,
      toWei(1, 17),
      false,
      false,
      { value: toWei(1, 17) },
    );
    const orderIndex = (await orderBook.swapOrdersIndex(alice.address)).toNumber() - 1;

    await expect(
      positionManager.connect(bob).executeSwapOrder(alice.address, orderIndex, bob.address),
    ).to.be.revertedWith("PositionManager: forbidden");

    const balanceBefore = await ship.provider.getBalance(bob.address);
    await positionManager.setOrderKeeper(bob.address, true);
    await positionManager.connect(bob).executeSwapOrder(alice.address, orderIndex, bob.address);
    expect((await orderBook.swapOrders(alice.address, orderIndex))[0]).to.be.equal(constants.AddressZero);
    const balanceAfter = await ship.provider.getBalance(bob.address);
    expect(balanceAfter.gt(balanceBefore)).to.be.true;
  });

  it("executeIncreaseOrder", async () => {
    await vault.setGov(timelock.address);
    await timelock.setContractHandler(positionManager.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);
    await positionManager.setInLegacyMode(true);
    await router.addPlugin(positionManager.address);
    await router.connect(alice).approvePlugin(positionManager.address);

    const executionFee = toWei(1, 17); // 0.1 WETH
    await usdc.mint(alice.address, toWei(20000, 6));
    await usdc.connect(alice).approve(router.address, toWei(20000, 6));

    const createIncreaseOrder = (
      amountIn: BigNumberish = toWei(1000, 6),
      sizeDelta: BigNumberish = toUsd(2000),
      isLong = true,
    ) => {
      const path = isLong ? [usdc.address, btc.address] : [usdc.address];
      const collateralToken = isLong ? btc.address : usdc.address;
      return orderBook.connect(alice).createIncreaseOrder(
        path,
        amountIn,
        btc.address, // indexToken
        0, // minOut
        sizeDelta,
        collateralToken,
        isLong,
        toUsd(59000), // triggerPrice
        true, // triggerAboveThreshold
        executionFee,
        false, // shouldWrap
        { value: executionFee },
      );
    };

    await createIncreaseOrder();
    let orderIndex = (await orderBook.increaseOrdersIndex(alice.address)).toNumber() - 1;
    expect(await positionManager.isOrderKeeper(bob.address)).to.be.false;
    await expect(
      positionManager.connect(bob).executeIncreaseOrder(alice.address, orderIndex, bob.address),
    ).to.be.revertedWith("PositionManager: forbidden");

    const balanceBefore = await ship.provider.getBalance(bob.address);
    await positionManager.setOrderKeeper(bob.address, true);
    expect(await positionManager.isOrderKeeper(bob.address)).to.be.true;
    await positionManager.connect(bob).executeIncreaseOrder(alice.address, orderIndex, bob.address);
    expect((await orderBook.increaseOrders(alice.address, orderIndex))[0]).to.be.equal(constants.AddressZero);
    const balanceAfter = await ship.provider.getBalance(bob.address);
    expect(balanceAfter.gt(balanceBefore)).to.be.true;

    const position = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(position[0]).to.be.equal(toUsd(2000));

    // by default validation is enabled
    expect(await positionManager.shouldValidateIncreaseOrder()).to.be.true;

    // should revert on deposits
    await createIncreaseOrder(toWei(100, 6), 0);
    orderIndex = (await orderBook.increaseOrdersIndex(alice.address)).toNumber() - 1;
    const badOrderIndex1 = orderIndex;
    await expect(
      positionManager.connect(bob).executeIncreaseOrder(alice.address, orderIndex, bob.address),
    ).to.be.revertedWith("PositionManager: long deposit");

    // should block if leverage is decreased
    await createIncreaseOrder(toWei(100, 6), toUsd(100));
    orderIndex = (await orderBook.increaseOrdersIndex(alice.address)).toNumber() - 1;
    const badOrderIndex2 = orderIndex;
    await expect(
      positionManager.connect(bob).executeIncreaseOrder(alice.address, orderIndex, bob.address),
    ).to.be.revertedWith("PositionManager: long leverage decrease");

    // should not block if leverage is not decreased
    await createIncreaseOrder();
    orderIndex = (await orderBook.increaseOrdersIndex(alice.address)).toNumber() - 1;
    await positionManager.connect(bob).executeIncreaseOrder(alice.address, orderIndex, bob.address);

    await positionManager.setShouldValidateIncreaseOrder(false);
    expect(await positionManager.shouldValidateIncreaseOrder()).to.be.false;

    await positionManager.connect(bob).executeIncreaseOrder(alice.address, badOrderIndex1, bob.address);
    await positionManager.connect(bob).executeIncreaseOrder(alice.address, badOrderIndex2, bob.address);

    // shorts
    await positionManager.setShouldValidateIncreaseOrder(true);
    expect(await positionManager.shouldValidateIncreaseOrder()).to.be.true;

    await createIncreaseOrder(toWei(1000, 6), toUsd(2000), false);
    orderIndex = (await orderBook.increaseOrdersIndex(alice.address)).toNumber() - 1;
    await positionManager.connect(bob).executeIncreaseOrder(alice.address, orderIndex, bob.address);

    // should not block deposits for shorts
    await createIncreaseOrder(toWei(100, 6), 0, false);
    orderIndex = (await orderBook.increaseOrdersIndex(alice.address)).toNumber() - 1;
    await positionManager.connect(bob).executeIncreaseOrder(alice.address, orderIndex, bob.address);

    await createIncreaseOrder(toWei(100, 6), toUsd(100), false);
    orderIndex = (await orderBook.increaseOrdersIndex(alice.address)).toNumber() - 1;
    await positionManager.connect(bob).executeIncreaseOrder(alice.address, orderIndex, bob.address);
  });

  it("executeDecreaseOrder", async () => {
    await vault.setGov(timelock.address);
    await timelock.setContractHandler(positionManager.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);
    await positionManager.setInLegacyMode(true);
    await router.addPlugin(positionManager.address);
    await router.connect(alice).approvePlugin(positionManager.address);

    await positionManager
      .connect(alice)
      .increasePositionETH([avax.address], avax.address, 0, toUsd(1000), true, toUsd(100000), {
        value: toWei(1, 18),
      });

    let position = await vault.getPosition(alice.address, avax.address, avax.address, true);

    const executionFee = toWei(1, 17); // 0.1 WETH
    await orderBook
      .connect(alice)
      .createDecreaseOrder(avax.address, position[0], avax.address, position[1], true, toUsd(290), true, {
        value: executionFee,
      });

    const orderIndex = (await orderBook.decreaseOrdersIndex(alice.address)).toNumber() - 1;
    await expect(
      positionManager.connect(bob).executeDecreaseOrder(alice.address, orderIndex, bob.address),
    ).to.be.revertedWith("PositionManager: forbidden");

    const balanceBefore = await ship.provider.getBalance(bob.address);
    await positionManager.setOrderKeeper(bob.address, true);
    await positionManager.connect(bob).executeDecreaseOrder(alice.address, orderIndex, bob.address);
    expect((await orderBook.decreaseOrders(alice.address, orderIndex))[0]).to.be.equal(constants.AddressZero);
    const balanceAfter = await ship.provider.getBalance(bob.address);
    expect(balanceAfter.gt(balanceBefore)).to.be.true;

    position = await vault.getPosition(alice.address, avax.address, avax.address, true);
    expect(position[0]).to.be.equal(0);
  });

  it("liquidatePosition", async () => {
    await vault.setGov(timelock.address);
    await timelock.setContractHandler(positionManager.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);

    expect(await positionManager.isLiquidator(bob.address)).to.be.false;
    await expect(
      positionManager
        .connect(bob)
        .liquidatePosition(bob.address, avax.address, avax.address, true, alice.address),
    ).to.be.revertedWith("PositionManager: forbidden");

    await positionManager.setInLegacyMode(true);
    await router.addPlugin(positionManager.address);
    await router.connect(alice).approvePlugin(positionManager.address);

    await positionManager
      .connect(alice)
      .increasePositionETH([avax.address], avax.address, 0, toUsd(1000), true, toUsd(100000), {
        value: toWei(1, 18),
      });

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(200));

    await expect(
      positionManager
        .connect(bob)
        .liquidatePosition(alice.address, avax.address, avax.address, true, bob.address),
    ).to.be.revertedWith("PositionManager: forbidden");

    await positionManager.setLiquidator(bob.address, true);

    expect(await positionManager.isLiquidator(bob.address)).to.be.true;
    await positionManager
      .connect(bob)
      .liquidatePosition(alice.address, avax.address, avax.address, true, bob.address);
  });
});

async function getLiquidationState(
  account: string,
  collateralToken: string,
  indexToken: string,
  isLong: boolean,
  raise: boolean,
) {
  // Vault is in disabled leverage state, fees are different, liquidation state is calculated incorrectly
  // need to enable levarage before calling validateLiquidation

  const marginFeeStorageSlot = "0x" + (15).toString(16);
  const originalMarginFeeBasisPoints = (await vault.marginFeeBasisPoints()).toNumber();
  await ship.provider.send("hardhat_setStorageAt", [
    vault.address,
    marginFeeStorageSlot,
    "0x" + (10).toString(16).padStart(64, "0"),
  ]);
  const [liquidationState, marginFee] = await vault.validateLiquidation(
    account,
    collateralToken,
    indexToken,
    isLong,
    raise,
  );
  await ship.provider.send("hardhat_setStorageAt", [
    vault.address,
    marginFeeStorageSlot,
    "0x" + originalMarginFeeBasisPoints.toString(16).padStart(64, "0"),
  ]);
  return [liquidationState, marginFee];
}

async function debugState(label = "") {
  const poolAmount = await vault.poolAmounts(usdc.address);
  const aum = await xlxManager.getAum(true);
  const globalDelta = await shortsTracker.getGlobalShortDelta(btc.address);
  const averagePrice = await shortsTracker.globalShortAveragePrices(btc.address);
  const price = await vault.getMaxPrice(btc.address);
  const format = utils.formatUnits;
  console.log(
    "STATE %s:\n- pool:   %d\n- aum:    %d (%s)\n- delta: %s%d (%s)\n- price:  %d\n- avg:    %d (%s)",
    label,
    parseInt(format(poolAmount, 18)),
    parseInt(format(aum, 30)),
    aum,
    globalDelta[0] ? "+" : "-",
    Math.round(parseFloat(format(globalDelta[1], 30))),
    globalDelta[1],
    Math.round(parseFloat(format(price, 30))),
    Math.round(parseFloat(format(averagePrice, 30))),
    averagePrice,
  );
}

function expectAumsAreEqual(aum0: BigNumber, aum1: BigNumber, label: string) {
  // aum slightly changes, it is caused by subtle rounding errors in Vault
  // we're checking it deviates by no more than 1 / 1,000,000,000,000,000 of a dollar

  const diff = aum0.sub(aum1).abs();
  label = `${label || ""} aum0: ${aum0.toString()} aum1: ${aum1.toString()} diff: ${diff.toString()}`;
  expect(diff, label).to.be.lt(aum0.div(100000)); // 0.001%
}

describe("PositionManager next short data calculations", function () {
  beforeEach(async () => {
    const { accounts } = await setup();

    alice = accounts.alice;
    bob = accounts.bob;
    deployer = accounts.deployer;
    signer1 = accounts.signer1;
    signer2 = accounts.signer2;

    vault = await ship.connect(Vault__factory);
    xlxManager = await ship.connect(XlxManager__factory);
    usdg = await ship.connect(USDG__factory);
    router = await ship.connect(Router__factory);
    vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
    avax = (await ship.connect("avax")) as Token;
    avaxPriceFeed = (await ship.connect("avaxPriceFeed")) as PriceFeed;
    btc = (await ship.connect("btc")) as Token;
    btcPriceFeed = (await ship.connect("btcPriceFeed")) as PriceFeed;
    usdc = (await ship.connect("usdc")) as Token;
    shortsTracker = await ship.connect(ShortsTracker__factory);
    positionManager = await ship.connect(PositionManager__factory);
    orderBook = await ship.connect(OrderBook__factory);
    timelock = await ship.connect(Timelock__factory);

    await xlxManager.setCooldownDuration(24 * 60 * 60);
    await xlxManager.setShortsTrackerAveragePriceWeight(10000);
    await xlxManager.setInPrivateMode(false);
    await vaultPriceFeed.setIsSecondaryPriceEnabled(false);
    await vaultPriceFeed.setPriceSampleSpace(1);

    await vault.setFees(
      0, // _taxBasisPoints
      0, // _stableTaxBasisPoints
      0, // _mintBurnFeeBasisPoints
      0, // _swapFeeBasisPoints
      0, // _stableSwapFeeBasisPoints
      0, // _marginFeeBasisPoints
      toUsd(5), // _liquidationFeeUsd
      0, // _minProfitTime
      false, // _hasDynamicFees
    );
    await vault.setManager(xlxManager.address, false);
    await usdg.removeVault(xlxManager.address);

    await positionManager.setDepositFee(50);
    await positionManager.setShouldValidateIncreaseOrder(true);
    await positionManager.setInLegacyMode(true);
    await timelock.setContractHandler(positionManager.address, true);

    await vault.setInManagerMode(false);

    await usdc.mint(alice.address, toWei(1000000, 6));
    await usdc.connect(alice).approve(router.address, toWei(1000000, 6));
    await router
      .connect(alice)
      .swap([usdc.address, usdg.address], toWei(500000, 6), toWei(29000, 18), alice.address);
    await router.connect(alice).approvePlugin(positionManager.address);

    await usdc.mint(bob.address, toWei(500000, 6));
    await usdc.connect(bob).approve(router.address, toWei(3000000, 6));
    await router.connect(bob).approvePlugin(positionManager.address);

    await usdc.mint(signer1.address, toWei(500000, 6));
    await usdc.connect(signer1).approve(router.address, toWei(3000000, 6));
    await router.connect(signer1).approvePlugin(positionManager.address);
    await vault.setFundingRate(60 * 60, 600, 600);

    await vault.setGov(timelock.address);
    await orderBook.setMinExecutionFee(500000);
    await orderBook.setMinPurchaseTokenAmountUsd(toWei(5, 30));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));

    await router.addPlugin(orderBook.address);
    await router.connect(alice).approvePlugin(orderBook.address);
  });

  it("PositionManager and XlxManager init with shortsTracker", async () => {
    const [positionManagerShortTracker, xlxManagerShortTracker, avgeragePrice, size] = await Promise.all([
      positionManager.shortsTracker(),
      xlxManager.shortsTracker(),
      shortsTracker.globalShortAveragePrices(btc.address),
      vault.globalShortSizes(btc.address),
    ]);
    expect(positionManagerShortTracker, "positionManager shortsTracker").eq(shortsTracker.address);
    expect(xlxManagerShortTracker, "xlxManager shortsTracker").eq(shortsTracker.address);
    expect(avgeragePrice, "averagePrice").to.be.equal(0);
    expect(size, "size").to.be.equal(0);
  });

  it("does not update shorts data if isGlobalShortDataReady == false", async () => {
    expect(await shortsTracker.isGlobalShortDataReady()).to.be.false;

    let averagePrice = await shortsTracker.globalShortAveragePrices(btc.address);
    expect(averagePrice, "0").to.be.equal(0);

    await positionManager
      .connect(alice)
      .increasePosition([usdc.address], btc.address, toWei(100, 6), 0, toUsd(1000), false, toUsd(60000));
    averagePrice = await shortsTracker.globalShortAveragePrices(btc.address);
    expect(averagePrice, "1").to.be.equal(0);

    await positionManager
      .connect(alice)
      .decreasePosition(usdc.address, btc.address, 0, toUsd(1000), false, alice.address, toUsd(60000));
    averagePrice = await shortsTracker.globalShortAveragePrices(btc.address);
    expect(averagePrice, "2").to.be.equal(0);
  });

  it("updates global short sizes as Vault does", async () => {
    await shortsTracker.setIsGlobalShortDataReady(true);
    expect(await vault.globalShortSizes(btc.address)).to.be.equal(0);
    expect(await vault.globalShortSizes(btc.address)).to.be.equal(0);

    await positionManager
      .connect(alice)
      .increasePosition([usdc.address], btc.address, toWei(100, 6), 0, toUsd(1000), false, toUsd(60000));
    expect(await vault.globalShortSizes(btc.address)).to.be.equal(await vault.globalShortSizes(btc.address));
    expect(await vault.globalShortSizes(btc.address), "1").to.be.equal(toUsd(1000));

    await positionManager
      .connect(alice)
      .decreasePosition(usdc.address, btc.address, 0, toUsd(1000), false, alice.address, toUsd(60000));
    expect(await vault.globalShortSizes(btc.address)).to.be.equal(await vault.globalShortSizes(btc.address));
    expect(await vault.globalShortSizes(btc.address), "1").to.be.equal(0);
  });

  it("updates global short average prices on position increases as Vault does", async () => {
    await shortsTracker.setIsGlobalShortDataReady(true);
    expect(await shortsTracker.globalShortAveragePrices(btc.address)).to.be.equal(0);
    expect(await vault.globalShortAveragePrices(btc.address)).to.be.equal(0);

    await positionManager
      .connect(alice)
      .increasePosition([usdc.address], btc.address, toWei(100, 6), 0, toUsd(1000), false, toUsd(60000));
    expect(await shortsTracker.globalShortAveragePrices(btc.address)).to.be.equal(
      await vault.globalShortAveragePrices(btc.address),
    );

    await positionManager
      .connect(alice)
      .increasePosition([usdc.address], btc.address, toWei(100, 6), 0, toUsd(1000), false, toUsd(60000));
    expect(await shortsTracker.globalShortAveragePrices(btc.address)).to.be.equal(
      await vault.globalShortAveragePrices(btc.address),
    );
  });

  it("updates global short average prices on position decreases", async () => {
    await shortsTracker.setIsGlobalShortDataReady(true);
    await xlxManager.setShortsTrackerAveragePriceWeight(10000);
    expect(await xlxManager.shortsTrackerAveragePriceWeight()).to.be.equal(10000);
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    // "setting": short OI 100k, avg price 60,000, mark price 54,000, global pending pnl -10k
    await positionManager
      .connect(bob)
      .increasePosition([usdc.address], btc.address, toWei(50000, 6), 0, toUsd(100000), false, toUsd(60000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(54000));

    // at this point global pending pnl is 10k
    // CASE 1: open/close position when global pnl is positive
    let aumBefore = await xlxManager.getAum(true);
    await positionManager
      .connect(alice)
      .increasePosition([usdc.address], btc.address, toWei(10000, 6), 0, toUsd(100000), false, toUsd(54000));
    await positionManager
      .connect(alice)
      .decreasePosition(usdc.address, btc.address, 0, toUsd(100000), false, alice.address, toUsd(54000));
    let aumAfter = await xlxManager.getAum(true);
    expectAumsAreEqual(aumBefore, aumAfter, "aum 0");

    let data = await shortsTracker.getGlobalShortDelta(btc.address);
    expect(data[0], "has profit 0").to.be.equal(true);
    expect(data[1], "delta 0").to.be.equal("9999999999999999999999999999999996");

    // CASE 2: open position, close in loss
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(54000));
    await positionManager
      .connect(alice)
      .increasePosition([usdc.address], btc.address, toWei(50000, 6), 0, toUsd(100000), false, toUsd(54000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(66000));

    aumBefore = await xlxManager.getAum(true);
    await positionManager
      .connect(alice)
      .decreasePosition(usdc.address, btc.address, 0, toUsd(100000), false, alice.address, toUsd(66000));
    aumAfter = await xlxManager.getAum(true);
    expectAumsAreEqual(aumBefore, aumAfter, "aum 1");

    data = await shortsTracker.getGlobalShortDelta(btc.address);
    expect(data[0], "has profit 1").to.be.equal(false);
    expect(data[1], "delta 1").to.be.equal("10000000000000000000000000000000007");

    // CASE 3: open/close position when global pnl is negative
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(66000));
    aumBefore = await xlxManager.getAum(true);
    await positionManager
      .connect(alice)
      .increasePosition([usdc.address], btc.address, toWei(10000, 6), 0, toUsd(100000), false, toUsd(66000));
    await positionManager
      .connect(alice)
      .decreasePosition(usdc.address, btc.address, 0, toUsd(100000), false, alice.address, toUsd(66000));
    aumAfter = await xlxManager.getAum(true);
    expectAumsAreEqual(aumBefore, aumAfter, "aum 2");

    data = await shortsTracker.getGlobalShortDelta(btc.address);
    expect(data[0], "has profit 2").to.be.equal(false);
    expect(data[1], "delta 2").to.be.equal("10000000000000000000000000000000007");

    // CASE 4: open position, close in profit
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(66000));
    await positionManager
      .connect(alice)
      .increasePosition([usdc.address], btc.address, toWei(50000, 6), 0, toUsd(100000), false, toUsd(54000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(54000));

    aumBefore = await xlxManager.getAum(true);
    await positionManager
      .connect(alice)
      .decreasePosition(usdc.address, btc.address, 0, toUsd(100000), false, alice.address, toUsd(54000));
    aumAfter = await xlxManager.getAum(true);
    expectAumsAreEqual(aumBefore, aumAfter, "aum 3");

    data = await shortsTracker.getGlobalShortDelta(btc.address);
    expect(data[0], "has profit 3").to.be.equal(true);
    expect(data[1], "delta 3").to.be.equal("9999999999999999999999999999999993");

    // CASE 5: open position, close in profit in multiple steps
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    await positionManager
      .connect(alice)
      .increasePosition([usdc.address], btc.address, toWei(30000, 6), 0, toUsd(90000), false, toUsd(60000));

    aumBefore = await xlxManager.getAum(true);

    // decrease 3 times by 1/3
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(57000));
    await positionManager
      .connect(alice)
      .decreasePosition(
        usdc.address,
        btc.address,
        toUsd(10000),
        toUsd(30000),
        false,
        alice.address,
        toUsd(57000),
      );
    // realised profit 4500

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(54000));
    await positionManager
      .connect(alice)
      .decreasePosition(
        usdc.address,
        btc.address,
        toUsd(10000),
        toUsd(30000),
        false,
        alice.address,
        toUsd(54000),
      );
    // realised profit 3000

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(51000));
    await positionManager
      .connect(alice)
      .decreasePosition(usdc.address, btc.address, 0, toUsd(30000), false, alice.address, toUsd(51000));
    // realised profit 1500

    // total realised profit is 9000 => pool was decreased by 9000
    // pending profit from "other positions" is 15000
    // => aum should be 24000 less

    aumAfter = await xlxManager.getAum(true);
    expectAumsAreEqual(aumBefore.sub("23999999999999999999999999999999994"), aumAfter, "aum 4"); // -$24k

    data = await shortsTracker.getGlobalShortDelta(btc.address);
    expect(data[1], "delta 4").to.be.equal("14999999999999999999999999999999988"); // $15k pending delta of other positions
    expect(data[0], "has profit 4").to.be.equal(true);

    // set price to "initial" (or current global average price)
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    aumAfter = await xlxManager.getAum(true);
    expectAumsAreEqual(aumBefore.sub("8999999999999999999999999999999994"), aumAfter, "aum 4b"); // -$9k

    data = await shortsTracker.getGlobalShortDelta(btc.address);
    expect(data[1], "delta 4b").to.be.equal(13); // ~0 pending delta of other positions
  });

  it("updates global short average prices on soft liquidation", async () => {
    await shortsTracker.setIsGlobalShortDataReady(true);
    await xlxManager.setShortsTrackerAveragePriceWeight(10000);
    expect(await xlxManager.shortsTrackerAveragePriceWeight()).to.be.equal(10000);
    // open pos A at 60,000
    // open pos B at 54,000
    // soft liquidated post B at 58,800
    // set price 60,000
    // pending

    // "setting": short OI 100k, avg price 60,000, mark price 54,000, global pending pnl -10k
    await positionManager
      .connect(bob)
      .increasePosition([usdc.address], btc.address, toWei(50000, 6), 0, toUsd(100000), false, toUsd(60000));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(54000));

    await positionManager
      .connect(alice)
      .increasePosition([usdc.address], btc.address, toWei(10000, 6), 0, toUsd(100000), false, toUsd(54000));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(58800));

    // make sure it's a soft liquidation
    const [liquidationState] = await getLiquidationState(
      alice.address,
      usdc.address,
      btc.address,
      false,
      false,
    );
    expect(liquidationState).to.be.eq(2);

    await positionManager.setLiquidator(alice.address, true);
    const aumBefore = await xlxManager.getAum(true);
    await positionManager
      .connect(alice)
      .liquidatePosition(alice.address, usdc.address, btc.address, false, deployer.address);
    const aumAfter = await xlxManager.getAum(true);
    expectAumsAreEqual(aumBefore, aumAfter, "aum");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    const data = await shortsTracker.getGlobalShortDelta(btc.address);
    expect(data[1], "delta").to.be.lt(100); // to consider rounding errors
  });

  it("updates global short average prices on hard liquidation", async () => {
    // open pos A 100k/50k at 60000
    // open pos B 100k/10k at 50000
    // liquidate pos B at 60000 at loss of 20k
    // aum should be increased by 10k (because pos B collateral is 10k) - $20 margin fee - $5 liquidation fee
    // and pending delta should be 0
    await shortsTracker.setIsGlobalShortDataReady(true);
    await xlxManager.setShortsTrackerAveragePriceWeight(10000);
    expect(await xlxManager.shortsTrackerAveragePriceWeight()).to.be.equal(10000);

    // "setting": short OI 100k, avg price 60,000, mark price 54,000, global pending pnl -10k
    await positionManager
      .connect(bob)
      .increasePosition([usdc.address], btc.address, toWei(50000, 6), 0, toUsd(100000), false, toUsd(60000));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));

    await positionManager
      .connect(alice)
      .increasePosition([usdc.address], btc.address, toWei(10000, 6), 0, toUsd(100000), false, toUsd(50000));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));

    // make sure it's a hard liquidation
    const [liquidationState] = await getLiquidationState(
      alice.address,
      usdc.address,
      btc.address,
      false,
      false,
    );
    expect(liquidationState).to.be.eq(1);

    await positionManager.setLiquidator(bob.address, true);
    const aumBefore = await xlxManager.getAum(true);
    await positionManager
      .connect(bob)
      .liquidatePosition(alice.address, usdc.address, btc.address, false, deployer.address);
    const aumAfter = await xlxManager.getAum(true);

    // global delta should be the same as at the beginning – 0 because the first position avg price = current mark price = 60k
    const globalDelta = await shortsTracker.getGlobalShortDelta(btc.address);
    expect(globalDelta[0], "has profit").to.be.false;
    expect(globalDelta[1], "delta").to.be.lt(100); // 100 to consider rounding errors

    // so the global avg price is 60k as well
    expect(await shortsTracker.globalShortAveragePrices(btc.address), "global avg price").to.be.eq(
      "59999999999999999999999999999999999",
    );

    // aum is expected to drop after hard liquidation
    // because calculated pending pnl < real pending pnl
    expectAumsAreEqual(aumBefore, aumAfter.add(toUsd(10205)), "");
  });

  it("updates global short average prices on hard liquidation with high borrow fee", async () => {
    await shortsTracker.setIsGlobalShortDataReady(true);
    await xlxManager.setShortsTrackerAveragePriceWeight(10000);
    expect(await xlxManager.shortsTrackerAveragePriceWeight()).to.be.equal(10000);

    const aumBefore = await xlxManager.getAum(true);

    // "setting": short OI 100k, avg price 60,000, mark price 54,000, global pending pnl -10k
    await positionManager
      .connect(bob)
      .increasePosition([usdc.address], btc.address, toWei(50000, 6), 0, toUsd(100000), false, toUsd(60000));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(48000));
    await positionManager
      .connect(alice)
      .increasePosition([usdc.address], btc.address, toWei(10000, 6), 0, toUsd(100000), false, toUsd(48000));

    await advanceTime(86400 * 30);
    await vault.updateCumulativeFundingRate(usdc.address, btc.address);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(52800));
    // make sure it's a hard liquidation
    const [liquidationState, marginFee] = await getLiquidationState(
      alice.address,
      usdc.address,
      btc.address,
      false,
      false,
    );
    expect(liquidationState, "liquidation state").to.be.eq(1);

    // borrow fees are $2166,4 (2166400000000000000000000000000000) at this point
    await positionManager.setLiquidator(bob.address, true);
    await positionManager
      .connect(bob)
      .liquidatePosition(alice.address, usdc.address, btc.address, false, bob.address);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));

    // aum should be increased by $9900 (pos collteral) - $2166,4 (borrow fee) - $100 (margin fee) - $5 (liquidation fee) = $7628,6
    const aumAfter = await xlxManager.getAum(true);
    expectAumsAreEqual(aumBefore, aumAfter, "");

    // global delta should be the same as at the beginning: 0
    const globalDelta = await shortsTracker.getGlobalShortDelta(btc.address);
    expect(globalDelta[1], "delta").to.be.lt(10);
    expect(await shortsTracker.globalShortAveragePrices(btc.address), "global avg price").to.be.eq(
      "59999999999999999999999999999999998",
    );
  });

  it("updates global short average prices on hard liquidation with borrow fee exceeds collateral", async () => {
    await shortsTracker.setIsGlobalShortDataReady(true);
    await xlxManager.setShortsTrackerAveragePriceWeight(10000);
    expect(await xlxManager.shortsTrackerAveragePriceWeight()).to.be.equal(10000);

    const aumBefore = await xlxManager.getAum(true);

    // "setting": short OI 100k, avg price 60,000, mark price 54,000, global pending pnl -10k
    await positionManager
      .connect(bob)
      .increasePosition([usdc.address], btc.address, toWei(50000, 6), 0, toUsd(100000), false, toUsd(60000));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(48000));
    await positionManager
      .connect(alice)
      .increasePosition([usdc.address], btc.address, toWei(10000, 6), 0, toUsd(100000), false, toUsd(48000));

    await advanceTime(86400 * 365);
    await vault.updateCumulativeFundingRate(usdc.address, btc.address);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(52800));
    // make sure it's a hard liquidation
    const [liquidationState, marginFee] = await getLiquidationState(
      alice.address,
      usdc.address,
      btc.address,
      false,
      false,
    );
    expect(liquidationState, "liquidation state").to.be.eq(1);

    // borrow fees are $2166,4 (2166400000000000000000000000000000) at this point
    await positionManager.setLiquidator(bob.address, true);
    await positionManager
      .connect(bob)
      .liquidatePosition(alice.address, usdc.address, btc.address, false, bob.address);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    // debugState(2)

    // borrow fee exceeds collateral so nothing to increase pool by. pool is decreased by $5 liq fee
    // aum should be $5 lower than before
    const aumAfter = await xlxManager.getAum(true);
    expectAumsAreEqual(aumBefore, aumAfter.add(toUsd(5)), "");

    // global delta should be the same as at the beginning: 0
    const globalDelta = await shortsTracker.getGlobalShortDelta(btc.address);
    expect(globalDelta[1], "delta").to.be.lt(10);
    expect(await shortsTracker.globalShortAveragePrices(btc.address), "global avg price").to.be.eq(
      "59999999999999999999999999999999998",
    );
  });

  it("updates global short average prices on multiple hard liquidations", async () => {
    // open pos A 100k/50k at 60000
    // open pos B 100k/10k at 50000
    // open pos C 100k/15k at 55000
    // liquidate pos B at 60000 at pending delta of -20k
    // liquidate pos C at 63250 at pending delta of -15k
    // set price 60000
    // aum should be increased by $25k collateral - $400 margin fees - $10 liq fees
    // and pending pnl should be 0
    await shortsTracker.setIsGlobalShortDataReady(true);
    await xlxManager.setShortsTrackerAveragePriceWeight(10000);
    expect(await xlxManager.shortsTrackerAveragePriceWeight()).to.be.equal(10000);

    const aumBefore = await xlxManager.getAum(true);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    await positionManager
      .connect(alice)
      .increasePosition([usdc.address], btc.address, toWei(50000, 6), 0, toUsd(100000), false, toUsd(60000));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));
    await positionManager
      .connect(bob)
      .increasePosition([usdc.address], btc.address, toWei(10000, 6), 0, toUsd(100000), false, toUsd(50000));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(55000));
    await positionManager
      .connect(signer1)
      .increasePosition([usdc.address], btc.address, toWei(15000, 6), 0, toUsd(100000), false, toUsd(55000));

    await positionManager.setLiquidator(alice.address, true);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    await positionManager
      .connect(alice)
      .liquidatePosition(bob.address, usdc.address, btc.address, false, deployer.address);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(65000));
    await positionManager
      .connect(alice)
      .liquidatePosition(signer1.address, usdc.address, btc.address, false, deployer.address);

    // set price to initial
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));

    const data = await shortsTracker.getGlobalShortDelta(btc.address);
    expect(data[1], "global delta").to.be.lt(100); // 100 to consider rounding errors

    const aumAfter = await xlxManager.getAum(true);
    expectAumsAreEqual(aumBefore, aumAfter.sub(toUsd(24590)), "aum");
  });

  it("does not update global short average prices on deposits or withdrawals", async () => {
    await shortsTracker.setIsGlobalShortDataReady(true);
    await xlxManager.setShortsTrackerAveragePriceWeight(10000);
    expect(await xlxManager.shortsTrackerAveragePriceWeight()).to.be.equal(10000);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    // open "other" position
    await positionManager
      .connect(alice)
      .increasePosition([usdc.address], btc.address, toWei(50000, 6), 0, toUsd(100000), false, toUsd(60000));

    await positionManager
      .connect(bob)
      .increasePosition([usdc.address], btc.address, toWei(50000, 6), 0, toUsd(100000), false, toUsd(60000));

    const startAvgPrice = await shortsTracker.globalShortAveragePrices(btc.address);
    const startSize = await vault.globalShortSizes(btc.address);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(55000));
    await positionManager
      .connect(bob)
      .increasePosition([usdc.address], btc.address, toWei(10000, 6), 0, 0, false, toUsd(55000));
    let avgPrice = await shortsTracker.globalShortAveragePrices(btc.address);
    expect(avgPrice, "avg price 0").to.be.eq(startAvgPrice);
    let size = await vault.globalShortSizes(btc.address);
    expect(size, "size 0").to.be.eq(startSize);

    await positionManager
      .connect(bob)
      .decreasePosition(usdc.address, btc.address, toUsd(10000), 0, false, alice.address, toUsd(55000));
    avgPrice = await shortsTracker.globalShortAveragePrices(btc.address);
    expect(avgPrice, "avg price 1").to.be.eq(startAvgPrice);
    size = await vault.globalShortSizes(btc.address);
    expect(size, "size 1").to.be.eq(startSize);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(65000));
    await positionManager
      .connect(bob)
      .increasePosition([usdc.address], btc.address, toWei(10000, 6), 0, 0, false, toUsd(65000));
    avgPrice = await shortsTracker.globalShortAveragePrices(btc.address);
    expect(avgPrice, "avg price 0").to.be.eq(startAvgPrice);
    size = await vault.globalShortSizes(btc.address);
    expect(size, "size 2").to.be.eq(startSize);

    await positionManager
      .connect(bob)
      .decreasePosition(usdc.address, btc.address, toUsd(10000), 0, false, alice.address, toUsd(65000));
    avgPrice = await shortsTracker.globalShortAveragePrices(btc.address);
    expect(avgPrice, "avg price 1").to.be.eq(startAvgPrice);
    size = await vault.globalShortSizes(btc.address);
    expect(size, "size 3").to.be.eq(startSize);
  });

  it("aum should be the same after multiple increase/decrease shorts", async () => {
    // open pos A 100k/50k at 60000
    // open/close pos B 100k/10k at 50000 multiple times
    // set price 60000
    // aum should be the same
    // and pending pnl should be 0

    await shortsTracker.setIsGlobalShortDataReady(true);
    await xlxManager.setShortsTrackerAveragePriceWeight(10000);
    expect(await xlxManager.shortsTrackerAveragePriceWeight()).to.be.equal(10000);

    const aumBefore = await xlxManager.getAum(true);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    await positionManager
      .connect(alice)
      .increasePosition([usdc.address], btc.address, toWei(50000, 6), 0, toUsd(100000), false, toUsd(60000));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));

    for (let i = 0; i < 5; i++) {
      await positionManager
        .connect(bob)
        .increasePosition(
          [usdc.address],
          btc.address,
          toWei(10000, 6),
          0,
          toUsd(100000),
          false,
          toUsd(50000),
        );
      await positionManager
        .connect(bob)
        .decreasePosition(usdc.address, btc.address, 0, toUsd(100000), false, alice.address, toUsd(50000));
    }

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));

    const data = await shortsTracker.getGlobalShortDelta(btc.address);
    expect(data[1], "global delta").to.be.lt(100); // 100 to consider rounding errors

    const aumAfter = await xlxManager.getAum(true);
    expectAumsAreEqual(aumBefore, aumAfter, "aum");
  });

  it("executeIncreaseOrder updates global short data", async () => {
    await shortsTracker.setIsGlobalShortDataReady(true);
    await xlxManager.setShortsTrackerAveragePriceWeight(10000);
    await positionManager.setOrderKeeper(bob.address, true);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));
    await positionManager
      .connect(bob)
      .increasePosition([usdc.address], btc.address, toWei(50000, 6), 0, toUsd(100000), false, toUsd(50000));

    const executionFee = toWei(1, 17); // 0.1 WETH
    await orderBook.connect(alice).createIncreaseOrder(
      [usdc.address], // path
      toWei(1000, 6), // amountIn
      btc.address, // indexToken
      0, // minOut
      toUsd(2000), // sizeDelta
      usdc.address, // collateralToken
      false, // isLong
      toUsd(59000), // triggerPrice
      true, // triggerAboveThreshold
      executionFee,
      false, // shouldWrap
      { value: executionFee },
    );

    let shortAveragePrice = await shortsTracker.globalShortAveragePrices(btc.address);
    expect(shortAveragePrice, "shortAveragePrice 0").to.be.equal(toUsd(50000));
    let shortSize = await vault.globalShortSizes(btc.address);
    expect(shortSize, "shortSize 0").to.be.equal(toUsd(100000));

    const orderIndex = (await orderBook.increaseOrdersIndex(alice.address)).toNumber() - 1;
    expect((await orderBook.increaseOrders(alice.address, orderIndex))[0]).to.be.equal(alice.address);

    let [size] = await vault.getPosition(alice.address, btc.address, btc.address, true);
    expect(size, "size 0").to.be.equal(0);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    const aumBefore = await xlxManager.getAum(true);
    await positionManager.connect(bob).executeIncreaseOrder(alice.address, orderIndex, bob.address);
    [size] = await vault.getPosition(alice.address, usdc.address, btc.address, false);
    expect(size, "size 1").to.be.equal(toUsd(2000));

    shortAveragePrice = await shortsTracker.globalShortAveragePrices(btc.address);
    expect(shortAveragePrice, "shortAveragePrice 1").to.be.equal("50163934426229508196721311475409836");
    shortSize = await vault.globalShortSizes(btc.address);
    expect(shortSize, "shortSize 1").to.be.equal(toUsd(102000));

    const aumAfter = await xlxManager.getAum(true);
    expectAumsAreEqual(aumBefore, aumAfter, "aum 0");
  });

  it("executeDecreaseOrder updates global short data", async () => {
    await shortsTracker.setIsGlobalShortDataReady(true);
    await xlxManager.setShortsTrackerAveragePriceWeight(10000);
    await positionManager.setOrderKeeper(bob.address, true);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));
    await positionManager
      .connect(bob)
      .increasePosition([usdc.address], btc.address, toWei(50000, 6), 0, toUsd(100000), false, toUsd(50000));

    await router.connect(bob).approvePlugin(orderBook.address);

    const executionFee = toWei(1, 17); // 0.1 WETH
    await orderBook.connect(bob).createDecreaseOrder(
      btc.address, // indexToken
      toUsd(10000), // sizeDelta
      usdc.address, // collateralToken
      toUsd(5000), // collateralDelta
      false, // isLong
      toUsd(0), // triggerPrice
      true, // triggerAboveThreshold
      { value: executionFee },
    );

    const orderIndex = (await orderBook.decreaseOrdersIndex(bob.address)).toNumber() - 1;
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    let [size] = await vault.getPosition(bob.address, usdc.address, btc.address, false);
    expect(size, "size 1").to.be.equal(toUsd(100000));

    const aumBefore = await xlxManager.getAum(true);
    let shortAveragePrice = await shortsTracker.globalShortAveragePrices(btc.address);
    expect(shortAveragePrice, "shortAveragePrice 0").to.be.equal(toUsd(50000));
    let shortSize = await vault.globalShortSizes(btc.address);
    expect(shortSize, "shortSize 0").to.be.equal(toUsd(100000));

    await positionManager.connect(bob).executeDecreaseOrder(bob.address, orderIndex, bob.address);
    [size] = await vault.getPosition(bob.address, usdc.address, btc.address, false);
    expect(size, "size 1").to.be.equal(toUsd(90000));

    shortAveragePrice = await shortsTracker.globalShortAveragePrices(btc.address);
    expect(shortAveragePrice, "shortAveragePrice 1").to.be.equal(toUsd(50000));
    shortSize = await vault.globalShortSizes(btc.address);
    expect(shortSize, "shortSize 1").to.be.equal(toUsd(90000));
    const aumAfter = await xlxManager.getAum(true);
    expectAumsAreEqual(aumBefore, aumAfter, "aum 0");
  });

  it("compare gas costs", async () => {
    await shortsTracker.setIsGlobalShortDataReady(true);

    await positionManager
      .connect(bob)
      .increasePosition([usdc.address], btc.address, toWei(50000, 6), 0, toUsd(100000), false, toUsd(60000));
    await positionManager
      .connect(bob)
      .decreasePosition(usdc.address, btc.address, 0, toUsd(50000), false, alice.address, toUsd(60000));

    console.log("\nReport prices with short tracker enabled:");

    let tx0 = await positionManager
      .connect(alice)
      .increasePosition([usdc.address], btc.address, toWei(50000, 6), 0, toUsd(100000), false, toUsd(60000));
    const tx0GasUsed0 = (await reportGasUsed(tx0, "open position")).toNumber();

    let tx1 = await positionManager
      .connect(alice)
      .increasePosition([usdc.address], btc.address, toWei(50000, 6), 0, toUsd(100000), false, toUsd(60000));
    const tx1GasUsed0 = (await reportGasUsed(tx1, "increase position")).toNumber();

    let tx2 = await positionManager
      .connect(alice)
      .decreasePosition(usdc.address, btc.address, 0, toUsd(100000), false, alice.address, toUsd(60000));
    const tx2GasUsed0 = (await reportGasUsed(tx2, "decrease position")).toNumber();

    let tx3 = await positionManager
      .connect(alice)
      .decreasePosition(usdc.address, btc.address, 0, toUsd(100000), false, alice.address, toUsd(60000));
    const tx3GasUsed0 = (await reportGasUsed(tx3, "close position")).toNumber();

    await shortsTracker.setIsGlobalShortDataReady(false);

    console.log("\nReport prices with short tracker disabled:");

    tx0 = await positionManager
      .connect(alice)
      .increasePosition([usdc.address], btc.address, toWei(50000, 6), 0, toUsd(100000), false, toUsd(60000));
    const tx0GasUsed1 = (await reportGasUsed(tx0, "open position")).toNumber();

    tx1 = await positionManager
      .connect(alice)
      .increasePosition([usdc.address], btc.address, toWei(50000, 6), 0, toUsd(100000), false, toUsd(60000));
    const tx1GasUsed1 = (await reportGasUsed(tx1, "increase position")).toNumber();

    tx2 = await positionManager
      .connect(alice)
      .decreasePosition(usdc.address, btc.address, 0, toUsd(100000), false, alice.address, toUsd(60000));
    const tx2GasUsed1 = (await reportGasUsed(tx2, "decrease position")).toNumber();

    tx3 = await positionManager
      .connect(alice)
      .decreasePosition(usdc.address, btc.address, 0, toUsd(100000), false, alice.address, toUsd(60000));
    const tx3GasUsed1 = (await reportGasUsed(tx3, "close position")).toNumber();

    console.log("\nGas increase with short tracker:");
    console.log(
      "open position +%s (+%s%)",
      tx0GasUsed0 - tx0GasUsed1,
      (((tx0GasUsed0 - tx0GasUsed1) / tx0GasUsed1) * 100).toFixed(2),
    );
    console.log(
      "increase position +%s (+%s%)",
      tx1GasUsed0 - tx1GasUsed1,
      (((tx1GasUsed0 - tx1GasUsed1) / tx1GasUsed1) * 100).toFixed(2),
    );
    console.log(
      "decrease position +%s (+%s%)",
      tx2GasUsed0 - tx2GasUsed1,
      (((tx2GasUsed0 - tx2GasUsed1) / tx2GasUsed1) * 100).toFixed(2),
    );
    console.log(
      "close position +%s (+%s%)",
      tx3GasUsed0 - tx3GasUsed1,
      (((tx3GasUsed0 - tx3GasUsed1) / tx3GasUsed1) * 100).toFixed(2),
    );
  });
});
