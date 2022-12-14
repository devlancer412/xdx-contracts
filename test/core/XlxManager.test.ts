import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  XlxManager,
  XlxManager__factory,
  Vault,
  MintableBaseToken,
  USDG,
  Router,
  VaultPriceFeed,
  Token,
  PriceFeed,
  Vault__factory,
  USDG__factory,
  Router__factory,
  VaultPriceFeed__factory,
  TimeDistributor,
  YieldTracker,
  Reader,
  ShortsTracker,
  TimeDistributor__factory,
  YieldTracker__factory,
  Reader__factory,
  ShortsTracker__factory,
} from "../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { advanceTimeAndBlock, getTime, reportGasUsed, Ship, toChainlinkPrice, toWei } from "../../utils";
import { getBnbConfig, getBtcConfig, getDaiConfig } from "./Vault/helper";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let vault: Vault;
let xlxManager: XlxManager;
let xlx: MintableBaseToken;
let usdg: USDG;
let router: Router;
let vaultPriceFeed: VaultPriceFeed;
let bnb: Token;
let bnbPriceFeed: PriceFeed;
let btc: Token;
let btcPriceFeed: PriceFeed;
let eth: Token;
let ethPriceFeed: PriceFeed;
let dai: Token;
let daiPriceFeed: PriceFeed;
let busd: Token;
let busdPriceFeed: PriceFeed;
let distributor: TimeDistributor;
let yieldTracker: YieldTracker;
let reader: Reader;
let shortsTracker: ShortsTracker;

let alice: SignerWithAddress;
let bob: SignerWithAddress;
let rewardRouter: SignerWithAddress;
let deployer: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture(["xlxManager", "testUtils", "initVault", "reader"]);

  return {
    ship,
    accounts,
    users,
  };
});

describe.only("XlxManager", () => {
  before(async () => {
    const scaffold = await setup();

    alice = scaffold.accounts.alice;
    bob = scaffold.accounts.bob;
    deployer = scaffold.accounts.deployer;
    rewardRouter = scaffold.accounts.signer;

    const { connect } = scaffold.ship;

    bnb = (await connect("WBNB")) as Token;
    bnbPriceFeed = (await connect("BnbPriceFeed")) as PriceFeed;

    btc = (await connect("WBTC")) as Token;
    btcPriceFeed = (await connect("BtcPriceFeed")) as PriceFeed;

    eth = (await connect("WETH")) as Token;
    ethPriceFeed = (await connect("EthPriceFeed")) as PriceFeed;

    dai = (await connect("DAI")) as Token;
    daiPriceFeed = (await connect("DaiPriceFeed")) as PriceFeed;

    busd = (await connect("BUSD")) as Token;
    busdPriceFeed = (await connect("BusdPriceFeed")) as PriceFeed;

    vault = await connect(Vault__factory);
    usdg = await connect(USDG__factory);
    router = await connect(Router__factory);
    vaultPriceFeed = await connect(VaultPriceFeed__factory);
    xlx = (await connect("XLX")) as MintableBaseToken;
    xlxManager = await connect(XlxManager__factory);
    shortsTracker = await connect(ShortsTracker__factory);

    distributor = await connect(TimeDistributor__factory);
    yieldTracker = await connect(YieldTracker__factory);
    reader = await connect(Reader__factory);

    await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false);
    await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false);
    await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false);
    await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false);

    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1));
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed));

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300));
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed));

    await xlx.setInPrivateTransferMode(true);
    await xlx.setMinter(xlxManager.address, true);

    await vault.setInManagerMode(true);
  });

  it("inits", async () => {
    expect(await xlxManager.gov()).eq(deployer.address);
    expect(await xlxManager.vault()).eq(vault.address);
    expect(await xlxManager.usdg()).eq(usdg.address);
    expect(await xlxManager.xlx()).eq(xlx.address);
    expect(await xlxManager.cooldownDuration()).eq(24 * 60 * 60);
  });

  it("setGov", async () => {
    await expect(xlxManager.connect(alice).setGov(alice.address)).to.be.revertedWith("Governable: forbidden");

    expect(await xlxManager.gov()).eq(deployer.address);

    await xlxManager.connect(deployer).setGov(alice.address);
    expect(await xlxManager.gov()).eq(alice.address);

    await xlxManager.connect(alice).setGov(deployer.address);
    expect(await xlxManager.gov()).eq(deployer.address);
  });

  it("setHandler", async () => {
    await expect(xlxManager.connect(alice).setHandler(alice.address, true)).to.be.revertedWith(
      "Governable: forbidden",
    );

    expect(await xlxManager.isHandler(bob.address)).eq(false);
    await xlxManager.connect(deployer).setHandler(bob.address, true);
    expect(await xlxManager.isHandler(bob.address)).eq(true);
  });

  it("setCooldownDuration", async () => {
    await expect(xlxManager.connect(alice).setCooldownDuration(1000)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await expect(xlxManager.connect(deployer).setCooldownDuration(48 * 60 * 60 + 1)).to.be.revertedWith(
      "XlxManager: invalid _cooldownDuration",
    );

    expect(await xlxManager.connect(deployer).cooldownDuration()).eq(24 * 60 * 60);
    await xlxManager.connect(deployer).setCooldownDuration(48 * 60 * 60);
    expect(await xlxManager.cooldownDuration()).eq(48 * 60 * 60);
    await xlxManager.connect(deployer).setCooldownDuration(24 * 60 * 60);
  });

  it("setAumAdjustment", async () => {
    await expect(xlxManager.connect(alice).setAumAdjustment(29, 17)).to.be.revertedWith(
      "Governable: forbidden",
    );

    expect(await xlxManager.aumAddition()).eq(0);
    expect(await xlxManager.aumDeduction()).eq(0);
    expect(await xlxManager.getAum(true)).eq(0);
    await xlxManager.connect(deployer).setAumAdjustment(29, 17);
    expect(await xlxManager.aumAddition()).eq(29);
    expect(await xlxManager.aumDeduction()).eq(17);
    expect(await xlxManager.getAum(true)).eq(12);
  });

  it("setShortsTrackerAveragePriceWeight", async () => {
    await expect(xlxManager.connect(alice).setShortsTrackerAveragePriceWeight(5000)).to.be.revertedWith(
      "Governable: forbidden",
    );

    expect(await xlxManager.shortsTrackerAveragePriceWeight()).eq(10000);
    await xlxManager.connect(deployer).setShortsTrackerAveragePriceWeight(5000);
    expect(await xlxManager.shortsTrackerAveragePriceWeight()).eq(5000);
  });

  it("setShortsTracker", async () => {
    await expect(xlxManager.connect(alice).setShortsTracker(bob.address)).to.be.revertedWith(
      "Governable: forbidden",
    );

    expect(await xlxManager.shortsTracker()).eq(shortsTracker.address);
    await xlxManager.connect(deployer).setShortsTracker(bob.address);
    expect(await xlxManager.shortsTracker()).eq(bob.address);

    await xlxManager.connect(deployer).setShortsTracker(shortsTracker.address);
  });

  describe("addLiquidity, removeLiquidity", async () => {
    it("addLiquidity - dai", async () => {
      await dai.mint(alice.address, toWei(100));
      await dai.connect(alice).approve(xlxManager.address, toWei(100));

      await expect(
        xlxManager.connect(alice).addLiquidity(dai.address, toWei(100), toWei(101), toWei(101)),
      ).to.be.revertedWith("Vault: forbidden");

      await vault.setManager(xlxManager.address, true);

      await expect(
        xlxManager.connect(alice).addLiquidity(dai.address, toWei(100), toWei(101), toWei(101)),
      ).to.be.revertedWith("XlxManager: insufficient USDG output");

      expect(await dai.balanceOf(alice.address)).eq(toWei(100));
      expect(await dai.balanceOf(vault.address)).eq(0);
      expect(await usdg.balanceOf(xlxManager.address)).eq(0);
      expect(await xlx.balanceOf(alice.address)).eq(0);
      expect(await xlxManager.lastAddedAt(alice.address)).eq(0);
      expect(await xlxManager.getAumInUsdg(true)).eq(0);

      const tx0 = await xlxManager.connect(alice).addLiquidity(dai.address, toWei(100), toWei(99), toWei(99));
      await reportGasUsed(tx0, "addLiquidity gas used");

      const blockTime = await getTime();

      expect(await dai.balanceOf(alice.address)).eq(0);
      expect(await dai.balanceOf(vault.address)).eq(toWei(100));
      expect(await usdg.balanceOf(xlxManager.address)).eq("99700000000000000000"); // 99.7 = 100 - 0.3
      expect(await xlx.balanceOf(alice.address)).eq("99700000000000000000"); // 99.7
      expect(await xlx.totalSupply()).eq("99700000000000000000"); // 99.7
      expect(await xlxManager.lastAddedAt(alice.address)).eq(blockTime);
      expect(await xlxManager.getAumInUsdg(true)).eq("99700000000000000000"); // 99.7
      expect(await xlxManager.getAumInUsdg(false)).eq("99700000000000000000"); // 99.7
    });

    it("addLiquidity - bnb", async () => {
      await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300));
      await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300));
      await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(400));

      await bnb.mint(bob.address, toWei(1));
      await bnb.connect(bob).approve(xlxManager.address, toWei(1));

      await xlxManager.connect(bob).addLiquidity(bnb.address, toWei(1), toWei(299), toWei(299));
      const blockTime = await getTime();

      expect(await usdg.balanceOf(xlxManager.address)).eq("398800000000000000000"); // 398.8 = 300 - 0.9 + 99.7
      expect(await xlx.balanceOf(alice.address)).eq("99700000000000000000"); // 99.7
      expect(await xlx.balanceOf(bob.address)).eq("299100000000000000000"); // 299.1
      expect(await xlx.totalSupply()).eq("398800000000000000000"); // 398.8
      expect(await xlxManager.lastAddedAt(bob.address)).eq(blockTime);
      expect(await xlxManager.getAumInUsdg(true)).eq("498500000000000000000"); // 498.5 = 400 - 1.2 + 99.7
      expect(await xlxManager.getAumInUsdg(false)).eq("398800000000000000000"); // 398.8 = 300 - 0.9 + 99.7
      await expect(xlx.connect(bob).transfer(alice.address, toWei(1))).to.be.revertedWith(
        "BaseToken: msg.sender not whitelisted",
      );

      await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(400));
      await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(400));
      await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(500));

      expect(await xlxManager.getAumInUsdg(true)).eq("598200000000000000000"); // 598.2 = 500 - 1.5 + 99.7
      expect(await xlxManager.getAumInUsdg(false)).eq("498500000000000000000"); // 498.5 = 400 - 1.2 + 99.7
    });

    it("addLiquidity - btc", async () => {
      await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
      await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
      await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));

      await btc.mint(alice.address, "1000000"); // 0.01 BTC, $600
      await btc.connect(alice).approve(xlxManager.address, toWei(1));

      await expect(
        xlxManager.connect(alice).addLiquidity(btc.address, "1000000", toWei(599), toWei(399)),
      ).to.be.revertedWith("XlxManager: insufficient USDG output");

      await expect(
        xlxManager.connect(alice).addLiquidity(btc.address, "1000000", toWei(598), toWei(399)),
      ).to.be.revertedWith("XlxManager: insufficient XLX output");

      await xlxManager.connect(alice).addLiquidity(btc.address, "1000000", toWei(598), toWei(398));

      const blockTime = await getTime();

      expect(await usdg.balanceOf(xlxManager.address)).eq("997000000000000000000"); // 997 = 600 - 1.8 + 398.8
      expect(await xlx.balanceOf(alice.address)).eq("498500000000000000000"); // 498.5 = 99.7 + 398.8
      expect(await xlx.balanceOf(bob.address)).eq("299100000000000000000"); // 299.1
      expect(await xlx.totalSupply()).eq("797600000000000000000"); // 797.6
      expect(await xlxManager.lastAddedAt(alice.address)).eq(blockTime);
      expect(await xlxManager.getAumInUsdg(true)).eq("1196400000000000000000"); // 1196.4 = 600 - 1.8 + 598.2
      expect(await xlxManager.getAumInUsdg(false)).eq("1096700000000000000000"); // 1096.7 = 600 - 1.8 + 498.5
    });

    it("Test cooldown duration", async () => {
      await expect(
        xlxManager
          .connect(alice)
          .removeLiquidity(dai.address, "99700000000000000000", toWei(123), alice.address),
      ).to.be.revertedWith("XlxManager: cooldown duration not yet passed");

      await advanceTimeAndBlock(24 * 60 * 60 + 1); //86401
    });

    it("removeLiquidity - dai", async () => {
      await expect(
        xlxManager.connect(alice).removeLiquidity(dai.address, toWei(73), toWei(100), alice.address),
      ).to.be.revertedWith("Vault: poolAmount exceeded");

      expect(await dai.balanceOf(alice.address)).eq(0);
      expect(await xlx.balanceOf(alice.address)).eq("498500000000000000000"); // 498.5 = 99.7 + 398.8

      await xlxManager.connect(alice).removeLiquidity(dai.address, toWei(72), toWei(98), alice.address);

      expect(await dai.balanceOf(alice.address)).eq("98703000000000000000"); // 98.703, 72 * 1096.7 / 797.6 => 99
      expect(await bnb.balanceOf(alice.address)).eq(0);
      expect(await xlx.balanceOf(alice.address)).eq("426500000000000000000"); // 426.5 = 27.7 + 398.8
    });

    it("removeLiquidity - bnb", async () => {
      await xlxManager.connect(alice).removeLiquidity(
        bnb.address,
        "27700000000000000000", // 27.7, 27.7 * 1096.7 / 797.6 => 38.0875
        "75900000000000000", // 0.0759 BNB => 37.95 USD
        alice.address,
      );
      expect(await dai.balanceOf(alice.address)).eq("98703000000000000000");
      expect(await bnb.balanceOf(alice.address)).eq("75946475000000000"); // 0.075946475
      expect(await xlx.balanceOf(alice.address)).eq("398800000000000000000"); // 398
      expect(await xlx.totalSupply()).eq("697900000000000000000"); // 697.9
      expect(await xlxManager.getAumInUsdg(true)).eq("1059312500000000000000"); // 1059.3125
      expect(await xlxManager.getAumInUsdg(false)).eq("967230000000000000000"); // 967.23
      expect(await bnb.balanceOf(bob.address)).eq(0);
      expect(await xlx.balanceOf(bob.address)).eq("299100000000000000000");

      await xlxManager.connect(bob).removeLiquidity(
        bnb.address,
        "299100000000000000000", // 299.1, 299.1 * 967.23 / 697.9 => 414.527142857
        "826500000000000000", // 0.8265 BNB => 413.25
        bob.address,
      );

      expect(await bnb.balanceOf(bob.address)).eq("826567122857142856"); // 0.826567122857142856
      expect(await xlx.balanceOf(bob.address)).eq(0);
      expect(await xlx.totalSupply()).eq("398800000000000000000"); // 398.8
      expect(await xlxManager.getAumInUsdg(true)).eq("644785357142857143000"); // 644.785357142857143
      expect(await xlxManager.getAumInUsdg(false)).eq("635608285714285714400"); // 635.6082857142857144
      expect(await btc.balanceOf(alice.address)).eq(0);
      expect(await xlx.balanceOf(alice.address)).eq("398800000000000000000"); // 398.8
      expect(await vault.poolAmounts(dai.address)).eq("700000000000000000"); // 0.7
      expect(await vault.poolAmounts(bnb.address)).eq("91770714285714286"); // 0.091770714285714286
      expect(await vault.poolAmounts(btc.address)).eq("997000"); // 0.00997
    });

    it("removeLiquidity - bnb", async () => {
      await expect(
        xlxManager.connect(alice).removeLiquidity(
          btc.address,
          toWei(375),
          "990000", // 0.0099
          alice.address,
        ),
      ).to.be.revertedWith("USDG: forbidden");
      await usdg.addVault(xlxManager.address);
      const tx1 = await xlxManager.connect(alice).removeLiquidity(
        btc.address,
        toWei(375),
        "990000", // 0.0099
        alice.address,
      );
      await reportGasUsed(tx1, "removeLiquidity gas used");
      expect(await btc.balanceOf(alice.address)).eq("993137");
      expect(await xlx.balanceOf(alice.address)).eq("23800000000000000000"); // 23.8
    });

    it("addLiquidityForAccount", async () => {
      const aliceDaiAmount = await dai.balanceOf(alice.address);
      const vaultDaiAmount = await dai.balanceOf(vault.address);
      const aliceXlxAmount = await xlx.balanceOf(alice.address);
      const xlxTotalAmount = await xlx.totalSupply();

      await xlxManager.setHandler(rewardRouter.address, true);

      await dai.mint(bob.address, toWei(100));
      await dai.connect(bob).approve(xlxManager.address, toWei(100));

      await expect(
        xlxManager
          .connect(alice)
          .addLiquidityForAccount(
            bob.address,
            alice.address,
            dai.address,
            toWei(100),
            toWei(101),
            toWei(101),
          ),
      ).to.be.revertedWith("XlxManager: forbidden");

      await expect(
        xlxManager
          .connect(rewardRouter)
          .addLiquidityForAccount(
            bob.address,
            alice.address,
            dai.address,
            toWei(100),
            toWei(101),
            toWei(101),
          ),
      ).to.be.revertedWith("XlxManager: insufficient USDG output");

      expect(await dai.balanceOf(bob.address)).eq(toWei(100));
      expect(await dai.balanceOf(alice.address)).eq(aliceDaiAmount);
      expect(await dai.balanceOf(vault.address)).eq(vaultDaiAmount);
      expect(await usdg.balanceOf(xlxManager.address)).eq(0);
      expect(await xlx.balanceOf(alice.address)).eq(aliceXlxAmount);

      await xlxManager
        .connect(rewardRouter)
        .addLiquidityForAccount(bob.address, alice.address, dai.address, toWei(100), toWei(99), toWei(0));

      const blockTime = await getTime();

      expect(await dai.balanceOf(bob.address)).eq(0);
      expect(await dai.balanceOf(alice.address)).eq(aliceDaiAmount);
      expect(await dai.balanceOf(vault.address)).eq(toWei(100).add(vaultDaiAmount));
      expect(await usdg.balanceOf(xlxManager.address)).eq("99700000000000000000"); // 99.7
      expect(await xlxManager.lastAddedAt(alice.address)).eq(blockTime);

      await bnb.mint(alice.address, toWei(1));
      await bnb.connect(alice).approve(xlxManager.address, toWei(1));
    });

    it("removeLiquidityForAccount", async () => {
      const xlxAmount = await xlx.balanceOf(alice.address);

      await expect(
        xlxManager
          .connect(alice)
          .removeLiquidityForAccount(alice.address, bnb.address, xlxAmount, xlxAmount, alice.address),
      ).to.be.revertedWith("XlxManager: forbidden");

      await expect(
        xlxManager
          .connect(rewardRouter)
          .removeLiquidityForAccount(alice.address, bnb.address, xlxAmount, xlxAmount, alice.address),
      ).to.be.revertedWith("XlxManager: cooldown duration not yet passed");

      await advanceTimeAndBlock(24 * 60 * 60 + 1);

      await expect(
        xlxManager
          .connect(rewardRouter)
          .removeLiquidityForAccount(alice.address, dai.address, xlxAmount, xlxAmount, alice.address),
      ).to.be.revertedWith("Vault: poolAmount exceeded"); // because bnb price goes up!! impportant

      await xlxManager
        .connect(rewardRouter)
        .removeLiquidityForAccount(
          alice.address,
          dai.address,
          xlxAmount.div(2),
          xlxAmount.div(2),
          alice.address,
        );
    });
  });
});
