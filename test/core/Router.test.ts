import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  Token,
  Vault,
  Router,
  Vault__factory,
  Router__factory,
  VaultPriceFeed__factory,
  USDG,
  VaultPriceFeed,
  USDG__factory,
  PancakePair__factory,
} from "../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { reportGasUsed, Ship, toChainlinkPrice, toUsd, toWei } from "../../utils";
import { PriceFeed } from "types";
import { Wallet } from "ethers";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let vault: Vault;
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

let deployer: SignerWithAddress;
let user0: SignerWithAddress;
let user1: SignerWithAddress;
let user2: SignerWithAddress;
let user3: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture(["vault", "usdg", "router", "vaultPriceFeed", "tokens"]);

  return {
    ship,
    accounts,
    users,
  };
});

describe("Router", function () {
  beforeEach(async () => {
    const { accounts, users } = await setup();

    deployer = accounts.deployer;
    user0 = users[0];
    user1 = users[1];
    user2 = users[2];
    user3 = users[3];

    vault = await ship.connect(Vault__factory);
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

    await avax.connect(user3).deposit({ value: toWei(100, 18) });
    await vault.setManager(router.address, true);
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
    await vault.setFundingRate(8 * 60 * 60, 600, 600);

    await vaultPriceFeed.setIsSecondaryPriceEnabled(false);
  });

  it("setGov", async () => {
    await expect(router.connect(user0).setGov(user1.address)).to.be.revertedWith("Router: forbidden");

    expect(await router.gov()).eq(deployer.address);

    await router.setGov(user0.address);
    expect(await router.gov()).eq(user0.address);

    await router.connect(user0).setGov(user1.address);
    expect(await router.gov()).eq(user1.address);
  });

  it("addPlugin", async () => {
    await expect(router.connect(user0).addPlugin(user1.address)).to.be.revertedWith("Router: forbidden");

    await router.setGov(user0.address);

    expect(await router.plugins(user1.address)).eq(false);
    await router.connect(user0).addPlugin(user1.address);
    expect(await router.plugins(user1.address)).eq(true);
  });

  it("removePlugin", async () => {
    await expect(router.connect(user0).removePlugin(user1.address)).to.be.revertedWith("Router: forbidden");

    await router.setGov(user0.address);

    expect(await router.plugins(user1.address)).eq(false);
    await router.connect(user0).addPlugin(user1.address);
    expect(await router.plugins(user1.address)).eq(true);
    await router.connect(user0).removePlugin(user1.address);
    expect(await router.plugins(user1.address)).eq(false);
  });

  it("approvePlugin", async () => {
    expect(await router.approvedPlugins(user0.address, user1.address)).eq(false);
    await router.connect(user0).approvePlugin(user1.address);
    expect(await router.approvedPlugins(user0.address, user1.address)).eq(true);
  });

  it("denyPlugin", async () => {
    expect(await router.approvedPlugins(user0.address, user1.address)).eq(false);
    await router.connect(user0).approvePlugin(user1.address);
    expect(await router.approvedPlugins(user0.address, user1.address)).eq(true);
    await router.connect(user0).denyPlugin(user1.address);
    expect(await router.approvedPlugins(user0.address, user1.address)).eq(false);
  });

  it("pluginTransfer", async () => {
    await router.addPlugin(user1.address);
    await router.connect(user0).approvePlugin(user1.address);

    await usdc.mint(user0.address, 2000);
    await usdc.connect(user0).approve(router.address, 1000);
    expect(await usdc.allowance(user0.address, router.address)).eq(1000);
    expect(await usdc.balanceOf(user2.address)).eq(0);
    await router.connect(user1).pluginTransfer(usdc.address, user0.address, user2.address, 800);
    expect(await usdc.allowance(user0.address, router.address)).eq(200);
    expect(await usdc.balanceOf(user2.address)).eq(800);

    await expect(
      router.connect(user2).pluginTransfer(usdc.address, user0.address, user2.address, 1),
    ).to.be.revertedWith("Router: invalid plugin");
    await router.addPlugin(user2.address);
    await expect(
      router.connect(user2).pluginTransfer(usdc.address, user0.address, user2.address, 1),
    ).to.be.revertedWith("Router: plugin not approved");
  });

  it("pluginIncreasePosition", async () => {
    await router.addPlugin(user1.address);
    await router.connect(user0).approvePlugin(user1.address);

    await expect(
      router.connect(user1).pluginIncreasePosition(user0.address, avax.address, avax.address, 1000, true),
    ).to.be.revertedWith("Vault: insufficient collateral for fees");

    await expect(
      router.connect(user2).pluginIncreasePosition(user0.address, avax.address, avax.address, 1000, true),
    ).to.be.revertedWith("Router: invalid plugin");
    await router.addPlugin(user2.address);
    await expect(
      router.connect(user2).pluginIncreasePosition(user0.address, avax.address, avax.address, 1000, true),
    ).to.be.revertedWith("Router: plugin not approved");
  });

  it("pluginDecreasePosition", async () => {
    await router.addPlugin(user1.address);
    await router.connect(user0).approvePlugin(user1.address);

    await expect(
      router
        .connect(user1)
        .pluginDecreasePosition(user0.address, avax.address, avax.address, 100, 1000, true, user0.address),
    ).to.be.revertedWith("Vault: empty position");

    await expect(
      router
        .connect(user2)
        .pluginDecreasePosition(user0.address, avax.address, avax.address, 100, 1000, true, user0.address),
    ).to.be.revertedWith("Router: invalid plugin");
    await router.addPlugin(user2.address);
    await expect(
      router
        .connect(user2)
        .pluginDecreasePosition(user0.address, avax.address, avax.address, 100, 1000, true, user0.address),
    ).to.be.revertedWith("Router: plugin not approved");
  });

  it("swap, buy USDG", async () => {
    await vaultPriceFeed.getPrice(usdc.address, true, true, true);
    await usdc.mint(user0.address, toWei(200, 6));
    await usdc.connect(user0).approve(router.address, toWei(200, 6));

    await expect(
      router.connect(user0).swap([usdc.address, usdg.address], toWei(200, 6), toWei(201, 18), user0.address),
    ).to.be.revertedWith("Router: insufficient amountOut");

    expect(await usdc.balanceOf(user0.address)).eq(toWei(200, 6));
    expect(await usdg.balanceOf(user0.address)).eq(0);
    const tx = await router
      .connect(user0)
      .swap([usdc.address, usdg.address], toWei(200, 6), toWei(199, 18), user0.address);
    await reportGasUsed(tx, "buyUSDG gas used");
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await usdg.balanceOf(user0.address)).eq("199400000000000000000"); // 199.4
  });

  it("swap, sell USDG", async () => {
    await usdc.mint(user0.address, toWei(200, 6));
    await usdc.connect(user0).approve(router.address, toWei(200, 6));

    await expect(
      router.connect(user0).swap([usdc.address, usdg.address], toWei(200, 6), toWei(201, 18), user0.address),
    ).to.be.revertedWith("Router: insufficient amountOut");

    expect(await usdc.balanceOf(user0.address)).eq(toWei(200, 6));
    expect(await usdg.balanceOf(user0.address)).eq(0);
    const tx = await router
      .connect(user0)
      .swap([usdc.address, usdg.address], toWei(200, 6), toWei(199, 18), user0.address);
    await reportGasUsed(tx, "sellUSDG gas used");
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await usdg.balanceOf(user0.address)).eq("199400000000000000000"); // 199.4

    await usdg.connect(user0).approve(router.address, toWei(100, 18));
    await expect(
      router.connect(user0).swap([usdg.address, usdc.address], toWei(100, 18), toWei(100, 6), user0.address),
    ).to.be.revertedWith("Router: insufficient amountOut");

    await router
      .connect(user0)
      .swap([usdg.address, usdc.address], toWei(100, 18), toWei(99, 6), user0.address);
    expect(await usdc.balanceOf(user0.address)).eq("99700000"); // 99.7
    expect(await usdg.balanceOf(user0.address)).eq("99400000000000000000"); // 99.4
  });

  it("swap, path.length == 2", async () => {
    await btc.mint(user0.address, toWei(1, 8));
    await btc.connect(user0).approve(router.address, toWei(1, 8));
    await expect(
      router.connect(user0).swap([btc.address, usdg.address], toWei(1, 8), toWei(60000, 18), user0.address),
    ).to.be.revertedWith("Router: insufficient amountOut");
    await router
      .connect(user0)
      .swap([btc.address, usdg.address], toWei(1, 8), toWei(59000, 18), user0.address);

    await usdc.mint(user0.address, toWei(30000, 6));
    await usdc.connect(user0).approve(router.address, toWei(30000, 6));
    await expect(
      router.connect(user0).swap([usdc.address, btc.address], toWei(30000, 6), "50000000", user0.address),
    ) // 0.5 BTC
      .to.be.revertedWith("Router: insufficient amountOut");

    expect(await usdc.balanceOf(user0.address)).eq(toWei(30000, 6));
    expect(await btc.balanceOf(user0.address)).eq(0);
    const tx = await router
      .connect(user0)
      .swap([usdc.address, btc.address], toWei(30000, 6), "49000000", user0.address);
    await reportGasUsed(tx, "swap gas used");
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await btc.balanceOf(user0.address)).eq("49850000"); // 0.4985
  });

  it("swap, path.length == 3", async () => {
    await btc.mint(user0.address, toWei(1, 8));
    await btc.connect(user0).approve(router.address, toWei(1, 8));
    await router
      .connect(user0)
      .swap([btc.address, usdg.address], toWei(1, 8), toWei(59000, 18), user0.address);

    await usdc.mint(user0.address, toWei(30000, 6));
    await usdc.connect(user0).approve(router.address, toWei(30000, 6));
    await router
      .connect(user0)
      .swap([usdc.address, usdg.address], toWei(30000, 6), toWei(29000, 18), user0.address);

    await usdg.connect(user0).approve(router.address, toWei(20000, 18));

    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await usdg.balanceOf(user0.address)).eq(toWei(89730, 18));
    await expect(
      router
        .connect(user0)
        .swap([usdg.address, usdc.address, usdg.address], toWei(20000, 18), toWei(20000, 18), user0.address),
    ).to.be.revertedWith("Router: insufficient amountOut");

    await router
      .connect(user0)
      .swap([usdg.address, usdc.address, usdg.address], toWei(20000, 18), toWei(19000, 18), user0.address);
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await usdg.balanceOf(user0.address)).eq("89610180000000000000000"); // 89610.18

    await usdg.connect(user0).approve(router.address, toWei(40000, 18));
    await expect(
      router
        .connect(user0)
        .swap([usdg.address, usdc.address, btc.address], toWei(30000, 18), toWei(39000, 18), user0.address),
    ).to.be.revertedWith("Vault: poolAmount exceeded"); // this reverts as some usdc has been transferred from the pool to the fee reserve

    expect(await vault.poolAmounts(usdc.address)).eq("29790180000"); // 29790.18
    expect(await vault.feeReserves(usdc.address)).eq("209820000"); // 209.82

    await expect(
      router
        .connect(user0)
        .swap([usdg.address, usdc.address, btc.address], toWei(20000, 18), "34000000", user0.address),
    ).to.be.revertedWith("Router: insufficient amountOut");

    const tx = await router
      .connect(user0)
      .swap([usdg.address, usdc.address, btc.address], toWei(20000, 18), "33000000", user0.address);
    await reportGasUsed(tx, "swap gas used");
    expect(await usdg.balanceOf(user0.address)).eq("69610180000000000000000"); // 69610.18
    expect(await btc.balanceOf(user0.address)).eq("33133600"); // 0.33133600 BTC
  });

  it("swap, increasePosition", async () => {
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(600));
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1));

    const avaxUsdc = (await ship.deploy(PancakePair__factory)).contract;
    await avaxUsdc.setReserves(toWei(1000, 18), toWei(300 * 1000, 18));

    const ethAvax = (await ship.deploy(PancakePair__factory)).contract;
    await ethAvax.setReserves(toWei(800, 18), toWei(100, 18));

    const btcAvax = (await ship.deploy(PancakePair__factory)).contract;
    await btcAvax.setReserves(toWei(10, 18), toWei(2000, 18));

    await vaultPriceFeed.setTokens(btc.address, eth.address, avax.address);
    await vaultPriceFeed.setPairs(avaxUsdc.address, ethAvax.address, btcAvax.address);

    await btc.mint(user0.address, toWei(1, 8));
    await btc.connect(user0).approve(router.address, toWei(1, 8));
    await router
      .connect(user0)
      .swap([btc.address, usdg.address], toWei(1, 8), toWei(59000, 18), user0.address);

    await usdc.mint(user0.address, toWei(200, 6));
    await usdc.connect(user0).approve(router.address, toWei(200, 6));

    await expect(
      router
        .connect(user0)
        .increasePosition(
          [usdc.address, btc.address],
          btc.address,
          toWei(200, 6),
          "333333",
          toUsd(1200),
          true,
          toUsd(60000),
        ),
    ).to.be.revertedWith("Router: insufficient amountOut");

    await expect(
      router
        .connect(user0)
        .increasePosition(
          [usdc.address, btc.address],
          btc.address,
          toWei(200, 6),
          "323333",
          toUsd(1200),
          true,
          toUsd(60000 - 1),
        ),
    ).to.be.revertedWith("Router: mark price higher than limit");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));

    await vaultPriceFeed.setPriceSampleSpace(2);

    const tx = await router
      .connect(user0)
      .increasePosition(
        [usdc.address, btc.address],
        btc.address,
        toWei(200, 6),
        "323333",
        toUsd(1200),
        true,
        toUsd(60000),
      );
    await reportGasUsed(tx, "increasePosition gas used");
  });

  it("decreasePositionAndSwap", async () => {
    await btc.mint(user0.address, toWei(1, 8));
    await btc.connect(user0).approve(router.address, toWei(1, 8));
    await router
      .connect(user0)
      .swap([btc.address, usdg.address], toWei(1, 8), toWei(59000, 18), user0.address);

    await usdc.mint(user0.address, toWei(30000, 6));
    await usdc.connect(user0).approve(router.address, toWei(30000, 6));
    await router
      .connect(user0)
      .swap([usdc.address, usdg.address], toWei(30000, 6), toWei(29000, 18), user0.address);

    await usdc.mint(user0.address, toWei(200, 6));
    await usdc.connect(user0).approve(router.address, toWei(200, 6));
    await router
      .connect(user0)
      .increasePosition(
        [usdc.address, btc.address],
        btc.address,
        toWei(200, 6),
        "323333",
        toUsd(1200),
        true,
        toUsd(60000),
      );

    await expect(
      router
        .connect(user0)
        .decreasePositionAndSwap(
          [btc.address, usdc.address],
          btc.address,
          0,
          toUsd(1200),
          true,
          user1.address,
          toUsd(60000),
          toWei(197, 6),
        ),
    ).to.be.revertedWith("Router: insufficient amountOut");

    expect(await usdc.balanceOf(user1.address)).eq(0);
    expect(await usdc.balanceOf(router.address)).eq(0);

    await router
      .connect(user0)
      .decreasePositionAndSwap(
        [btc.address, usdc.address],
        btc.address,
        0,
        toUsd(1200),
        true,
        user1.address,
        toUsd(60000),
        toWei(196, 6),
      );

    expect(await usdc.balanceOf(user1.address)).eq("196389060"); // 196.389060
    expect(await usdc.balanceOf(router.address)).eq(0);
  });

  it("decreasePositionAndSwapETH", async () => {
    await btc.mint(user0.address, toWei(1, 8));
    await btc.connect(user0).approve(router.address, toWei(1, 8));
    await router
      .connect(user0)
      .swap([btc.address, usdg.address], toWei(1, 8), toWei(59000, 18), user0.address);

    await usdc.mint(user0.address, toWei(30000, 6));
    await usdc.connect(user0).approve(router.address, toWei(30000, 6));
    await router
      .connect(user0)
      .swap([usdc.address, usdg.address], toWei(30000, 6), toWei(29000, 18), user0.address);

    await avax.mint(user0.address, toWei(10, 18));
    await avax.connect(user0).approve(router.address, toWei(10, 18));
    await router
      .connect(user0)
      .swap([avax.address, usdg.address], toWei(10, 18), toWei(2900, 18), user0.address);

    await usdc.mint(user0.address, toWei(200, 6));
    await usdc.connect(user0).approve(router.address, toWei(200, 6));
    await router
      .connect(user0)
      .increasePosition(
        [usdc.address, btc.address],
        btc.address,
        toWei(200, 6),
        "323333",
        toUsd(1200),
        true,
        toUsd(60000),
      );

    const wallet0 = Wallet.createRandom();

    expect(await ship.provider.getBalance(wallet0.address)).eq(0);
    expect(await ship.provider.getBalance(router.address)).eq(0);

    await router
      .connect(user0)
      .decreasePositionAndSwapETH(
        [btc.address, avax.address],
        btc.address,
        0,
        toUsd(1200),
        true,
        wallet0.address,
        toUsd(60000),
        "0",
      );

    expect(await ship.provider.getBalance(wallet0.address)).eq("654630200000000000"); // 0.6546302
    expect(await ship.provider.getBalance(router.address)).eq(0);
  });
});
