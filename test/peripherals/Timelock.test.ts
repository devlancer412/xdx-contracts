import {
  Token,
  Vault,
  XlxManager,
  XLX,
  VaultUtils,
  VaultPriceFeed,
  USDG,
  Router,
  Timelock,
  RewardTracker,
  RewardRouterV2,
  TokenManager,
  PriceFeed,
  XDX,
  Vester,
  RewardDistributor,
  Vault__factory,
  VaultUtils__factory,
  VaultPriceFeed__factory,
  XLX__factory,
  XDX__factory,
  XlxManager__factory,
  USDG__factory,
  Router__factory,
  Timelock__factory,
  RewardRouterV2__factory,
  TokenManager__factory,
} from "../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { advanceTimeAndBlock, Ship, toChainlinkPrice, toUsd, toWei } from "../../utils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { utils } from "ethers";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let vault: Vault;
let vaultUtils: VaultUtils;
let vaultPriceFeed: VaultPriceFeed;
let xlxManager: XlxManager;
let xlx: XLX;
let xdx: XDX;
let usdg: USDG;
let router: Router;
let timelock: Timelock;
let feeXlxTracker: RewardTracker;
let stakedXlxTracker: RewardTracker;
let rewardRouter: RewardRouterV2;
let tokenManager: TokenManager;
let xdxVester: Vester;
let stakedXdxDistributor: RewardDistributor;

let avax: Token;
let avaxPriceFeed: PriceFeed;
let usdc: Token;
let usdcPriceFeed: PriceFeed;

let deployer: SignerWithAddress;
let signer1: SignerWithAddress;
let signer2: SignerWithAddress;
let user0: SignerWithAddress;
let user1: SignerWithAddress;
let user2: SignerWithAddress;
let user3: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture([
    "vault",
    "vaultUtils",
    "vaultPriceFeed",
    "xlxManager",
    "xlx",
    "xdx",
    "usdg",
    "router",
    "timelock",
    "feeXlxTracker",
    "stakedXlxTracker",
    "rewardRouter",
    "tokenManager",
    "xdxVester",
    "stakedXdxDistributor",
  ]);

  return {
    ship,
    accounts,
    users,
  };
});

describe("Timelock", () => {
  beforeEach(async () => {
    const { accounts, users } = await setup();

    deployer = accounts.deployer;
    signer1 = accounts.signer1;
    signer2 = accounts.signer2;
    user0 = users[0];
    user1 = users[1];
    user2 = users[2];
    user3 = users[3];

    avax = (await ship.connect("avax")) as Token;
    avaxPriceFeed = (await ship.connect("avaxPriceFeed")) as PriceFeed;
    usdc = (await ship.connect("usdc")) as Token;
    usdcPriceFeed = (await ship.connect("usdcPriceFeed")) as PriceFeed;

    vault = await ship.connect(Vault__factory);
    vaultUtils = await ship.connect(VaultUtils__factory);
    vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
    xlx = await ship.connect(XLX__factory);
    xdx = await ship.connect(XDX__factory);
    xlxManager = await ship.connect(XlxManager__factory);
    usdg = await ship.connect(USDG__factory);
    router = await ship.connect(Router__factory);
    timelock = await ship.connect(Timelock__factory);
    feeXlxTracker = (await ship.connect("FeeXlxTracker")) as RewardTracker;
    stakedXlxTracker = (await ship.connect("StakedXlxTracker")) as RewardTracker;
    rewardRouter = await ship.connect(RewardRouterV2__factory);
    tokenManager = await ship.connect(TokenManager__factory);
    xdxVester = (await ship.connect("XdxVester")) as Vester;
    stakedXdxDistributor = (await ship.connect("StakedXdxDistributor")) as RewardDistributor;

    await vault.setManager(router.address, true);
    await vault.clearTokenConfig(avax.address);
    await vault.setGov(timelock.address);
    await vaultPriceFeed.setIsSecondaryPriceEnabled(false);

    await timelock.connect(deployer).setBuffer(3 * 24 * 60 * 60);
  });

  it("inits", async () => {
    expect(await usdg.gov()).eq(deployer.address);
    expect(await usdg.vaults(vault.address)).eq(true);
    expect(await usdg.vaults(user0.address)).eq(false);

    expect(await vault.gov()).eq(timelock.address);
    expect(await vault.isInitialized()).eq(true);
    expect(await vault.router()).eq(router.address);
    expect(await vault.usdg()).eq(usdg.address);
    expect(await vault.liquidationFeeUsd()).eq(toUsd(5));
    expect(await vault.fundingRateFactor()).eq(100);

    expect(await timelock.admin()).eq(deployer.address);
    expect(await timelock.buffer()).eq(3 * 24 * 60 * 60);
    expect(await timelock.tokenManager()).eq(tokenManager.address);
    expect(await timelock.maxTokenSupply()).eq(toWei(13250000, 18));

    await expect(
      ship.deploy(Timelock__factory, {
        aliasName: "DeployTest",
        args: [
          deployer.address, // admin
          5 * 24 * 60 * 60 + 1, // buffer
          tokenManager.address, // tokenManager
          rewardRouter.address, // mintReceiver
          xlxManager.address, // xlxManager
          user0.address, // rewardRouter
          1000, // maxTokenSupply
          10, // marginFeeBasisPoints
          100, // maxMarginFeeBasisPoints
        ],
      }),
    ).to.be.revertedWith("Timelock: invalid _buffer");
  });

  it("setTokenConfig", async () => {
    await timelock.connect(deployer).signalSetPriceFeed(vault.address, vaultPriceFeed.address);
    await advanceTimeAndBlock(5 * 24 * 60 * 60 + 10);
    await timelock.connect(deployer).setPriceFeed(vault.address, vaultPriceFeed.address);

    await avaxPriceFeed.setLatestAnswer(500);

    await expect(
      timelock.connect(user0).setTokenConfig(vault.address, avax.address, 100, 200, 1000, 0, 0),
    ).to.be.revertedWith("Timelock: forbidden");

    await expect(
      timelock.connect(deployer).setTokenConfig(vault.address, avax.address, 100, 200, 1000, 0, 0),
    ).to.be.revertedWith("Timelock: token not yet whitelisted");

    await timelock.connect(deployer).signalVaultSetTokenConfig(
      vault.address,
      avax.address, // _token
      12, // _tokenDecimals
      7000, // _tokenWeight
      300, // _minProfitBps
      5000, // _maxUsdgAmount
      false, // _isStable
      true, // isShortable
    );

    await advanceTimeAndBlock(5 * 24 * 60 * 60);

    await timelock.connect(deployer).vaultSetTokenConfig(
      vault.address,
      avax.address, // _token
      12, // _tokenDecimals
      7000, // _tokenWeight
      300, // _minProfitBps
      5000, // _maxUsdgAmount
      false, // _isStable
      true, // isShortable
    );

    expect(await vault.whitelistedTokenCount()).eq(6);
    expect(await vault.totalTokenWeights()).eq(100000);
    expect(await vault.whitelistedTokens(avax.address)).eq(true);
    expect(await vault.tokenDecimals(avax.address)).eq(12);
    expect(await vault.tokenWeights(avax.address)).eq(7000);
    expect(await vault.minProfitBasisPoints(avax.address)).eq(300);
    expect(await vault.maxUsdgAmounts(avax.address)).eq(5000);
    expect(await vault.stableTokens(avax.address)).eq(false);
    expect(await vault.shortableTokens(avax.address)).eq(true);

    await timelock.connect(deployer).setTokenConfig(
      vault.address,
      avax.address,
      100, // _tokenWeight
      200, // _minProfitBps
      1000, // _maxUsdgAmount
      300, // _bufferAmount
      500, // _usdgAmount
    );

    expect(await vault.whitelistedTokenCount()).eq(6);
    expect(await vault.totalTokenWeights()).eq(93100);
    expect(await vault.whitelistedTokens(avax.address)).eq(true);
    expect(await vault.tokenDecimals(avax.address)).eq(12);
    expect(await vault.tokenWeights(avax.address)).eq(100);
    expect(await vault.minProfitBasisPoints(avax.address)).eq(200);
    expect(await vault.maxUsdgAmounts(avax.address)).eq(1000);
    expect(await vault.stableTokens(avax.address)).eq(false);
    expect(await vault.shortableTokens(avax.address)).eq(true);
    expect(await vault.bufferAmounts(avax.address)).eq(300);
    expect(await vault.usdgAmounts(avax.address)).eq(500);

    await timelock.setContractHandler(user0.address, true);

    await timelock.connect(user0).setTokenConfig(
      vault.address,
      avax.address,
      100, // _tokenWeight
      50, // _minProfitBps
      1000, // _maxUsdgAmount
      300, // _bufferAmount
      500, // _usdgAmount
    );

    expect(await vault.minProfitBasisPoints(avax.address)).eq(50);
  });

  it("setUsdgAmounts", async () => {
    expect(await vault.usdgAmounts(avax.address)).eq(0);
    expect(await vault.usdgAmounts(usdc.address)).eq(0);

    await expect(
      timelock.connect(user0).setUsdgAmounts(vault.address, [avax.address, usdc.address], [500, 250]),
    ).to.be.revertedWith("Timelock: forbidden");

    await timelock.connect(deployer).setUsdgAmounts(vault.address, [avax.address, usdc.address], [500, 250]);

    expect(await vault.usdgAmounts(avax.address)).eq(500);
    expect(await vault.usdgAmounts(usdc.address)).eq(250);
  });

  it("updateUsdgSupply", async () => {
    await usdg.addVault(deployer.address);
    await usdg.mint(xlxManager.address, 1000);

    expect(await usdg.balanceOf(xlxManager.address)).eq(1000);
    expect(await usdg.totalSupply()).eq(1000);

    await expect(timelock.connect(user0).updateUsdgSupply(500)).to.be.revertedWith("Timelock: forbidden");

    await expect(timelock.updateUsdgSupply(500)).to.be.revertedWith("YieldToken: forbidden");

    await usdg.setGov(timelock.address);

    await timelock.updateUsdgSupply(500);

    expect(await usdg.balanceOf(xlxManager.address)).eq(500);
    expect(await usdg.totalSupply()).eq(500);

    await timelock.updateUsdgSupply(2000);

    expect(await usdg.balanceOf(xlxManager.address)).eq(2000);
    expect(await usdg.totalSupply()).eq(2000);
  });

  it("setBuffer", async () => {
    await expect(timelock.connect(user0).setBuffer(3 * 24 * 60 * 60 - 10)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    await expect(timelock.connect(deployer).setBuffer(5 * 24 * 60 * 60 + 10)).to.be.revertedWith(
      "Timelock: invalid _buffer",
    );

    await expect(timelock.connect(deployer).setBuffer(3 * 24 * 60 * 60 - 10)).to.be.revertedWith(
      "Timelock: buffer cannot be decreased",
    );

    expect(await timelock.buffer()).eq(3 * 24 * 60 * 60);
    await timelock.connect(deployer).setBuffer(3 * 24 * 60 * 60 + 10);
    expect(await timelock.buffer()).eq(3 * 24 * 60 * 60 + 10);
  });

  it("setVaultUtils", async () => {
    await expect(timelock.connect(user0).setVaultUtils(vault.address, user1.address)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    expect(await vault.vaultUtils()).eq(vaultUtils.address);
    await timelock.connect(deployer).setVaultUtils(vault.address, user1.address);
    expect(await vault.vaultUtils()).eq(user1.address);
  });

  it("setIsSwapEnabled", async () => {
    await expect(timelock.connect(user0).setIsSwapEnabled(vault.address, false)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    expect(await vault.isSwapEnabled()).eq(true);
    await timelock.connect(deployer).setIsSwapEnabled(vault.address, false);
    expect(await vault.isSwapEnabled()).eq(false);
  });

  it("setContractHandler", async () => {
    await expect(timelock.connect(user0).setContractHandler(user1.address, true)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    expect(await timelock.isHandler(user1.address)).eq(false);
    await timelock.connect(deployer).setContractHandler(user1.address, true);
    expect(await timelock.isHandler(user1.address)).eq(true);
  });

  it("initXlxManager", async () => {
    await expect(timelock.connect(user0).initXlxManager()).to.be.revertedWith("Timelock: forbidden");

    await xlx.setGov(timelock.address);
    await usdg.setGov(timelock.address);

    expect(await xlx.isMinter(xlxManager.address)).eq(true);
    expect(await usdg.vaults(xlxManager.address)).eq(true);
    expect(await vault.isManager(xlxManager.address)).eq(true);

    await timelock.initXlxManager();

    expect(await xlx.isMinter(xlxManager.address)).eq(true);
    expect(await usdg.vaults(xlxManager.address)).eq(true);
    expect(await vault.isManager(xlxManager.address)).eq(true);
  });

  it("initRewardRouter", async () => {
    await expect(timelock.connect(user0).initRewardRouter()).to.be.revertedWith("Timelock: forbidden");

    await stakedXlxTracker.setGov(timelock.address);
    await feeXlxTracker.setGov(timelock.address);
    await xlxManager.setGov(timelock.address);

    expect(await stakedXlxTracker.isHandler(rewardRouter.address)).eq(true);
    expect(await feeXlxTracker.isHandler(rewardRouter.address)).eq(true);
    expect(await xlxManager.isHandler(rewardRouter.address)).eq(false);

    await timelock.initRewardRouter();

    expect(await stakedXlxTracker.isHandler(rewardRouter.address)).eq(true);
    expect(await feeXlxTracker.isHandler(rewardRouter.address)).eq(true);
    expect(await xlxManager.isHandler(rewardRouter.address)).eq(true);
  });

  it("setKeeper", async () => {
    await expect(timelock.connect(user0).setKeeper(user1.address, true)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    expect(await timelock.isKeeper(user1.address)).eq(false);
    await timelock.connect(deployer).setKeeper(user1.address, true);
    expect(await timelock.isKeeper(user1.address)).eq(true);
  });

  it("setIsLeverageEnabled", async () => {
    await expect(timelock.connect(user0).setIsLeverageEnabled(vault.address, false)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    expect(await vault.isLeverageEnabled()).eq(true);
    await timelock.connect(deployer).setIsLeverageEnabled(vault.address, false);
    expect(await vault.isLeverageEnabled()).eq(false);

    await timelock.connect(deployer).setIsLeverageEnabled(vault.address, true);
    expect(await vault.isLeverageEnabled()).eq(true);
  });

  it("setMaxGlobalShortSize", async () => {
    await expect(
      timelock.connect(user0).setMaxGlobalShortSize(vault.address, avax.address, 100),
    ).to.be.revertedWith("Timelock: forbidden");

    expect(await vault.maxGlobalShortSizes(avax.address)).eq(0);
    await timelock.connect(deployer).setMaxGlobalShortSize(vault.address, avax.address, 100);
    expect(await vault.maxGlobalShortSizes(avax.address)).eq(100);
  });

  it("setMaxGasPrice", async () => {
    await expect(timelock.connect(user0).setMaxGasPrice(vault.address, 7000000000)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    expect(await vault.maxGasPrice()).eq(0);
    await timelock.connect(deployer).setMaxGasPrice(vault.address, 7000000000);
    expect(await vault.maxGasPrice()).eq(7000000000);
  });

  it("setMaxLeverage", async () => {
    await expect(timelock.connect(user0).setMaxLeverage(vault.address, 100 * 10000)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    await expect(timelock.connect(deployer).setMaxLeverage(vault.address, 49 * 10000)).to.be.revertedWith(
      "Timelock: invalid _maxLeverage",
    );

    expect(await vault.maxLeverage()).eq(50 * 10000);
    await timelock.connect(deployer).setMaxLeverage(vault.address, 100 * 10000);
    expect(await vault.maxLeverage()).eq(100 * 10000);
  });

  it("setFundingRate", async () => {
    await expect(timelock.connect(user0).setFundingRate(vault.address, 59 * 60, 100, 100)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    await expect(
      timelock.connect(deployer).setFundingRate(vault.address, 59 * 60, 100, 100),
    ).to.be.revertedWith("Vault: invalid _fundingInterval");

    expect(await vault.fundingRateFactor()).eq(100);
    expect(await vault.stableFundingRateFactor()).eq(100);
    await timelock.connect(deployer).setFundingRate(vault.address, 60 * 60, 0, 100);
    expect(await vault.fundingRateFactor()).eq(0);
    expect(await vault.stableFundingRateFactor()).eq(100);

    await timelock.connect(deployer).setFundingRate(vault.address, 60 * 60, 100, 0);
    expect(await vault.fundingInterval()).eq(60 * 60);
    expect(await vault.fundingRateFactor()).eq(100);
    expect(await vault.stableFundingRateFactor()).eq(0);

    await timelock.setContractHandler(user0.address, true);

    await timelock.connect(user0).setFundingRate(vault.address, 120 * 60, 50, 75);
    expect(await vault.fundingInterval()).eq(120 * 60);
    expect(await vault.fundingRateFactor()).eq(50);
    expect(await vault.stableFundingRateFactor()).eq(75);
  });

  it("transferIn", async () => {
    await avax.mint(user1.address, 1000);
    await expect(timelock.connect(user0).transferIn(user1.address, avax.address, 1000)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    await expect(timelock.connect(deployer).transferIn(user1.address, avax.address, 1000)).to.be.revertedWith(
      "ERC20: transfer amount exceeds allowance",
    );

    await avax.connect(user1).approve(timelock.address, 1000);

    expect(await avax.balanceOf(user1.address)).eq(1000);
    expect(await avax.balanceOf(timelock.address)).eq(0);
    await timelock.connect(deployer).transferIn(user1.address, avax.address, 1000);
    expect(await avax.balanceOf(user1.address)).eq(0);
    expect(await avax.balanceOf(timelock.address)).eq(1000);
  });

  it("approve", async () => {
    await timelock.setContractHandler(user0.address, true);
    await expect(
      timelock.connect(user0).approve(usdc.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("Timelock: forbidden");

    await expect(
      timelock.connect(deployer).approve(usdc.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      timelock.connect(user0).signalApprove(usdc.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("Timelock: forbidden");

    await timelock.connect(deployer).signalApprove(usdc.address, user1.address, toWei(100, 18));

    await expect(
      timelock.connect(deployer).signalApprove(usdc.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("Timelock: action already signalled");

    await expect(
      timelock.connect(deployer).approve(usdc.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(2 * 24 * 60 * 60);

    await expect(
      timelock.connect(deployer).approve(usdc.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(1 * 24 * 60 * 60 + 10);

    await expect(
      timelock.connect(deployer).approve(avax.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      timelock.connect(deployer).approve(usdc.address, user2.address, toWei(100, 18)),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      timelock.connect(deployer).approve(usdc.address, user1.address, toWei(101, 18)),
    ).to.be.revertedWith("Timelock: action not signalled");

    await usdc.mint(timelock.address, toWei(150, 18));

    expect(await usdc.balanceOf(timelock.address)).eq(toWei(150, 18));
    expect(await usdc.balanceOf(user1.address)).eq(0);

    await expect(
      usdc.connect(user1).transferFrom(timelock.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");

    await timelock.connect(deployer).approve(usdc.address, user1.address, toWei(100, 18));
    await expect(
      usdc.connect(user2).transferFrom(timelock.address, user2.address, toWei(100, 18)),
    ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
    await usdc.connect(user1).transferFrom(timelock.address, user1.address, toWei(100, 18));

    expect(await usdc.balanceOf(timelock.address)).eq(toWei(50, 18));
    expect(await usdc.balanceOf(user1.address)).eq(toWei(100, 18));

    await expect(
      usdc.connect(user1).transferFrom(timelock.address, user1.address, toWei(1, 18)),
    ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");

    await expect(
      timelock.connect(deployer).approve(usdc.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("Timelock: action not signalled");

    await timelock.connect(deployer).signalApprove(usdc.address, user1.address, toWei(100, 18));

    await expect(
      timelock.connect(deployer).approve(usdc.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    const action0 = utils.solidityKeccak256(
      ["string", "address", "address", "uint256"],
      ["approve", avax.address, user1.address, toWei(100, 18)],
    );
    const action1 = utils.solidityKeccak256(
      ["string", "address", "address", "uint256"],
      ["approve", usdc.address, user1.address, toWei(100, 18)],
    );

    await expect(timelock.connect(user0).cancelAction(action0)).to.be.revertedWith("Timelock: forbidden");

    await expect(timelock.connect(deployer).cancelAction(action0)).to.be.revertedWith(
      "Timelock: invalid _action",
    );

    await timelock.connect(deployer).cancelAction(action1);

    await expect(
      timelock.connect(deployer).approve(usdc.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("Timelock: action not signalled");
  });

  it("processMint", async () => {
    await timelock.setContractHandler(user0.address, true);
    await xdx.setGov(timelock.address);

    await expect(
      timelock.connect(user0).processMint(xdx.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("Timelock: forbidden");

    await expect(
      timelock.connect(deployer).processMint(xdx.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      timelock.connect(user0).signalMint(xdx.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("Timelock: forbidden");

    await timelock.connect(deployer).signalMint(xdx.address, user1.address, toWei(100, 18));

    await expect(
      timelock.connect(deployer).processMint(xdx.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(2 * 24 * 60 * 60);

    await expect(
      timelock.connect(deployer).processMint(xdx.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(1 * 24 * 60 * 60 + 10);

    await expect(
      timelock.connect(deployer).processMint(avax.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      timelock.connect(deployer).processMint(xdx.address, user2.address, toWei(100, 18)),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      timelock.connect(deployer).processMint(xdx.address, user1.address, toWei(101, 18)),
    ).to.be.revertedWith("Timelock: action not signalled");

    expect(await xdx.balanceOf(timelock.address)).eq(0);
    expect(await xdx.balanceOf(user1.address)).eq(0);

    await timelock.connect(deployer).processMint(xdx.address, user1.address, toWei(100, 18));

    expect(await xdx.balanceOf(timelock.address)).eq(0);
    expect(await xdx.balanceOf(user1.address)).eq(toWei(100, 18));

    await expect(
      timelock.connect(deployer).processMint(xdx.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("Timelock: action not signalled");

    await timelock.connect(deployer).signalMint(xdx.address, user1.address, toWei(100, 18));

    await expect(
      timelock.connect(deployer).processMint(xdx.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    const action0 = utils.solidityKeccak256(
      ["string", "address", "address", "uint256"],
      ["mint", avax.address, user1.address, toWei(100, 18)],
    );
    const action1 = utils.solidityKeccak256(
      ["string", "address", "address", "uint256"],
      ["mint", xdx.address, user1.address, toWei(100, 18)],
    );

    await expect(timelock.connect(user0).cancelAction(action0)).to.be.revertedWith("Timelock: forbidden");

    await expect(timelock.connect(deployer).cancelAction(action0)).to.be.revertedWith(
      "Timelock: invalid _action",
    );

    await timelock.connect(deployer).cancelAction(action1);

    await expect(
      timelock.connect(deployer).processMint(xdx.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("Timelock: action not signalled");
  });

  it("setHandler", async () => {
    await timelock.setContractHandler(user0.address, true);

    await xdxVester.setGov(timelock.address);

    await expect(
      timelock.connect(user0).setHandler(xdxVester.address, user1.address, true),
    ).to.be.revertedWith("Timelock: forbidden");

    await expect(
      timelock.connect(deployer).setHandler(xdxVester.address, user1.address, true),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      timelock.connect(user0).signalSetHandler(xdxVester.address, user1.address, true),
    ).to.be.revertedWith("Timelock: forbidden");

    await timelock.connect(deployer).signalSetHandler(xdxVester.address, user1.address, true);

    await expect(
      timelock.connect(deployer).setHandler(xdxVester.address, user1.address, true),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(2 * 24 * 60 * 60);

    await expect(
      timelock.connect(deployer).setHandler(xdxVester.address, user1.address, true),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(1 * 24 * 60 * 60 + 10);

    await expect(timelock.connect(deployer).setHandler(avax.address, user1.address, true)).to.be.revertedWith(
      "Timelock: action not signalled",
    );

    await expect(
      timelock.connect(deployer).setHandler(xdxVester.address, user2.address, true),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      timelock.connect(deployer).setHandler(xdxVester.address, user1.address, false),
    ).to.be.revertedWith("Timelock: action not signalled");

    expect(await xdxVester.isHandler(user1.address)).eq(false);
    await timelock.connect(deployer).setHandler(xdxVester.address, user1.address, true);
    expect(await xdxVester.isHandler(user1.address)).eq(true);

    await expect(
      timelock.connect(deployer).setHandler(xdxVester.address, user1.address, true),
    ).to.be.revertedWith("Timelock: action not signalled");

    await timelock.connect(deployer).signalSetHandler(xdxVester.address, user1.address, true);

    await expect(
      timelock.connect(deployer).setHandler(xdxVester.address, user1.address, true),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    const action0 = utils.solidityKeccak256(
      ["string", "address", "address", "bool"],
      ["setHandler", avax.address, user1.address, true],
    );
    const action1 = utils.solidityKeccak256(
      ["string", "address", "address", "bool"],
      ["setHandler", xdxVester.address, user1.address, true],
    );

    await expect(timelock.connect(user0).cancelAction(action0)).to.be.revertedWith("Timelock: forbidden");

    await expect(timelock.connect(deployer).cancelAction(action0)).to.be.revertedWith(
      "Timelock: invalid _action",
    );

    await timelock.connect(deployer).cancelAction(action1);

    await expect(
      timelock.connect(deployer).setHandler(xdxVester.address, user1.address, true),
    ).to.be.revertedWith("Timelock: action not signalled");
  });

  it("setGov", async () => {
    await timelock.setContractHandler(user0.address, true);

    await expect(timelock.connect(user0).setGov(vault.address, user1.address)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    await expect(timelock.connect(deployer).setGov(vault.address, user1.address)).to.be.revertedWith(
      "Timelock: action not signalled",
    );

    await expect(timelock.connect(user0).signalSetGov(vault.address, user1.address)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    await timelock.connect(deployer).signalSetGov(vault.address, user1.address);

    await expect(timelock.connect(deployer).setGov(vault.address, user1.address)).to.be.revertedWith(
      "Timelock: action time not yet passed",
    );

    await advanceTimeAndBlock(2 * 24 * 60 * 60);

    await expect(timelock.connect(deployer).setGov(vault.address, user1.address)).to.be.revertedWith(
      "Timelock: action time not yet passed",
    );

    await advanceTimeAndBlock(1 * 24 * 60 * 60 + 10);

    await expect(timelock.connect(deployer).setGov(user2.address, user1.address)).to.be.revertedWith(
      "Timelock: action not signalled",
    );

    await expect(timelock.connect(deployer).setGov(vault.address, user2.address)).to.be.revertedWith(
      "Timelock: action not signalled",
    );

    expect(await vault.gov()).eq(timelock.address);
    await timelock.connect(deployer).setGov(vault.address, user1.address);
    expect(await vault.gov()).eq(user1.address);

    await timelock.connect(deployer).signalSetGov(vault.address, user2.address);

    await expect(timelock.connect(deployer).setGov(vault.address, user2.address)).to.be.revertedWith(
      "Timelock: action time not yet passed",
    );

    const action0 = utils.solidityKeccak256(
      ["string", "address", "address"],
      ["setGov", user1.address, user2.address],
    );
    const action1 = utils.solidityKeccak256(
      ["string", "address", "address"],
      ["setGov", vault.address, user2.address],
    );

    await expect(timelock.connect(deployer).cancelAction(action0)).to.be.revertedWith(
      "Timelock: invalid _action",
    );

    await timelock.connect(deployer).cancelAction(action1);

    await expect(timelock.connect(deployer).setGov(vault.address, user2.address)).to.be.revertedWith(
      "Timelock: action not signalled",
    );
  });

  it("setPriceFeed", async () => {
    await timelock.setContractHandler(user0.address, true);

    await expect(timelock.connect(user0).setPriceFeed(vault.address, user1.address)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    await expect(timelock.connect(deployer).setPriceFeed(vault.address, user1.address)).to.be.revertedWith(
      "Timelock: action not signalled",
    );

    await expect(timelock.connect(user0).signalSetPriceFeed(vault.address, user1.address)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    await timelock.connect(deployer).signalSetPriceFeed(vault.address, user1.address);

    await expect(timelock.connect(deployer).setPriceFeed(vault.address, user1.address)).to.be.revertedWith(
      "Timelock: action time not yet passed",
    );

    await advanceTimeAndBlock(2 * 24 * 60 * 60);

    await expect(timelock.connect(deployer).setPriceFeed(vault.address, user1.address)).to.be.revertedWith(
      "Timelock: action time not yet passed",
    );

    await advanceTimeAndBlock(1 * 24 * 60 * 60 + 10);

    await expect(timelock.connect(deployer).setPriceFeed(user2.address, user1.address)).to.be.revertedWith(
      "Timelock: action not signalled",
    );

    await expect(timelock.connect(deployer).setPriceFeed(vault.address, user2.address)).to.be.revertedWith(
      "Timelock: action not signalled",
    );

    expect(await vault.priceFeed()).eq(vaultPriceFeed.address);
    await timelock.connect(deployer).setPriceFeed(vault.address, user1.address);
    expect(await vault.priceFeed()).eq(user1.address);

    await timelock.connect(deployer).signalSetPriceFeed(vault.address, user2.address);

    await expect(timelock.connect(deployer).setPriceFeed(vault.address, user2.address)).to.be.revertedWith(
      "Timelock: action time not yet passed",
    );

    const action0 = utils.solidityKeccak256(
      ["string", "address", "address"],
      ["setPriceFeed", user1.address, user2.address],
    );
    const action1 = utils.solidityKeccak256(
      ["string", "address", "address"],
      ["setPriceFeed", vault.address, user2.address],
    );

    await expect(timelock.connect(deployer).cancelAction(action0)).to.be.revertedWith(
      "Timelock: invalid _action",
    );

    await timelock.connect(deployer).cancelAction(action1);

    await expect(timelock.connect(deployer).setPriceFeed(vault.address, user2.address)).to.be.revertedWith(
      "Timelock: action not signalled",
    );
  });

  it("withdrawToken", async () => {
    await timelock.setContractHandler(user0.address, true);

    await xdx.setGov(timelock.address);

    await expect(
      timelock.connect(user0).withdrawToken(xdx.address, avax.address, user0.address, 100),
    ).to.be.revertedWith("Timelock: forbidden");

    await expect(
      timelock.connect(deployer).withdrawToken(xdx.address, avax.address, user0.address, 100),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      timelock.connect(user0).signalWithdrawToken(xdx.address, avax.address, user0.address, 100),
    ).to.be.revertedWith("Timelock: forbidden");

    await timelock.connect(deployer).signalWithdrawToken(xdx.address, avax.address, user0.address, 100);

    await expect(
      timelock.connect(deployer).withdrawToken(xdx.address, avax.address, user0.address, 100),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(2 * 24 * 60 * 60);

    await expect(
      timelock.connect(deployer).withdrawToken(xdx.address, avax.address, user0.address, 100),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(1 * 24 * 60 * 60 + 10);

    await expect(
      timelock.connect(deployer).withdrawToken(usdc.address, avax.address, user0.address, 100),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      timelock.connect(deployer).withdrawToken(xdx.address, usdc.address, user0.address, 100),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      timelock.connect(deployer).withdrawToken(xdx.address, avax.address, user1.address, 100),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      timelock.connect(deployer).withdrawToken(xdx.address, avax.address, user0.address, 101),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      timelock.connect(deployer).withdrawToken(xdx.address, avax.address, user0.address, 100),
    ).to.be.revertedWith("ERC20: transfer amount exceeds balance");

    await avax.mint(xdx.address, 100);
    expect(await avax.balanceOf(user0.address)).eq(0);
    await timelock.connect(deployer).withdrawToken(xdx.address, avax.address, user0.address, 100);
    expect(await avax.balanceOf(user0.address)).eq(100);
  });

  it("vaultSetTokenConfig", async () => {
    await timelock.setContractHandler(user0.address, true);

    await timelock.connect(deployer).signalSetPriceFeed(vault.address, vaultPriceFeed.address);
    await advanceTimeAndBlock(5 * 24 * 60 * 60 + 10);
    await timelock.connect(deployer).setPriceFeed(vault.address, vaultPriceFeed.address);

    await usdcPriceFeed.setLatestAnswer(1);

    await expect(
      timelock.connect(user0).vaultSetTokenConfig(
        vault.address,
        usdc.address, // _token
        12, // _tokenDecimals
        7000, // _tokenWeight
        120, // _minProfitBps
        5000, // _maxUsdgAmount
        true, // _isStable
        false, // isShortable
      ),
    ).to.be.revertedWith("Timelock: forbidden");

    await expect(
      timelock.connect(deployer).vaultSetTokenConfig(
        vault.address,
        usdc.address, // _token
        12, // _tokenDecimals
        7000, // _tokenWeight
        120, // _minProfitBps
        5000, // _maxUsdgAmount
        true, // _isStable
        false, // isShortable
      ),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      timelock.connect(user0).signalVaultSetTokenConfig(
        vault.address,
        usdc.address, // _token
        12, // _tokenDecimals
        7000, // _tokenWeight
        120, // _minProfitBps
        5000, // _maxUsdgAmount
        true, // _isStable
        false, // isShortable
      ),
    ).to.be.revertedWith("Timelock: forbidden");

    await timelock.connect(deployer).signalVaultSetTokenConfig(
      vault.address,
      usdc.address, // _token
      12, // _tokenDecimals
      7000, // _tokenWeight
      120, // _minProfitBps
      5000, // _maxUsdgAmount
      true, // _isStable
      false, // isShortable
    );

    await expect(
      timelock.connect(deployer).vaultSetTokenConfig(
        vault.address,
        usdc.address, // _token
        12, // _tokenDecimals
        7000, // _tokenWeight
        120, // _minProfitBps
        5000, // _maxUsdgAmount
        true, // _isStable
        false, // isShortable
      ),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(2 * 24 * 60 * 60);

    await expect(
      timelock.connect(deployer).vaultSetTokenConfig(
        vault.address,
        usdc.address, // _token
        12, // _tokenDecimals
        7000, // _tokenWeight
        120, // _minProfitBps
        5000, // _maxUsdgAmount
        true, // _isStable
        false, // isShortable
      ),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(1 * 24 * 60 * 60 + 10);

    await expect(
      timelock.connect(deployer).vaultSetTokenConfig(
        vault.address,
        usdc.address, // _token
        15, // _tokenDecimals
        7000, // _tokenWeight
        120, // _minProfitBps
        5000, // _maxUsdgAmount
        true, // _isStable
        false, // isShortable
      ),
    ).to.be.revertedWith("Timelock: action not signalled");

    expect(await vault.totalTokenWeights()).eq(93000);
    expect(await vault.whitelistedTokens(usdc.address)).eq(true);
    expect(await vault.tokenDecimals(usdc.address)).eq(6);
    expect(await vault.tokenWeights(usdc.address)).eq(47000);
    expect(await vault.minProfitBasisPoints(usdc.address)).eq(75);
    expect(await vault.maxUsdgAmounts(usdc.address)).eq(toWei(50 * 1000 * 1000, 30));
    expect(await vault.stableTokens(usdc.address)).eq(true);
    expect(await vault.shortableTokens(usdc.address)).eq(false);

    await timelock.connect(deployer).vaultSetTokenConfig(
      vault.address,
      usdc.address, // _token
      12, // _tokenDecimals
      7000, // _tokenWeight
      120, // _minProfitBps
      5000, // _maxUsdgAmount
      true, // _isStable
      false, // isShortable
    );

    expect(await vault.totalTokenWeights()).eq(53000);
    expect(await vault.whitelistedTokens(usdc.address)).eq(true);
    expect(await vault.tokenDecimals(usdc.address)).eq(12);
    expect(await vault.tokenWeights(usdc.address)).eq(7000);
    expect(await vault.minProfitBasisPoints(usdc.address)).eq(120);
    expect(await vault.maxUsdgAmounts(usdc.address)).eq(5000);
    expect(await vault.stableTokens(usdc.address)).eq(true);
    expect(await vault.shortableTokens(usdc.address)).eq(false);
  });

  it("setInPrivateTransferMode", async () => {
    await xdx.setMinter(deployer.address, true);
    await xdx.mint(user0.address, 100);
    await expect(timelock.connect(user0).setInPrivateTransferMode(xdx.address, true)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    await expect(timelock.connect(deployer).setInPrivateTransferMode(xdx.address, true)).to.be.revertedWith(
      "BaseToken: forbidden",
    );

    await xdx.setGov(timelock.address);

    expect(await xdx.inPrivateTransferMode()).eq(false);
    await timelock.connect(deployer).setInPrivateTransferMode(xdx.address, true);
    expect(await xdx.inPrivateTransferMode()).eq(true);

    await timelock.connect(deployer).setInPrivateTransferMode(xdx.address, false);
    expect(await xdx.inPrivateTransferMode()).eq(false);

    await timelock.connect(deployer).setInPrivateTransferMode(xdx.address, true);
    expect(await xdx.inPrivateTransferMode()).eq(true);

    await expect(xdx.connect(user0).transfer(user1.address, 100)).to.be.revertedWith(
      "BaseToken: msg.sender not whitelisted",
    );

    await timelock.connect(deployer).setInPrivateTransferMode(xdx.address, false);
    expect(await xdx.inPrivateTransferMode()).eq(false);

    await xdx.connect(user0).transfer(user1.address, 100);
  });

  it("batchSetBonusRewards", async () => {
    await xdxVester.setGov(timelock.address);

    const accounts = [user1.address, user2.address, user3.address];
    const amounts = [700, 500, 900];

    await expect(
      timelock.connect(user0).batchSetBonusRewards(xdxVester.address, accounts, amounts),
    ).to.be.revertedWith("Timelock: forbidden");

    expect(await xdxVester.bonusRewards(user1.address)).eq(0);
    expect(await xdxVester.bonusRewards(user2.address)).eq(0);
    expect(await xdxVester.bonusRewards(user3.address)).eq(0);
    await timelock.connect(deployer).batchSetBonusRewards(xdxVester.address, accounts, amounts);
    expect(await xdxVester.bonusRewards(user1.address)).eq(700);
    expect(await xdxVester.bonusRewards(user2.address)).eq(500);
    expect(await xdxVester.bonusRewards(user3.address)).eq(900);
  });

  it("setAdmin", async () => {
    await expect(timelock.setAdmin(user1.address)).to.be.revertedWith("Timelock: forbidden");

    expect(await timelock.admin()).eq(deployer.address);
    await tokenManager.connect(signer1).signalSetAdmin(timelock.address, user1.address);
    await tokenManager.connect(signer2).signSetAdmin(timelock.address, user1.address, 1);
    await tokenManager.connect(signer1).setAdmin(timelock.address, user1.address, 1);
    expect(await timelock.admin()).eq(user1.address);
  });

  it("setExternalAdmin", async () => {
    await stakedXdxDistributor.setGov(timelock.address);
    await expect(
      timelock.connect(user0).setExternalAdmin(stakedXdxDistributor.address, user3.address),
    ).to.be.revertedWith("Timelock: forbidden");

    expect(await stakedXdxDistributor.admin()).eq(deployer.address);
    await timelock.connect(deployer).setExternalAdmin(stakedXdxDistributor.address, user3.address);
    expect(await stakedXdxDistributor.admin()).eq(user3.address);

    await expect(
      timelock.connect(deployer).setExternalAdmin(timelock.address, user3.address),
    ).to.be.revertedWith("Timelock: invalid _target");
  });

  it("setShouldToggleIsLeverageEnabled", async () => {
    await expect(timelock.connect(user0).setShouldToggleIsLeverageEnabled(true)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    expect(await timelock.shouldToggleIsLeverageEnabled()).to.be.true;
    await timelock.setShouldToggleIsLeverageEnabled(false);
    expect(await timelock.shouldToggleIsLeverageEnabled()).to.be.false;
    await timelock.setShouldToggleIsLeverageEnabled(true);
    expect(await timelock.shouldToggleIsLeverageEnabled()).to.be.true;

    await timelock.setContractHandler(user0.address, true);
    await timelock.connect(user0).setShouldToggleIsLeverageEnabled(true);
    expect(await timelock.shouldToggleIsLeverageEnabled()).to.be.true;
  });

  it("setMarginFeeBasisPoints", async () => {
    await expect(timelock.connect(user0).setMarginFeeBasisPoints(100, 1000)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    expect(await timelock.marginFeeBasisPoints()).eq(10);
    expect(await timelock.maxMarginFeeBasisPoints()).eq(500);

    await timelock.setMarginFeeBasisPoints(100, 1000);
    expect(await timelock.marginFeeBasisPoints()).eq(100);
    expect(await timelock.maxMarginFeeBasisPoints()).eq(1000);

    await timelock.setContractHandler(user0.address, true);
    await timelock.connect(user0).setMarginFeeBasisPoints(20, 200);
    expect(await timelock.marginFeeBasisPoints()).eq(20);
    expect(await timelock.maxMarginFeeBasisPoints()).eq(200);
  });

  it("setFees", async () => {
    await expect(
      timelock.connect(user0).setFees(
        vault.address,
        1, // _taxBasisPoints,
        2, // _stableTaxBasisPoints,
        3, // _mintBurnFeeBasisPoints,
        4, // _swapFeeBasisPoints,
        5, // _stableSwapFeeBasisPoints,
        6, // _marginFeeBasisPoints,
        7, // _liquidationFeeUsd,
        8, // _minProfitTime,
        false,
      ),
    ).to.be.revertedWith("Timelock: forbidden");

    expect(await vault.taxBasisPoints()).eq(10);
    expect(await vault.stableTaxBasisPoints()).eq(5);
    expect(await vault.mintBurnFeeBasisPoints()).eq(25);
    expect(await vault.swapFeeBasisPoints()).eq(20);
    expect(await vault.stableSwapFeeBasisPoints()).eq(1);
    expect(await timelock.marginFeeBasisPoints()).eq(10);
    expect(await vault.marginFeeBasisPoints()).eq(10);
    expect(await vault.liquidationFeeUsd()).eq(toUsd(5));
    expect(await vault.minProfitTime()).eq(10800);
    expect(await vault.hasDynamicFees()).eq(true);

    await timelock.connect(deployer).setFees(
      vault.address,
      1, // _taxBasisPoints,
      2, // _stableTaxBasisPoints,
      3, // _mintBurnFeeBasisPoints,
      4, // _swapFeeBasisPoints,
      5, // _stableSwapFeeBasisPoints,
      6, // _marginFeeBasisPoints,
      7, // _liquidationFeeUsd,
      8, // _minProfitTime,
      false, // _hasDynamicFees
    );

    expect(await vault.taxBasisPoints()).eq(1);
    expect(await vault.stableTaxBasisPoints()).eq(2);
    expect(await vault.mintBurnFeeBasisPoints()).eq(3);
    expect(await vault.swapFeeBasisPoints()).eq(4);
    expect(await vault.stableSwapFeeBasisPoints()).eq(5);
    expect(await timelock.marginFeeBasisPoints()).eq(6);
    expect(await vault.marginFeeBasisPoints()).eq(500);
    expect(await vault.liquidationFeeUsd()).eq(7);
    expect(await vault.minProfitTime()).eq(8);
    expect(await vault.hasDynamicFees()).eq(false);

    await timelock.setContractHandler(user0.address, true);

    await timelock.connect(deployer).setFees(
      vault.address,
      11, // _taxBasisPoints,
      12, // _stableTaxBasisPoints,
      13, // _mintBurnFeeBasisPoints,
      14, // _swapFeeBasisPoints,
      15, // _stableSwapFeeBasisPoints,
      16, // _marginFeeBasisPoints,
      17, // _liquidationFeeUsd,
      18, // _minProfitTime,
      true, // _hasDynamicFees
    );

    expect(await vault.taxBasisPoints()).eq(11);
    expect(await vault.stableTaxBasisPoints()).eq(12);
    expect(await vault.mintBurnFeeBasisPoints()).eq(13);
    expect(await vault.swapFeeBasisPoints()).eq(14);
    expect(await vault.stableSwapFeeBasisPoints()).eq(15);
    expect(await timelock.marginFeeBasisPoints()).eq(16);
    expect(await vault.marginFeeBasisPoints()).eq(500);
    expect(await vault.liquidationFeeUsd()).eq(17);
    expect(await vault.minProfitTime()).eq(18);
    expect(await vault.hasDynamicFees()).eq(true);
  });

  it("setSwapFees", async () => {
    await expect(
      timelock.connect(user0).setSwapFees(
        vault.address,
        1, // _taxBasisPoints,
        2, // _stableTaxBasisPoints,
        3, // _mintBurnFeeBasisPoints,
        4, // _swapFeeBasisPoints,
        5, // _stableSwapFeeBasisPoints
      ),
    ).to.be.revertedWith("Timelock: forbidden");

    expect(await vault.taxBasisPoints()).eq(10);
    expect(await vault.stableTaxBasisPoints()).eq(5);
    expect(await vault.mintBurnFeeBasisPoints()).eq(25);
    expect(await vault.swapFeeBasisPoints()).eq(20);
    expect(await vault.stableSwapFeeBasisPoints()).eq(1);
    expect(await timelock.marginFeeBasisPoints()).eq(10);
    expect(await vault.marginFeeBasisPoints()).eq(10);
    expect(await vault.liquidationFeeUsd()).eq(toUsd(5));
    expect(await vault.minProfitTime()).eq(10800);
    expect(await vault.hasDynamicFees()).eq(true);

    await timelock.connect(deployer).setSwapFees(
      vault.address,
      1, // _taxBasisPoints,
      2, // _stableTaxBasisPoints,
      3, // _mintBurnFeeBasisPoints,
      4, // _swapFeeBasisPoints,
      5, // _stableSwapFeeBasisPoints
    );

    expect(await vault.taxBasisPoints()).eq(1);
    expect(await vault.stableTaxBasisPoints()).eq(2);
    expect(await vault.mintBurnFeeBasisPoints()).eq(3);
    expect(await vault.swapFeeBasisPoints()).eq(4);
    expect(await vault.stableSwapFeeBasisPoints()).eq(5);
    expect(await timelock.marginFeeBasisPoints()).eq(10);
    expect(await vault.marginFeeBasisPoints()).eq(500);
    expect(await vault.liquidationFeeUsd()).eq(toUsd(5));
    expect(await vault.minProfitTime()).eq(10800);
    expect(await vault.hasDynamicFees()).eq(true);

    await timelock.setContractHandler(user0.address, true);

    await timelock.connect(deployer).setSwapFees(
      vault.address,
      11, // _taxBasisPoints,
      12, // _stableTaxBasisPoints,
      13, // _mintBurnFeeBasisPoints,
      14, // _swapFeeBasisPoints,
      15, // _stableSwapFeeBasisPoints
    );

    expect(await vault.taxBasisPoints()).eq(11);
    expect(await vault.stableTaxBasisPoints()).eq(12);
    expect(await vault.mintBurnFeeBasisPoints()).eq(13);
    expect(await vault.swapFeeBasisPoints()).eq(14);
    expect(await vault.stableSwapFeeBasisPoints()).eq(15);
    expect(await timelock.marginFeeBasisPoints()).eq(10);
    expect(await vault.marginFeeBasisPoints()).eq(500);
    expect(await vault.liquidationFeeUsd()).eq(toUsd(5));
    expect(await vault.minProfitTime()).eq(10800);
    expect(await vault.hasDynamicFees()).eq(true);
  });

  it("toggle leverage", async () => {
    await expect(timelock.connect(user0).enableLeverage(vault.address)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    await timelock.setMarginFeeBasisPoints(10, 100);
    await expect(timelock.setShouldToggleIsLeverageEnabled(true));
    const initialTaxBasisPoints = await vault.taxBasisPoints();

    expect(await vault.isLeverageEnabled()).to.be.true;

    await timelock.disableLeverage(vault.address);
    expect(await vault.taxBasisPoints()).to.be.equal(initialTaxBasisPoints);
    expect(await vault.marginFeeBasisPoints()).eq(100);
    expect(await vault.isLeverageEnabled()).to.be.false;

    await timelock.enableLeverage(vault.address);
    expect(await vault.taxBasisPoints()).to.be.equal(initialTaxBasisPoints);
    expect(await vault.marginFeeBasisPoints()).eq(10);
    expect(await vault.isLeverageEnabled()).to.be.true;

    await expect(timelock.setShouldToggleIsLeverageEnabled(false));
    await timelock.disableLeverage(vault.address);
    expect(await vault.taxBasisPoints()).to.be.equal(initialTaxBasisPoints);
    expect(await vault.marginFeeBasisPoints()).eq(100);
    expect(await vault.isLeverageEnabled()).to.be.true;

    await expect(timelock.setShouldToggleIsLeverageEnabled(true));
    await timelock.disableLeverage(vault.address);
    await expect(timelock.setShouldToggleIsLeverageEnabled(false));
    await timelock.enableLeverage(vault.address);
    expect(await vault.taxBasisPoints()).to.be.equal(initialTaxBasisPoints);
    expect(await vault.marginFeeBasisPoints()).eq(10);
    expect(await vault.isLeverageEnabled()).to.be.false;
  });

  it("setInPrivateLiquidationMode", async () => {
    await expect(timelock.connect(user0).setInPrivateLiquidationMode(vault.address, true)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    expect(await vault.inPrivateLiquidationMode()).eq(false);
    await timelock.connect(deployer).setInPrivateLiquidationMode(vault.address, true);
    expect(await vault.inPrivateLiquidationMode()).eq(true);

    await timelock.connect(deployer).setInPrivateLiquidationMode(vault.address, false);
    expect(await vault.inPrivateLiquidationMode()).eq(false);
  });

  it("setLiquidator", async () => {
    await expect(
      timelock.connect(user0).setLiquidator(vault.address, user1.address, true),
    ).to.be.revertedWith("Timelock: forbidden");

    expect(await vault.isLiquidator(user1.address)).eq(false);
    await timelock.connect(deployer).setLiquidator(vault.address, user1.address, true);
    expect(await vault.isLiquidator(user1.address)).eq(true);

    await timelock.connect(deployer).setLiquidator(vault.address, user1.address, false);
    expect(await vault.isLiquidator(user1.address)).eq(false);

    await expect(
      vault.connect(user1).liquidatePosition(user0.address, avax.address, avax.address, true, user2.address),
    ).to.be.revertedWith("Vault: empty position");

    await timelock.connect(deployer).setInPrivateLiquidationMode(vault.address, true);

    await expect(
      vault.connect(user1).liquidatePosition(user0.address, avax.address, avax.address, true, user2.address),
    ).to.be.revertedWith("Vault: invalid liquidator");

    await timelock.connect(deployer).setLiquidator(vault.address, user1.address, true);

    await expect(
      vault.connect(user1).liquidatePosition(user0.address, avax.address, avax.address, true, user2.address),
    ).to.be.revertedWith("Vault: empty position");
  });

  it("redeemUsdg", async () => {
    await timelock.setContractHandler(user0.address, true);

    await expect(
      timelock.connect(user0).redeemUsdg(vault.address, avax.address, toWei(1000, 18)),
    ).to.be.revertedWith("Timelock: forbidden");

    await expect(
      timelock.connect(deployer).redeemUsdg(vault.address, avax.address, toWei(1000, 18)),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      timelock.connect(user0).signalRedeemUsdg(vault.address, avax.address, toWei(1000, 18)),
    ).to.be.revertedWith("Timelock: forbidden");

    await timelock.connect(deployer).signalRedeemUsdg(vault.address, avax.address, toWei(1000, 18));

    await expect(
      timelock.connect(deployer).redeemUsdg(vault.address, avax.address, toWei(1000, 18)),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(5 * 24 * 60 * 60);

    await expect(
      timelock.connect(deployer).redeemUsdg(vault.address, avax.address, toWei(1000, 18)),
    ).to.be.revertedWith("YieldToken: forbidden");

    await usdg.setGov(timelock.address);

    await expect(
      timelock.connect(deployer).redeemUsdg(vault.address, avax.address, toWei(1000, 18)),
    ).to.be.revertedWith("Vault: _token not whitelisted");

    await timelock.connect(deployer).signalSetPriceFeed(vault.address, vaultPriceFeed.address);
    await advanceTimeAndBlock(5 * 24 * 60 * 60 + 10);
    await timelock.connect(deployer).setPriceFeed(vault.address, vaultPriceFeed.address);

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(500));

    await timelock.connect(deployer).signalVaultSetTokenConfig(
      vault.address,
      avax.address, // _token
      18, // _tokenDecimals
      7000, // _tokenWeight
      300, // _minProfitBps
      toWei(5000, 18), // _maxUsdgAmount
      false, // _isStable
      true, // isShortable
    );

    await advanceTimeAndBlock(5 * 24 * 60 * 60);

    await timelock.connect(deployer).vaultSetTokenConfig(
      vault.address,
      avax.address, // _token
      18, // _tokenDecimals
      7000, // _tokenWeight
      300, // _minProfitBps
      toWei(5000, 18), // _maxUsdgAmount
      false, // _isStable
      true, // isShortable
    );

    await avax.mint(deployer.address, toWei(3, 18));
    await avax.approve(router.address, toWei(3, 18));
    await router.swap([avax.address, usdg.address], toWei(3, 18), 0, user3.address);

    await timelock.signalSetGov(vault.address, user1.address);

    await advanceTimeAndBlock(5 * 24 * 60 * 60);

    await timelock.setGov(vault.address, user1.address);
    await vault.connect(user1).setInManagerMode(true);
    await vault.connect(user1).setGov(timelock.address);

    expect(await avax.balanceOf(tokenManager.address)).eq(0);
    await timelock.connect(deployer).redeemUsdg(vault.address, avax.address, toWei(1000, 18));
    expect(await avax.balanceOf(tokenManager.address)).eq("1993000000000000000"); // 1.993
  });

  it("setShortsTrackerAveragePriceWeight", async () => {
    await xlxManager.setGov(timelock.address);
    expect(await xlxManager.gov()).eq(timelock.address);

    await expect(timelock.connect(user0).setShortsTrackerAveragePriceWeight(1234)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    expect(await xlxManager.shortsTrackerAveragePriceWeight()).eq(0);
    await timelock.setShortsTrackerAveragePriceWeight(1234);
    expect(await xlxManager.shortsTrackerAveragePriceWeight()).eq(1234);
  });

  it("setXlxCooldownDuration", async () => {
    await xlxManager.setGov(timelock.address);
    expect(await xlxManager.gov()).eq(timelock.address);

    await expect(timelock.connect(user0).setXlxCooldownDuration(3600)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    await expect(timelock.connect(deployer).setXlxCooldownDuration(3 * 60 * 60)).to.be.revertedWith(
      "Timelock: invalid _cooldownDuration",
    );

    expect(await xlxManager.cooldownDuration()).eq(900);
    await timelock.setXlxCooldownDuration(3600);
    expect(await xlxManager.cooldownDuration()).eq(3600);
  });
});
