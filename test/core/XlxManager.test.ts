import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  Timelock,
  Timelock__factory,
  Token,
  TokenManager,
  TokenManager__factory,
  XDX,
  XdxTimelock,
  XdxTimelock__factory,
  XDX__factory,
  Vault,
  XlxManager,
  XLX,
  USDG,
  Router,
  VaultPriceFeed,
  TimeDistributor,
  YieldTracker,
  Reader,
  ShortsTracker,
  Vault__factory,
  XlxManager__factory,
  XLX__factory,
  USDG__factory,
  Router__factory,
  VaultPriceFeed__factory,
  TimeDistributor__factory,
  YieldTracker__factory,
  Reader__factory,
  ShortsTracker__factory,
} from "../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import {
  advanceTimeAndBlock,
  fromWei,
  getTime,
  reportGasUsed,
  Ship,
  toChainlinkPrice,
  toUsd,
  toWei,
} from "../../utils";
import { PriceFeed } from "types";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let xdx: XDX;
let vault: Vault;
let xlxManager: XlxManager;
let xlx: XLX;
let usdg: USDG;
let router: Router;
let vaultPriceFeed: VaultPriceFeed;
let avax: Token;
let avaxPriceFeed: PriceFeed;
let btc: Token;
let btcPriceFeed: PriceFeed;
let eth: Token;
let ethPriceFeed: PriceFeed;
let usdc: Token;
let usdcPriceFeed: PriceFeed;
let reader: Reader;
let shortsTracker: ShortsTracker;

let alice: SignerWithAddress;
let bob: SignerWithAddress;
let deployer: SignerWithAddress;
let signer1: SignerWithAddress;
let signer2: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture([
    "xdx",
    "vault",
    "xlxManager",
    "xlx",
    "usdg",
    "router",
    "vaultPriceFeed",
    "tokens",
    "reader",
    "shortsTracker",
  ]);

  return {
    ship,
    accounts,
    users,
  };
});

describe.only("TokenManager", () => {
  beforeEach(async () => {
    const { accounts } = await setup();

    alice = accounts.alice;
    bob = accounts.bob;
    deployer = accounts.deployer;
    signer1 = accounts.signer1;
    signer2 = accounts.signer2;

    xdx = await ship.connect(XDX__factory);
    vault = await ship.connect(Vault__factory);
    xlxManager = await ship.connect(XlxManager__factory);
    xlx = await ship.connect(XLX__factory);
    usdg = await ship.connect(USDG__factory);
    router = await ship.connect(Router__factory);
    vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
    avax = (await ship.connect("avax")) as Token;
    avaxPriceFeed = (await ship.connect("avaxPriceFeed")) as PriceFeed;
    btc = (await ship.connect("btc")) as Token;
    btcPriceFeed = (await ship.connect("btcPriceFeed")) as PriceFeed;
    eth = (await ship.connect("eth")) as Token;
    ethPriceFeed = (await ship.connect("ethPriceFeed")) as PriceFeed;
    usdc = (await ship.connect("usdc")) as Token;
    usdcPriceFeed = (await ship.connect("usdcPriceFeed")) as PriceFeed;
    reader = await ship.connect(Reader__factory);
    shortsTracker = await ship.connect(ShortsTracker__factory);

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
  });

  it("inits", async () => {
    expect(await xlxManager.gov()).eq(deployer.address);
    expect(await xlxManager.vault()).eq(vault.address);
    expect(await xlxManager.usdg()).eq(usdg.address);
    expect(await xlxManager.xlx()).eq(xlx.address);
    expect(await xlxManager.cooldownDuration()).eq(24 * 60 * 60);
  });

  it("setGov", async () => {
    await expect(xlxManager.connect(alice).setGov(bob.address)).to.be.revertedWith("Governable: forbidden");

    expect(await xlxManager.gov()).eq(deployer.address);

    await xlxManager.setGov(alice.address);
    expect(await xlxManager.gov()).eq(alice.address);

    await xlxManager.connect(alice).setGov(bob.address);
    expect(await xlxManager.gov()).eq(bob.address);
  });

  it("setHandler", async () => {
    await expect(xlxManager.connect(alice).setHandler(bob.address, true)).to.be.revertedWith(
      "Governable: forbidden",
    );

    expect(await xlxManager.gov()).eq(deployer.address);
    await xlxManager.setGov(alice.address);
    expect(await xlxManager.gov()).eq(alice.address);

    expect(await xlxManager.isHandler(bob.address)).eq(false);
    await xlxManager.connect(alice).setHandler(bob.address, true);
    expect(await xlxManager.isHandler(bob.address)).eq(true);
  });

  it("setCooldownDuration", async () => {
    await expect(xlxManager.connect(alice).setCooldownDuration(1000)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await xlxManager.setGov(alice.address);

    await expect(xlxManager.connect(alice).setCooldownDuration(48 * 60 * 60 + 1)).to.be.revertedWith(
      "XlxManager: invalid _cooldownDuration",
    );

    expect(await xlxManager.cooldownDuration()).eq(24 * 60 * 60);
    await xlxManager.connect(alice).setCooldownDuration(48 * 60 * 60);
    expect(await xlxManager.cooldownDuration()).eq(48 * 60 * 60);
  });

  it("setAumAdjustment", async () => {
    await expect(xlxManager.connect(alice).setAumAdjustment(29, 17)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await xlxManager.setGov(alice.address);

    expect(await xlxManager.aumAddition()).eq(0);
    expect(await xlxManager.aumDeduction()).eq(0);
    expect(await xlxManager.getAum(true)).eq(0);
    await xlxManager.connect(alice).setAumAdjustment(29, 17);
    expect(await xlxManager.aumAddition()).eq(29);
    expect(await xlxManager.aumDeduction()).eq(17);
    expect(await xlxManager.getAum(true)).eq(12);
  });

  it("setShortsTrackerAveragePriceWeight", async () => {
    await expect(xlxManager.connect(alice).setShortsTrackerAveragePriceWeight(5000)).to.be.revertedWith(
      "Governable: forbidden",
    );

    expect(await xlxManager.shortsTrackerAveragePriceWeight()).eq(10000);
    expect(await xlxManager.gov()).eq(deployer.address);
    await xlxManager.connect(deployer).setShortsTrackerAveragePriceWeight(5000);
    expect(await xlxManager.shortsTrackerAveragePriceWeight()).eq(5000);
  });

  it("setShortsTracker", async () => {
    await expect(xlxManager.connect(alice).setShortsTracker(bob.address)).to.be.revertedWith(
      "Governable: forbidden",
    );

    expect(await xlxManager.shortsTracker()).eq(shortsTracker.address);
    expect(await xlxManager.gov()).eq(deployer.address);
    await xlxManager.connect(deployer).setShortsTracker(bob.address);
    expect(await xlxManager.shortsTracker()).eq(bob.address);
  });

  it("addLiquidity, removeLiquidity", async () => {
    await usdc.mint(alice.address, toWei(100, 6));
    await usdc.connect(alice).approve(xlxManager.address, toWei(100, 6));

    await expect(
      xlxManager.connect(alice).addLiquidity(usdc.address, toWei(100, 6), toWei(101, 18), toWei(101, 18)),
    ).to.be.revertedWith("Vault: forbidden");

    await vault.setManager(xlxManager.address, true);

    await expect(
      xlxManager.connect(alice).addLiquidity(usdc.address, toWei(100, 6), toWei(101, 18), toWei(101, 18)),
    ).to.be.revertedWith("XlxManager: insufficient USDG output");

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(400));

    expect(await usdc.balanceOf(alice.address)).eq(toWei(100, 6));
    expect(await usdc.balanceOf(vault.address)).eq(0);
    expect(await usdg.balanceOf(xlxManager.address)).eq(0);
    expect(await xlx.balanceOf(alice.address)).eq(0);
    expect(await xlxManager.lastAddedAt(alice.address)).eq(0);
    expect(await xlxManager.getAumInUsdg(true)).eq(0);

    const tx0 = await xlxManager
      .connect(alice)
      .addLiquidity(usdc.address, toWei(100, 6), toWei(99, 18), toWei(99, 18));
    await reportGasUsed(tx0, "addLiquidity gas used");

    let blockTime = await getTime();

    expect(await usdc.balanceOf(alice.address)).eq(0);
    expect(await usdc.balanceOf(vault.address)).eq(toWei(100, 6));
    expect(await usdg.balanceOf(xlxManager.address)).eq("99700000000000000000"); // 99.7
    expect(await xlx.balanceOf(alice.address)).eq("99700000000000000000");
    expect(await xlx.totalSupply()).eq("99700000000000000000");
    expect(await xlxManager.lastAddedAt(alice.address)).eq(blockTime);
    expect(await xlxManager.getAumInUsdg(true)).eq("99700000000000000000");
    expect(await xlxManager.getAumInUsdg(false)).eq("99700000000000000000");

    await avax.mint(bob.address, toWei(1, 18));
    await avax.connect(bob).approve(xlxManager.address, toWei(1, 18));

    await xlxManager.connect(bob).addLiquidity(avax.address, toWei(1, 18), toWei(299, 18), toWei(299, 18));
    blockTime = await getTime();

    expect(await usdg.balanceOf(xlxManager.address)).eq("398800000000000000000"); // 398.8
    expect(await xlx.balanceOf(alice.address)).eq("99700000000000000000"); // 99.7
    expect(await xlx.balanceOf(bob.address)).eq("299100000000000000000"); // 299.1
    expect(await xlx.totalSupply()).eq("398800000000000000000");
    expect(await xlxManager.lastAddedAt(bob.address)).eq(blockTime);
    expect(await xlxManager.getAumInUsdg(true)).eq("498500000000000000000");
    expect(await xlxManager.getAumInUsdg(false)).eq("398800000000000000000");

    await expect(xlx.connect(bob).transfer(signer1.address, toWei(1, 18))).to.be.revertedWith(
      "BaseToken: msg.sender not whitelisted",
    );

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(400));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(400));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(500));

    expect(await xlxManager.getAumInUsdg(true)).eq("598200000000000000000"); // 598.2
    expect(await xlxManager.getAumInUsdg(false)).eq("498500000000000000000"); // 498.5

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));

    await btc.mint(signer1.address, "1000000"); // 0.01 BTC, $500
    await btc.connect(signer1).approve(xlxManager.address, toWei(1, 18));

    await expect(
      xlxManager.connect(signer1).addLiquidity(btc.address, "1000000", toWei(599, 18), toWei(399, 18)),
    ).to.be.revertedWith("XlxManager: insufficient USDG output");

    await expect(
      xlxManager.connect(signer1).addLiquidity(btc.address, "1000000", toWei(598, 18), toWei(399, 18)),
    ).to.be.revertedWith("XlxManager: insufficient XLX output");

    await xlxManager.connect(signer1).addLiquidity(btc.address, "1000000", toWei(598, 18), toWei(398, 18));

    blockTime = await getTime();

    expect(await usdg.balanceOf(xlxManager.address)).eq("997000000000000000000"); // 997
    expect(await xlx.balanceOf(alice.address)).eq("99700000000000000000"); // 99.7
    expect(await xlx.balanceOf(bob.address)).eq("299100000000000000000"); // 299.1
    expect(await xlx.balanceOf(signer1.address)).eq("398800000000000000000"); // 398.8
    expect(await xlx.totalSupply()).eq("797600000000000000000"); // 797.6
    expect(await xlxManager.lastAddedAt(signer1.address)).eq(blockTime);
    expect(await xlxManager.getAumInUsdg(true)).eq("1196400000000000000000"); // 1196.4
    expect(await xlxManager.getAumInUsdg(false)).eq("1096700000000000000000"); // 1096.7

    await expect(
      xlxManager
        .connect(alice)
        .removeLiquidity(usdc.address, "99700000000000000000", toWei(123, 6), alice.address),
    ).to.be.revertedWith("XlxManager: cooldown duration not yet passed");

    await advanceTimeAndBlock(24 * 60 * 60 + 1);

    await expect(
      xlxManager.connect(alice).removeLiquidity(usdc.address, toWei(73, 18), toWei(100, 6), alice.address),
    ).to.be.revertedWith("Vault: poolAmount exceeded");

    expect(await usdc.balanceOf(alice.address)).eq(0);
    expect(await xlx.balanceOf(alice.address)).eq("99700000000000000000"); // 99.7

    await xlxManager.connect(alice).removeLiquidity(usdc.address, toWei(72, 18), toWei(98, 6), alice.address);

    expect(await usdc.balanceOf(alice.address)).eq("98703000"); // 98.703, 72 * 1096.7 / 797.6 => 99
    expect(await avax.balanceOf(alice.address)).eq(0);
    expect(await xlx.balanceOf(alice.address)).eq("27700000000000000000"); // 27.7

    await xlxManager.connect(alice).removeLiquidity(
      avax.address,
      "27700000000000000000", // 27.7, 27.7 * 1096.7 / 797.6 => 38.0875
      "75900000000000000", // 0.0759 avax => 37.95 USD
      alice.address,
    );

    expect(await usdc.balanceOf(alice.address)).eq("98703000");
    expect(await avax.balanceOf(alice.address)).eq("75946475000000000"); // 0.075946475
    expect(await xlx.balanceOf(alice.address)).eq(0);

    expect(await xlx.totalSupply()).eq("697900000000000000000"); // 697.9
    expect(await xlxManager.getAumInUsdg(true)).eq("1059312500000000000000"); // 1059.3125
    expect(await xlxManager.getAumInUsdg(false)).eq("967230000000000000000"); // 967.23

    expect(await avax.balanceOf(bob.address)).eq(0);
    expect(await xlx.balanceOf(bob.address)).eq("299100000000000000000");

    await xlxManager.connect(bob).removeLiquidity(
      avax.address,
      "299100000000000000000", // 299.1, 299.1 * 967.23 / 697.9 => 414.527142857
      "826500000000000000", // 0.8265 avax => 413.25
      bob.address,
    );

    expect(await avax.balanceOf(bob.address)).eq("826567122857142856"); // 0.826567122857142856
    expect(await xlx.balanceOf(bob.address)).eq(0);

    expect(await xlx.totalSupply()).eq("398800000000000000000"); // 398.8
    expect(await xlxManager.getAumInUsdg(true)).eq("644785357142857143000"); // 644.785357142857143
    expect(await xlxManager.getAumInUsdg(false)).eq("635608285714285714400"); // 635.6082857142857144

    expect(await btc.balanceOf(signer1.address)).eq(0);
    expect(await xlx.balanceOf(signer1.address)).eq("398800000000000000000"); // 398.8

    expect(await vault.poolAmounts(usdc.address)).eq("700000"); // 0.7
    expect(await vault.poolAmounts(avax.address)).eq("91770714285714286"); // 0.091770714285714286
    expect(await vault.poolAmounts(btc.address)).eq("997000"); // 0.00997

    await expect(
      xlxManager.connect(signer1).removeLiquidity(
        btc.address,
        toWei(375, 18),
        "990000", // 0.0099
        signer1.address,
      ),
    ).to.be.revertedWith("USDG: forbidden");

    await usdg.addVault(xlxManager.address);

    const tx1 = await xlxManager.connect(signer1).removeLiquidity(
      btc.address,
      toWei(375, 18),
      "990000", // 0.0099
      signer1.address,
    );
    await reportGasUsed(tx1, "removeLiquidity gas used");

    expect(await btc.balanceOf(signer1.address)).eq("993137");
    expect(await xlx.balanceOf(signer1.address)).eq("23800000000000000000"); // 23.8
  });

  it("addLiquidityForAccount, removeLiquidityForAccount", async () => {
    await vault.setManager(xlxManager.address, true);
    await xlxManager.setInPrivateMode(true);
    await xlxManager.setHandler(alice.address, true);

    await usdc.mint(bob.address, toWei(100, 6));
    await usdc.connect(bob).approve(xlxManager.address, toWei(100, 6));

    await expect(
      xlxManager
        .connect(signer1)
        .addLiquidityForAccount(
          bob.address,
          signer1.address,
          usdc.address,
          toWei(100, 6),
          toWei(101, 18),
          toWei(101, 18),
        ),
    ).to.be.revertedWith("XlxManager: forbidden");

    await expect(
      xlxManager
        .connect(alice)
        .addLiquidityForAccount(
          bob.address,
          signer1.address,
          usdc.address,
          toWei(100, 6),
          toWei(101, 18),
          toWei(101, 18),
        ),
    ).to.be.revertedWith("XlxManager: insufficient USDG output");

    expect(await usdc.balanceOf(bob.address)).eq(toWei(100, 6));
    expect(await usdc.balanceOf(signer1.address)).eq(0);
    expect(await usdc.balanceOf(vault.address)).eq(0);
    expect(await usdg.balanceOf(xlxManager.address)).eq(0);
    expect(await xlx.balanceOf(signer1.address)).eq(0);
    expect(await xlxManager.lastAddedAt(signer1.address)).eq(0);
    expect(await xlxManager.getAumInUsdg(true)).eq(0);

    await xlxManager
      .connect(alice)
      .addLiquidityForAccount(
        bob.address,
        signer1.address,
        usdc.address,
        toWei(100, 6),
        toWei(99, 18),
        toWei(99, 18),
      );

    let blockTime = await getTime();

    expect(await usdc.balanceOf(bob.address)).eq(0);
    expect(await usdc.balanceOf(signer1.address)).eq(0);
    expect(await usdc.balanceOf(vault.address)).eq(toWei(100, 6));
    expect(await usdg.balanceOf(xlxManager.address)).eq("99700000000000000000"); // 99.7
    expect(await xlx.balanceOf(signer1.address)).eq("99700000000000000000");
    expect(await xlx.totalSupply()).eq("99700000000000000000");
    expect(await xlxManager.lastAddedAt(signer1.address)).eq(blockTime);
    expect(await xlxManager.getAumInUsdg(true)).eq("99700000000000000000");

    await avax.mint(signer2.address, toWei(1, 18));
    await avax.connect(signer2).approve(xlxManager.address, toWei(1, 18));

    await advanceTimeAndBlock(24 * 60 * 60 + 1);

    await xlxManager
      .connect(alice)
      .addLiquidityForAccount(
        signer2.address,
        signer2.address,
        avax.address,
        toWei(1, 18),
        toWei(299, 18),
        toWei(299, 18),
      );
    blockTime = await getTime();

    expect(await usdg.balanceOf(xlxManager.address)).eq("398800000000000000000"); // 398.8
    expect(await xlx.balanceOf(signer1.address)).eq("99700000000000000000");
    expect(await xlx.balanceOf(signer2.address)).eq("299100000000000000000");
    expect(await xlx.totalSupply()).eq("398800000000000000000");
    expect(await xlxManager.lastAddedAt(signer2.address)).eq(blockTime);
    expect(await xlxManager.getAumInUsdg(true)).eq("398800000000000000000");

    await expect(
      xlxManager
        .connect(signer2)
        .removeLiquidityForAccount(
          signer2.address,
          avax.address,
          "99700000000000000000",
          toWei(290, 18),
          signer2.address,
        ),
    ).to.be.revertedWith("XlxManager: forbidden");

    await expect(
      xlxManager
        .connect(alice)
        .removeLiquidityForAccount(
          signer2.address,
          avax.address,
          "99700000000000000000",
          toWei(290, 18),
          signer2.address,
        ),
    ).to.be.revertedWith("XlxManager: cooldown duration not yet passed");

    await xlxManager.connect(alice).removeLiquidityForAccount(
      signer1.address,
      usdc.address,
      "79760000000000000000", // 79.76
      "79000000", // 79
      signer1.address,
    );

    expect(await usdc.balanceOf(signer1.address)).eq("79520720");
    expect(await avax.balanceOf(signer1.address)).eq(0);
    expect(await xlx.balanceOf(signer1.address)).eq("19940000000000000000"); // 19.94
  });

  context("Different avg price in Vault and ShortsTracker", async () => {
    beforeEach(async () => {
      await vaultPriceFeed.setPriceSampleSpace(1);

      await usdc.mint(vault.address, toWei(100000, 6));
      await vault.directPoolDeposit(usdc.address);

      const aum = await xlxManager.getAum(true);
      expect(aum, "aum 0").to.equal(toUsd(100000));

      await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
      await usdc.mint(alice.address, toWei(1000, 6));
      await usdc.connect(alice).approve(router.address, toWei(1000, 6));
      // vault globalShortSizes(BTC) will be 2000 and globalShortAveragePrices(BTC) will be 60000
      await router
        .connect(alice)
        .increasePosition([usdc.address], btc.address, toWei(1000, 6), 0, toUsd(2000), false, toUsd(60000));

      // set different average price to ShortsTracker
      await shortsTracker.setIsGlobalShortDataReady(false);
      await shortsTracker.setInitData([btc.address], [toUsd(61000)]);
      await shortsTracker.setIsGlobalShortDataReady(false);
    });

    it("XlxManager ignores ShortsTracker if flag is off", async () => {
      expect(await shortsTracker.isGlobalShortDataReady()).to.be.false;

      expect(await vault.globalShortSizes(btc.address), "size 0").to.equal(toUsd(2000));
      expect(await vault.globalShortAveragePrices(btc.address), "avg price 0").to.equal(toUsd(60000));

      await btcPriceFeed.setLatestAnswer(toChainlinkPrice(54000));
      expect((await vault.getGlobalShortDelta(btc.address))[1], "delta 0").to.equal(toUsd(200));
      expect((await shortsTracker.getGlobalShortDelta(btc.address))[1], "delta 1").to.equal(
        "229508196721311475409836065573770",
      );

      // aum should be $100,000 pool - $200 shorts pnl = 99,800
      expect(await xlxManager.getAum(true), "aum 1").to.equal(toUsd(99800));
    });

    it("XlxManager switches gradually to ShortsTracker average price", async () => {
      expect(await vault.globalShortSizes(btc.address), "size 0").to.equal(toUsd(2000));
      expect(await vault.globalShortAveragePrices(btc.address), "avg price 0").to.equal(toUsd(60000));

      await xlxManager.setShortsTrackerAveragePriceWeight(0);
      expect(await shortsTracker.globalShortAveragePrices(btc.address), "avg price 1").to.equal(toUsd(61000));

      await btcPriceFeed.setLatestAnswer(toChainlinkPrice(54000));

      await shortsTracker.setIsGlobalShortDataReady(true);
      // with flag enabled it should be the same because shortsTrackerAveragePriceWeight is 0
      expect(await xlxManager.getAum(true), "aum 2").to.equal(toUsd(99800));

      // according to ShortsTracker data pnl is ~$229.51
      // gradually configure XlxManager to use ShortsTracker for aum calculation
      await xlxManager.setShortsTrackerAveragePriceWeight(1000); // 10% for ShortsTracker, 90% for Vault
      // 100,000 - (200 * 90% + 229.51 * 10%) = 99,797.05
      expect(await xlxManager.getAum(true), "aum 3").to.equal("99797004991680532445923460898502496");

      await xlxManager.setShortsTrackerAveragePriceWeight(5000); // 50% for ShortsTracker, 50% for Vault
      // 100,000 - (200 * 50% + 229.51 * 50%) = 99,785.25
      expect(await xlxManager.getAum(true), "aum 4").to.equal("99785123966942148760330578512396695");

      await xlxManager.setShortsTrackerAveragePriceWeight(10000); // 100% for ShortsTracker
      // 100,000 - (200 * 0 + 229.51 * 100%) = 99,770.49
      expect(await xlxManager.getAum(true), "aum 5").to.equal("99770491803278688524590163934426230");
    });

    it("XlxManager switches back to Vault average price after flag is turned off", async () => {
      await btcPriceFeed.setLatestAnswer(toChainlinkPrice(54000));
      await xlxManager.setShortsTrackerAveragePriceWeight(10000);

      // flag is disabled, aum is calculated with Vault values
      expect(await xlxManager.getAum(true), "aum 0").to.equal(toUsd(99800));

      // enable ShortsTracker
      await shortsTracker.setIsGlobalShortDataReady(true);
      expect(await xlxManager.getAum(true), "aum 1").to.equal("99770491803278688524590163934426230");

      // back to vault
      await shortsTracker.setIsGlobalShortDataReady(false);
      expect(await xlxManager.getAum(true), "aum 2").to.equal(toUsd(99800));
    });
  });
});
