import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  VaultPriceFeed__factory,
  Token,
  Vault__factory,
  PriceFeed,
  VaultPriceFeed,
  Vault,
  VaultUtils,
  USDG,
  Router,
  VaultUtils__factory,
  USDG__factory,
  Router__factory,
  XdxTimelock__factory,
  XdxTimelock,
  XDX__factory,
  RewardDistributor__factory,
  TokenManager,
  TokenManager__factory,
} from "../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { advanceTimeAndBlock, Ship, toChainlinkPrice, toUsd, toWei } from "../../utils";
import { utils } from "ethers";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let avax: Token;
let avaxPriceFeed: PriceFeed;
let btc: Token;
let btcPriceFeed: PriceFeed;
let usdc: Token;
let usdcPriceFeed: PriceFeed;

let vault: Vault;
let vaultUtils: VaultUtils;
let vaultPriceFeed: VaultPriceFeed;
let xdxTimelock: XdxTimelock;
let usdg: USDG;
let router: Router;
let tokenManager: TokenManager;

let deployer: SignerWithAddress;
let user0: SignerWithAddress;
let user1: SignerWithAddress;
let user2: SignerWithAddress;
let user3: SignerWithAddress;
let rewardManager: SignerWithAddress;
let mintReceiver: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture([
    "tokens",
    "vault",
    "vaultUtils",
    "vaultPriceFeed",
    "usdg",
    "router",
    "xdx",
    "rewardDistributor",
  ]);

  return {
    ship,
    accounts,
    users,
  };
});

describe("XdxTimelock", function () {
  beforeEach(async function () {
    const { accounts, users } = await setup();

    deployer = accounts.deployer;
    user0 = users[0];
    user1 = users[1];
    user2 = users[2];
    user3 = users[3];
    rewardManager = users[4];
    mintReceiver = users[5];

    avax = (await ship.connect("avax")) as Token;
    avaxPriceFeed = (await ship.connect("avaxPriceFeed")) as PriceFeed;
    btc = (await ship.connect("btc")) as Token;
    btcPriceFeed = (await ship.connect("btcPriceFeed")) as PriceFeed;
    usdc = (await ship.connect("usdc")) as Token;
    usdcPriceFeed = (await ship.connect("usdcPriceFeed")) as PriceFeed;

    vault = await ship.connect(Vault__factory);
    vaultUtils = await ship.connect(VaultUtils__factory);
    vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
    usdg = await ship.connect(USDG__factory);
    router = await ship.connect(Router__factory);
    tokenManager = await ship.connect(TokenManager__factory);

    xdxTimelock = (
      await ship.deploy(XdxTimelock__factory, {
        args: [
          deployer.address,
          5 * 24 * 60 * 60,
          7 * 24 * 60 * 60,
          rewardManager.address,
          deployer.address,
          mintReceiver.address,
          toWei(1000, 18),
        ],
      })
    ).contract;

    await vault.setFundingRate(60 * 60, 600, 600);
    await vaultPriceFeed.setMaxStrictPriceDeviation(0);
    await vault.clearTokenConfig(avax.address);
    await vault.setInManagerMode(false);

    await vault.setGov(xdxTimelock.address);
    await vaultPriceFeed.setGov(xdxTimelock.address);
    await router.setGov(xdxTimelock.address);
  });

  it("inits", async () => {
    expect(await usdg.gov()).eq(deployer.address);
    expect(await usdg.vaults(vault.address)).eq(true);
    expect(await usdg.vaults(user0.address)).eq(false);

    expect(await vault.gov()).eq(xdxTimelock.address);
    expect(await vault.isInitialized()).eq(true);
    expect(await vault.router()).eq(router.address);
    expect(await vault.usdg()).eq(usdg.address);
    expect(await vault.liquidationFeeUsd()).eq(toUsd(5));
    expect(await vault.fundingRateFactor()).eq(600);

    expect(await xdxTimelock.admin()).eq(deployer.address);
    expect(await xdxTimelock.buffer()).eq(5 * 24 * 60 * 60);
    expect(await xdxTimelock.tokenManager()).eq(deployer.address);
    expect(await xdxTimelock.maxTokenSupply()).eq(toWei(1000, 18));

    await expect(
      ship.deploy(XdxTimelock__factory, {
        aliasName: "SecondXdxTimelock",
        args: [
          deployer.address,
          7 * 24 * 60 * 60 + 1,
          7 * 24 + 60 * 60,
          rewardManager.address,
          tokenManager.address,
          mintReceiver.address,
          1000,
        ],
      }),
    ).to.be.revertedWith("XdxTimelock: invalid _buffer");

    await expect(
      ship.deploy(XdxTimelock__factory, {
        aliasName: "SecondXdxTimelock",
        args: [
          deployer.address,
          7 * 24 * 60 * 60,
          7 * 24 * 60 * 60 + 1,
          rewardManager.address,
          tokenManager.address,
          mintReceiver.address,
          1000,
        ],
      }),
    ).to.be.revertedWith("XdxTimelock: invalid _longBuffer");
  });

  it("setTokenConfig", async () => {
    await xdxTimelock.connect(deployer).signalSetPriceFeed(vault.address, vaultPriceFeed.address);
    await advanceTimeAndBlock(5 * 24 * 60 * 60 + 10);
    await xdxTimelock.connect(deployer).setPriceFeed(vault.address, vaultPriceFeed.address);

    await avaxPriceFeed.setLatestAnswer(500);

    await expect(
      xdxTimelock.connect(user0).setTokenConfig(vault.address, avax.address, 100, 200, 1000, 0, 0),
    ).to.be.revertedWith("XdxTimelock: forbidden");

    await expect(
      xdxTimelock.connect(deployer).setTokenConfig(vault.address, avax.address, 100, 200, 1000, 0, 0),
    ).to.be.revertedWith("XdxTimelock: token not yet whitelisted");

    await xdxTimelock.connect(deployer).signalVaultSetTokenConfig(
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

    await xdxTimelock.connect(deployer).vaultSetTokenConfig(
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

    await xdxTimelock.connect(deployer).setTokenConfig(
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
  });

  it("setBuffer", async () => {
    const xdxTimelock0 = await ship.deploy(XdxTimelock__factory, {
      aliasName: "SecondXdxTimelock",
      args: [
        user1.address,
        3 * 24 * 60 * 60,
        7 * 24 * 60 * 60,
        rewardManager.address,
        tokenManager.address,
        mintReceiver.address,
        1000,
      ],
    });
    await expect(xdxTimelock0.contract.connect(user0).setBuffer(3 * 24 * 60 * 60 - 10)).to.be.revertedWith(
      "XdxTimelock: forbidden",
    );

    await expect(xdxTimelock0.contract.connect(user1).setBuffer(7 * 24 * 60 * 60 + 10)).to.be.revertedWith(
      "XdxTimelock: invalid _buffer",
    );

    await expect(xdxTimelock0.contract.connect(user1).setBuffer(3 * 24 * 60 * 60 - 10)).to.be.revertedWith(
      "XdxTimelock: buffer cannot be decreased",
    );

    expect(await xdxTimelock0.contract.buffer()).eq(3 * 24 * 60 * 60);
    await xdxTimelock0.contract.connect(user1).setBuffer(3 * 24 * 60 * 60 + 10);
    expect(await xdxTimelock0.contract.buffer()).eq(3 * 24 * 60 * 60 + 10);
  });

  it("setIsAmmEnabled", async () => {
    await expect(xdxTimelock.connect(user0).setIsAmmEnabled(vaultPriceFeed.address, true)).to.be.revertedWith(
      "XdxTimelock: forbidden",
    );

    expect(await vaultPriceFeed.isAmmEnabled()).eq(false);
    await xdxTimelock.connect(deployer).setIsAmmEnabled(vaultPriceFeed.address, true);
    expect(await vaultPriceFeed.isAmmEnabled()).eq(true);
  });

  it("setMaxStrictPriceDeviation", async () => {
    await expect(
      xdxTimelock.connect(user0).setMaxStrictPriceDeviation(vaultPriceFeed.address, 100),
    ).to.be.revertedWith("XdxTimelock: forbidden");

    expect(await vaultPriceFeed.maxStrictPriceDeviation()).eq(0);
    await xdxTimelock.connect(deployer).setMaxStrictPriceDeviation(vaultPriceFeed.address, 100);
    expect(await vaultPriceFeed.maxStrictPriceDeviation()).eq(100);
  });

  it("setPriceSampleSpace", async () => {
    await expect(
      xdxTimelock.connect(user0).setPriceSampleSpace(vaultPriceFeed.address, 0),
    ).to.be.revertedWith("XdxTimelock: forbidden");

    expect(await vaultPriceFeed.priceSampleSpace()).eq(3);
    await xdxTimelock.connect(deployer).setPriceSampleSpace(vaultPriceFeed.address, 1);
    expect(await vaultPriceFeed.priceSampleSpace()).eq(1);
  });

  it("setVaultUtils", async () => {
    await expect(xdxTimelock.connect(user0).setVaultUtils(vault.address, user1.address)).to.be.revertedWith(
      "XdxTimelock: forbidden",
    );

    expect(await vault.vaultUtils()).eq(vaultUtils.address);
    await xdxTimelock.connect(deployer).setVaultUtils(vault.address, user1.address);
    expect(await vault.vaultUtils()).eq(user1.address);
  });

  it("setIsSwapEnabled", async () => {
    await expect(xdxTimelock.connect(user0).setIsSwapEnabled(vault.address, false)).to.be.revertedWith(
      "XdxTimelock: forbidden",
    );

    expect(await vault.isSwapEnabled()).eq(true);
    await xdxTimelock.connect(deployer).setIsSwapEnabled(vault.address, false);
    expect(await vault.isSwapEnabled()).eq(false);
  });

  it("setContractHandler", async () => {
    await expect(xdxTimelock.connect(user0).setContractHandler(user1.address, true)).to.be.revertedWith(
      "XdxTimelock: forbidden",
    );

    expect(await xdxTimelock.isHandler(user1.address)).eq(false);
    await xdxTimelock.connect(deployer).setContractHandler(user1.address, true);
    expect(await xdxTimelock.isHandler(user1.address)).eq(true);
  });

  it("setIsLeverageEnabled", async () => {
    await expect(xdxTimelock.connect(user0).setIsLeverageEnabled(vault.address, false)).to.be.revertedWith(
      "XdxTimelock: forbidden",
    );

    expect(await vault.isLeverageEnabled()).eq(true);
    await xdxTimelock.connect(deployer).setIsLeverageEnabled(vault.address, false);
    expect(await vault.isLeverageEnabled()).eq(false);

    await expect(xdxTimelock.connect(user1).setIsLeverageEnabled(vault.address, false)).to.be.revertedWith(
      "XdxTimelock: forbidden",
    );

    await xdxTimelock.connect(deployer).setContractHandler(user1.address, true);

    expect(await vault.isLeverageEnabled()).eq(false);
    await xdxTimelock.connect(user1).setIsLeverageEnabled(vault.address, true);
    expect(await vault.isLeverageEnabled()).eq(true);

    await expect(xdxTimelock.connect(user1).addExcludedToken(user2.address)).to.be.revertedWith(
      "XdxTimelock: forbidden",
    );
  });

  it("setMaxGlobalShortSize", async () => {
    await expect(
      xdxTimelock.connect(user0).setMaxGlobalShortSize(vault.address, avax.address, 100),
    ).to.be.revertedWith("XdxTimelock: forbidden");

    expect(await vault.maxGlobalShortSizes(avax.address)).eq(0);
    await xdxTimelock.connect(deployer).setMaxGlobalShortSize(vault.address, avax.address, 100);
    expect(await vault.maxGlobalShortSizes(avax.address)).eq(100);
  });

  it("setMaxGasPrice", async () => {
    await expect(xdxTimelock.connect(user0).setMaxGasPrice(vault.address, 7000000000)).to.be.revertedWith(
      "XdxTimelock: forbidden",
    );

    expect(await vault.maxGasPrice()).eq(0);
    await xdxTimelock.connect(deployer).setMaxGasPrice(vault.address, 7000000000);
    expect(await vault.maxGasPrice()).eq(7000000000);
  });

  it("setMaxLeverage", async () => {
    await expect(xdxTimelock.connect(user0).setMaxLeverage(vault.address, 100 * 10000)).to.be.revertedWith(
      "XdxTimelock: forbidden",
    );

    await expect(xdxTimelock.connect(deployer).setMaxLeverage(vault.address, 49 * 10000)).to.be.revertedWith(
      "XdxTimelock: invalid _maxLeverage",
    );

    expect(await vault.maxLeverage()).eq(50 * 10000);
    await xdxTimelock.connect(deployer).setMaxLeverage(vault.address, 100 * 10000);
    expect(await vault.maxLeverage()).eq(100 * 10000);
  });

  it("setFundingRate", async () => {
    await expect(
      xdxTimelock.connect(user0).setFundingRate(vault.address, 59 * 60, 100, 100),
    ).to.be.revertedWith("XdxTimelock: forbidden");

    await expect(
      xdxTimelock.connect(deployer).setFundingRate(vault.address, 59 * 60, 100, 100),
    ).to.be.revertedWith("Vault: invalid _fundingInterval");

    expect(await vault.fundingRateFactor()).eq(600);
    expect(await vault.stableFundingRateFactor()).eq(600);
    await xdxTimelock.connect(deployer).setFundingRate(vault.address, 60 * 60, 0, 100);
    expect(await vault.fundingRateFactor()).eq(0);
    expect(await vault.stableFundingRateFactor()).eq(100);

    await xdxTimelock.connect(deployer).setFundingRate(vault.address, 60 * 60, 100, 0);
    expect(await vault.fundingRateFactor()).eq(100);
    expect(await vault.stableFundingRateFactor()).eq(0);
  });

  it("transferIn", async () => {
    await avax.mint(user1.address, 1000);
    await expect(xdxTimelock.connect(user0).transferIn(user1.address, avax.address, 1000)).to.be.revertedWith(
      "XdxTimelock: forbidden",
    );

    await expect(
      xdxTimelock.connect(deployer).transferIn(user1.address, avax.address, 1000),
    ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");

    await avax.connect(user1).approve(xdxTimelock.address, 1000);

    expect(await avax.balanceOf(user1.address)).eq(1000);
    expect(await avax.balanceOf(xdxTimelock.address)).eq(0);
    await xdxTimelock.connect(deployer).transferIn(user1.address, avax.address, 1000);
    expect(await avax.balanceOf(user1.address)).eq(0);
    expect(await avax.balanceOf(xdxTimelock.address)).eq(1000);
  });

  it("approve", async () => {
    await expect(
      xdxTimelock.connect(user0).approve(usdc.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("XdxTimelock: forbidden");

    await expect(
      xdxTimelock.connect(deployer).approve(usdc.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    await expect(
      xdxTimelock.connect(user0).signalApprove(usdc.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("XdxTimelock: forbidden");

    await xdxTimelock.connect(deployer).signalApprove(usdc.address, user1.address, toWei(100, 18));

    await expect(
      xdxTimelock.connect(deployer).approve(usdc.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("XdxTimelock: action time not yet passed");

    await advanceTimeAndBlock(4 * 24 * 60 * 60);

    await expect(
      xdxTimelock.connect(deployer).approve(usdc.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("XdxTimelock: action time not yet passed");

    await advanceTimeAndBlock(1 * 24 * 60 * 60 + 10);

    await expect(
      xdxTimelock.connect(deployer).approve(avax.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    await expect(
      xdxTimelock.connect(deployer).approve(usdc.address, user2.address, toWei(100, 18)),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    await expect(
      xdxTimelock.connect(deployer).approve(usdc.address, user1.address, toWei(101, 18)),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    await usdc.mint(xdxTimelock.address, toWei(150, 18));

    expect(await usdc.balanceOf(xdxTimelock.address)).eq(toWei(150, 18));
    expect(await usdc.balanceOf(user1.address)).eq(0);

    await expect(
      usdc.connect(user1).transferFrom(xdxTimelock.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");

    await xdxTimelock.connect(deployer).approve(usdc.address, user1.address, toWei(100, 18));
    await expect(
      usdc.connect(user2).transferFrom(xdxTimelock.address, user2.address, toWei(100, 18)),
    ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
    await usdc.connect(user1).transferFrom(xdxTimelock.address, user1.address, toWei(100, 18));

    expect(await usdc.balanceOf(xdxTimelock.address)).eq(toWei(50, 18));
    expect(await usdc.balanceOf(user1.address)).eq(toWei(100, 18));

    await expect(
      usdc.connect(user1).transferFrom(xdxTimelock.address, user1.address, toWei(1, 18)),
    ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");

    await expect(
      xdxTimelock.connect(deployer).approve(usdc.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    await xdxTimelock.connect(deployer).signalApprove(usdc.address, user1.address, toWei(100, 18));

    await expect(
      xdxTimelock.connect(deployer).approve(usdc.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("XdxTimelock: action time not yet passed");

    const action0 = utils.solidityKeccak256(
      ["string", "address", "address", "uint256"],
      ["approve", avax.address, user1.address, toWei(100, 18)],
    );
    const action1 = utils.solidityKeccak256(
      ["string", "address", "address", "uint256"],
      ["approve", usdc.address, user1.address, toWei(100, 18)],
    );

    await expect(xdxTimelock.connect(user0).cancelAction(action0)).to.be.revertedWith(
      "XdxTimelock: forbidden",
    );

    await expect(xdxTimelock.connect(deployer).cancelAction(action0)).to.be.revertedWith(
      "XdxTimelock: invalid _action",
    );

    await xdxTimelock.connect(deployer).cancelAction(action1);

    await expect(
      xdxTimelock.connect(deployer).approve(usdc.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("XdxTimelock: action not signalled");
  });

  it("processMint", async () => {
    const xdx = await ship.connect(XDX__factory);
    await xdx.setGov(xdxTimelock.address);

    await expect(
      xdxTimelock.connect(user0).processMint(xdx.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("XdxTimelock: forbidden");

    await expect(
      xdxTimelock.connect(deployer).processMint(xdx.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    await expect(
      xdxTimelock.connect(user0).signalMint(xdx.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("XdxTimelock: forbidden");

    await xdxTimelock.connect(deployer).signalMint(xdx.address, user1.address, toWei(100, 18));

    await expect(
      xdxTimelock.connect(deployer).processMint(xdx.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("XdxTimelock: action time not yet passed");

    await advanceTimeAndBlock(4 * 24 * 60 * 60);

    await expect(
      xdxTimelock.connect(deployer).processMint(xdx.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("XdxTimelock: action time not yet passed");

    await advanceTimeAndBlock(1 * 24 * 60 * 60 + 10);

    await expect(
      xdxTimelock.connect(deployer).processMint(avax.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    await expect(
      xdxTimelock.connect(deployer).processMint(xdx.address, user2.address, toWei(100, 18)),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    await expect(
      xdxTimelock.connect(deployer).processMint(xdx.address, user1.address, toWei(101, 18)),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    expect(await xdx.balanceOf(xdxTimelock.address)).eq(0);
    expect(await xdx.balanceOf(user1.address)).eq(0);

    await xdxTimelock.connect(deployer).processMint(xdx.address, user1.address, toWei(100, 18));

    expect(await xdx.balanceOf(xdxTimelock.address)).eq(0);
    expect(await xdx.balanceOf(user1.address)).eq(toWei(100, 18));

    await expect(
      xdxTimelock.connect(deployer).processMint(xdx.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    await xdxTimelock.connect(deployer).signalMint(xdx.address, user1.address, toWei(100, 18));

    await expect(
      xdxTimelock.connect(deployer).processMint(xdx.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("XdxTimelock: action time not yet passed");

    const action0 = utils.solidityKeccak256(
      ["string", "address", "address", "uint256"],
      ["mint", avax.address, user1.address, toWei(100, 18)],
    );
    const action1 = utils.solidityKeccak256(
      ["string", "address", "address", "uint256"],
      ["mint", xdx.address, user1.address, toWei(100, 18)],
    );

    await expect(xdxTimelock.connect(user0).cancelAction(action0)).to.be.revertedWith(
      "XdxTimelock: forbidden",
    );

    await expect(xdxTimelock.connect(deployer).cancelAction(action0)).to.be.revertedWith(
      "XdxTimelock: invalid _action",
    );

    await xdxTimelock.connect(deployer).cancelAction(action1);

    await expect(
      xdxTimelock.connect(deployer).processMint(xdx.address, user1.address, toWei(100, 18)),
    ).to.be.revertedWith("XdxTimelock: action not signalled");
  });

  it("setGov", async () => {
    await expect(xdxTimelock.connect(user0).setGov(vault.address, user1.address)).to.be.revertedWith(
      "XdxTimelock: forbidden",
    );

    await expect(xdxTimelock.connect(deployer).setGov(vault.address, user1.address)).to.be.revertedWith(
      "XdxTimelock: action not signalled",
    );

    await expect(xdxTimelock.connect(user0).signalSetGov(vault.address, user1.address)).to.be.revertedWith(
      "XdxTimelock: forbidden",
    );

    await expect(xdxTimelock.connect(user1).signalSetGov(vault.address, user1.address)).to.be.revertedWith(
      "XdxTimelock: forbidden",
    );

    await xdxTimelock.connect(deployer).signalSetGov(vault.address, user1.address);

    await expect(xdxTimelock.connect(deployer).setGov(vault.address, user1.address)).to.be.revertedWith(
      "XdxTimelock: action time not yet passed",
    );

    await advanceTimeAndBlock(4 * 24 * 60 * 60);

    await expect(xdxTimelock.connect(deployer).setGov(vault.address, user1.address)).to.be.revertedWith(
      "XdxTimelock: action time not yet passed",
    );

    await advanceTimeAndBlock(1 * 24 * 60 * 60 + 10);

    await expect(xdxTimelock.connect(deployer).setGov(user2.address, user1.address)).to.be.revertedWith(
      "XdxTimelock: action not signalled",
    );

    await expect(xdxTimelock.connect(deployer).setGov(vault.address, user2.address)).to.be.revertedWith(
      "XdxTimelock: action not signalled",
    );

    await expect(xdxTimelock.connect(deployer).setGov(vault.address, user1.address)).to.be.revertedWith(
      "XdxTimelock: action time not yet passed",
    );

    await advanceTimeAndBlock(2 * 24 * 60 * 60 + 10);

    expect(await vault.gov()).eq(xdxTimelock.address);
    await xdxTimelock.connect(deployer).setGov(vault.address, user1.address);
    expect(await vault.gov()).eq(user1.address);

    await xdxTimelock.connect(deployer).signalSetGov(vault.address, user2.address);

    await expect(xdxTimelock.connect(deployer).setGov(vault.address, user2.address)).to.be.revertedWith(
      "XdxTimelock: action time not yet passed",
    );

    const action0 = utils.solidityKeccak256(
      ["string", "address", "address"],
      ["setGov", user1.address, user2.address],
    );
    const action1 = utils.solidityKeccak256(
      ["string", "address", "address"],
      ["setGov", vault.address, user2.address],
    );

    await expect(xdxTimelock.connect(deployer).cancelAction(action0)).to.be.revertedWith(
      "XdxTimelock: invalid _action",
    );

    await xdxTimelock.connect(deployer).cancelAction(action1);

    await expect(xdxTimelock.connect(deployer).setGov(vault.address, user2.address)).to.be.revertedWith(
      "XdxTimelock: action not signalled",
    );
  });

  it("setPriceFeed", async () => {
    await expect(xdxTimelock.connect(user0).setPriceFeed(vault.address, user1.address)).to.be.revertedWith(
      "XdxTimelock: forbidden",
    );

    await expect(xdxTimelock.connect(deployer).setPriceFeed(vault.address, user1.address)).to.be.revertedWith(
      "XdxTimelock: action not signalled",
    );

    await expect(
      xdxTimelock.connect(user0).signalSetPriceFeed(vault.address, user1.address),
    ).to.be.revertedWith("XdxTimelock: forbidden");

    await xdxTimelock.connect(deployer).signalSetPriceFeed(vault.address, user1.address);

    await expect(xdxTimelock.connect(deployer).setPriceFeed(vault.address, user1.address)).to.be.revertedWith(
      "XdxTimelock: action time not yet passed",
    );

    await advanceTimeAndBlock(4 * 24 * 60 * 60);

    await expect(xdxTimelock.connect(deployer).setPriceFeed(vault.address, user1.address)).to.be.revertedWith(
      "XdxTimelock: action time not yet passed",
    );

    await advanceTimeAndBlock(1 * 24 * 60 * 60 + 10);

    await expect(xdxTimelock.connect(deployer).setPriceFeed(user2.address, user1.address)).to.be.revertedWith(
      "XdxTimelock: action not signalled",
    );

    await expect(xdxTimelock.connect(deployer).setPriceFeed(vault.address, user2.address)).to.be.revertedWith(
      "XdxTimelock: action not signalled",
    );

    expect(await vault.priceFeed()).eq(vaultPriceFeed.address);
    await xdxTimelock.connect(deployer).setPriceFeed(vault.address, user1.address);
    expect(await vault.priceFeed()).eq(user1.address);

    await xdxTimelock.connect(deployer).signalSetPriceFeed(vault.address, user2.address);

    await expect(xdxTimelock.connect(deployer).setPriceFeed(vault.address, user2.address)).to.be.revertedWith(
      "XdxTimelock: action time not yet passed",
    );

    const action0 = utils.solidityKeccak256(
      ["string", "address", "address"],
      ["setPriceFeed", user1.address, user2.address],
    );
    const action1 = utils.solidityKeccak256(
      ["string", "address", "address"],
      ["setPriceFeed", vault.address, user2.address],
    );

    await expect(xdxTimelock.connect(deployer).cancelAction(action0)).to.be.revertedWith(
      "XdxTimelock: invalid _action",
    );

    await xdxTimelock.connect(deployer).cancelAction(action1);

    await expect(xdxTimelock.connect(deployer).setPriceFeed(vault.address, user2.address)).to.be.revertedWith(
      "XdxTimelock: action not signalled",
    );
  });

  it("withdrawToken", async () => {
    const xdx = await ship.connect(XDX__factory);
    await xdx.setGov(xdxTimelock.address);

    await expect(
      xdxTimelock.connect(user0).withdrawToken(xdx.address, avax.address, user0.address, 100),
    ).to.be.revertedWith("XdxTimelock: forbidden");

    await expect(
      xdxTimelock.connect(deployer).withdrawToken(xdx.address, avax.address, user0.address, 100),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    await expect(
      xdxTimelock.connect(user0).signalWithdrawToken(xdx.address, avax.address, user0.address, 100),
    ).to.be.revertedWith("XdxTimelock: forbidden");

    await xdxTimelock.connect(deployer).signalWithdrawToken(xdx.address, avax.address, user0.address, 100);

    await expect(
      xdxTimelock.connect(deployer).withdrawToken(xdx.address, avax.address, user0.address, 100),
    ).to.be.revertedWith("XdxTimelock: action time not yet passed");

    await advanceTimeAndBlock(4 * 24 * 60 * 60);

    await expect(
      xdxTimelock.connect(deployer).withdrawToken(xdx.address, avax.address, user0.address, 100),
    ).to.be.revertedWith("XdxTimelock: action time not yet passed");

    await advanceTimeAndBlock(1 * 24 * 60 * 60 + 10);

    await expect(
      xdxTimelock.connect(deployer).withdrawToken(usdc.address, avax.address, user0.address, 100),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    await expect(
      xdxTimelock.connect(deployer).withdrawToken(xdx.address, usdc.address, user0.address, 100),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    await expect(
      xdxTimelock.connect(deployer).withdrawToken(xdx.address, avax.address, user1.address, 100),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    await expect(
      xdxTimelock.connect(deployer).withdrawToken(xdx.address, avax.address, user0.address, 101),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    await expect(
      xdxTimelock.connect(deployer).withdrawToken(xdx.address, avax.address, user0.address, 100),
    ).to.be.revertedWith("ERC20: transfer amount exceeds balance");

    await avax.mint(xdx.address, 100);
    expect(await avax.balanceOf(user0.address)).eq(0);
    await xdxTimelock.connect(deployer).withdrawToken(xdx.address, avax.address, user0.address, 100);
    expect(await avax.balanceOf(user0.address)).eq(100);
  });

  it("vaultSetTokenConfig", async () => {
    await xdxTimelock.connect(deployer).signalSetPriceFeed(vault.address, vaultPriceFeed.address);
    await advanceTimeAndBlock(5 * 24 * 60 * 60 + 10);
    await xdxTimelock.connect(deployer).setPriceFeed(vault.address, vaultPriceFeed.address);

    await usdcPriceFeed.setLatestAnswer(1);

    await expect(
      xdxTimelock.connect(user0).vaultSetTokenConfig(
        vault.address,
        usdc.address, // _token
        12, // _tokenDecimals
        7000, // _tokenWeight
        120, // _minProfitBps
        5000, // _maxUsdgAmount
        true, // _isStable
        false, // isShortable
      ),
    ).to.be.revertedWith("XdxTimelock: forbidden");

    await expect(
      xdxTimelock.connect(deployer).vaultSetTokenConfig(
        vault.address,
        usdc.address, // _token
        12, // _tokenDecimals
        7000, // _tokenWeight
        120, // _minProfitBps
        5000, // _maxUsdgAmount
        true, // _isStable
        false, // isShortable
      ),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    await expect(
      xdxTimelock.connect(user0).signalVaultSetTokenConfig(
        vault.address,
        usdc.address, // _token
        12, // _tokenDecimals
        7000, // _tokenWeight
        120, // _minProfitBps
        5000, // _maxUsdgAmount
        true, // _isStable
        false, // isShortable
      ),
    ).to.be.revertedWith("XdxTimelock: forbidden");

    await xdxTimelock.connect(deployer).signalVaultSetTokenConfig(
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
      xdxTimelock.connect(deployer).vaultSetTokenConfig(
        vault.address,
        usdc.address, // _token
        12, // _tokenDecimals
        7000, // _tokenWeight
        120, // _minProfitBps
        5000, // _maxUsdgAmount
        true, // _isStable
        false, // isShortable
      ),
    ).to.be.revertedWith("XdxTimelock: action time not yet passed");

    await advanceTimeAndBlock(4 * 24 * 60 * 60);

    await expect(
      xdxTimelock.connect(deployer).vaultSetTokenConfig(
        vault.address,
        usdc.address, // _token
        12, // _tokenDecimals
        7000, // _tokenWeight
        120, // _minProfitBps
        5000, // _maxUsdgAmount
        true, // _isStable
        false, // isShortable
      ),
    ).to.be.revertedWith("XdxTimelock: action time not yet passed");

    await advanceTimeAndBlock(1 * 24 * 60 * 60 + 10);

    await expect(
      xdxTimelock.connect(deployer).vaultSetTokenConfig(
        vault.address,
        usdc.address, // _token
        15, // _tokenDecimals
        7000, // _tokenWeight
        120, // _minProfitBps
        5000, // _maxUsdgAmount
        true, // _isStable
        false, // isShortable
      ),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    expect(await vault.totalTokenWeights()).eq(93000);
    expect(await vault.whitelistedTokens(usdc.address)).eq(true);
    expect(await vault.tokenDecimals(usdc.address)).eq(6);
    expect(await vault.tokenWeights(usdc.address)).eq(47000);
    expect(await vault.minProfitBasisPoints(usdc.address)).eq(75);
    expect(await vault.maxUsdgAmounts(usdc.address)).eq("50000000000000000000000000000000000000");
    expect(await vault.stableTokens(usdc.address)).eq(true);
    expect(await vault.shortableTokens(usdc.address)).eq(false);

    await xdxTimelock.connect(deployer).vaultSetTokenConfig(
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

  it("priceFeedSetTokenConfig", async () => {
    await xdxTimelock.connect(deployer).signalSetPriceFeed(vault.address, vaultPriceFeed.address);
    await advanceTimeAndBlock(5 * 24 * 60 * 60 + 10);
    await xdxTimelock.connect(deployer).setPriceFeed(vault.address, vaultPriceFeed.address);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(70000));

    await expect(
      xdxTimelock.connect(user0).priceFeedSetTokenConfig(
        vaultPriceFeed.address,
        btc.address, // _token
        btcPriceFeed.address, // _priceFeed
        8, // _priceDecimals
        true, // _isStrictStable
      ),
    ).to.be.revertedWith("XdxTimelock: forbidden");

    await expect(
      xdxTimelock.connect(deployer).priceFeedSetTokenConfig(
        vaultPriceFeed.address,
        btc.address, // _token
        btcPriceFeed.address, // _priceFeed
        8, // _priceDecimals
        true, // _isStrictStable
      ),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    await expect(
      xdxTimelock.connect(user0).signalPriceFeedSetTokenConfig(
        vaultPriceFeed.address,
        btc.address, // _token
        btcPriceFeed.address, // _priceFeed
        8, // _priceDecimals
        true, // _isStrictStable
      ),
    ).to.be.revertedWith("XdxTimelock: forbidden");

    await xdxTimelock.connect(deployer).signalPriceFeedSetTokenConfig(
      vaultPriceFeed.address,
      btc.address, // _token
      btcPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      true, // _isStrictStable
    );

    await expect(
      xdxTimelock.connect(deployer).priceFeedSetTokenConfig(
        vaultPriceFeed.address,
        btc.address, // _token
        btcPriceFeed.address, // _priceFeed
        8, // _priceDecimals
        true, // _isStrictStable
      ),
    ).to.be.revertedWith("XdxTimelock: action time not yet passed");

    await advanceTimeAndBlock(4 * 24 * 60 * 60);

    await expect(
      xdxTimelock.connect(deployer).priceFeedSetTokenConfig(
        vaultPriceFeed.address,
        btc.address, // _token
        btcPriceFeed.address, // _priceFeed
        8, // _priceDecimals
        true, // _isStrictStable
      ),
    ).to.be.revertedWith("XdxTimelock: action time not yet passed");

    await advanceTimeAndBlock(1 * 24 * 60 * 60 + 10);

    await expect(
      xdxTimelock.connect(deployer).priceFeedSetTokenConfig(
        user0.address,
        btc.address, // _token
        btcPriceFeed.address, // _priceFeed
        8, // _priceDecimals
        true, // _isStrictStable
      ),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    await expect(
      xdxTimelock.connect(deployer).priceFeedSetTokenConfig(
        vaultPriceFeed.address,
        avax.address, // _token
        btcPriceFeed.address, // _priceFeed
        8, // _priceDecimals
        true, // _isStrictStable
      ),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    await expect(
      xdxTimelock.connect(deployer).priceFeedSetTokenConfig(
        vaultPriceFeed.address,
        btc.address, // _token
        avaxPriceFeed.address, // _priceFeed
        8, // _priceDecimals
        true, // _isStrictStable
      ),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    await expect(
      xdxTimelock.connect(deployer).priceFeedSetTokenConfig(
        vaultPriceFeed.address,
        btc.address, // _token
        btcPriceFeed.address, // _priceFeed
        9, // _priceDecimals
        true, // _isStrictStable
      ),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    await expect(
      xdxTimelock.connect(deployer).priceFeedSetTokenConfig(
        vaultPriceFeed.address,
        btc.address, // _token
        btcPriceFeed.address, // _priceFeed
        8, // _priceDecimals
        false, // _isStrictStable
      ),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    expect(await vaultPriceFeed.priceFeeds(btc.address)).eq(btcPriceFeed.address);
    expect(await vaultPriceFeed.priceDecimals(btc.address)).eq(8);
    expect(await vaultPriceFeed.strictStableTokens(btc.address)).eq(false);

    await xdxTimelock.connect(deployer).priceFeedSetTokenConfig(
      vaultPriceFeed.address,
      btc.address, // _token
      btcPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      true, // _isStrictStable
    );

    expect(await vaultPriceFeed.priceFeeds(btc.address)).eq(btcPriceFeed.address);
    expect(await vaultPriceFeed.priceDecimals(btc.address)).eq(8);
    expect(await vaultPriceFeed.strictStableTokens(btc.address)).eq(true);
    expect(await vaultPriceFeed.getPrice(btc.address, true, false, false)).eq(toUsd(73500));
  });

  it("addPlugin", async () => {
    await expect(xdxTimelock.connect(user0).addPlugin(router.address, user1.address)).to.be.revertedWith(
      "XdxTimelock: forbidden",
    );

    await expect(xdxTimelock.connect(deployer).addPlugin(router.address, user1.address)).to.be.revertedWith(
      "XdxTimelock: action not signalled",
    );

    await expect(
      xdxTimelock.connect(user0).signalAddPlugin(router.address, user1.address),
    ).to.be.revertedWith("XdxTimelock: forbidden");

    await xdxTimelock.connect(deployer).signalAddPlugin(router.address, user1.address);

    await expect(xdxTimelock.connect(deployer).addPlugin(router.address, user1.address)).to.be.revertedWith(
      "XdxTimelock: action time not yet passed",
    );

    await advanceTimeAndBlock(4 * 24 * 60 * 60);

    await expect(xdxTimelock.connect(deployer).addPlugin(router.address, user1.address)).to.be.revertedWith(
      "XdxTimelock: action time not yet passed",
    );

    await advanceTimeAndBlock(1 * 24 * 60 * 60 + 10);

    await expect(xdxTimelock.connect(deployer).addPlugin(user2.address, user1.address)).to.be.revertedWith(
      "XdxTimelock: action not signalled",
    );

    await expect(xdxTimelock.connect(deployer).addPlugin(router.address, user2.address)).to.be.revertedWith(
      "XdxTimelock: action not signalled",
    );

    expect(await router.plugins(user1.address)).eq(false);
    await xdxTimelock.connect(deployer).addPlugin(router.address, user1.address);
    expect(await router.plugins(user1.address)).eq(true);

    await xdxTimelock.connect(deployer).signalAddPlugin(router.address, user2.address);

    await expect(xdxTimelock.connect(deployer).addPlugin(router.address, user2.address)).to.be.revertedWith(
      "XdxTimelock: action time not yet passed",
    );

    const action0 = utils.solidityKeccak256(
      ["string", "address", "address"],
      ["addPlugin", user1.address, user2.address],
    );
    const action1 = utils.solidityKeccak256(
      ["string", "address", "address"],
      ["addPlugin", router.address, user2.address],
    );

    await expect(xdxTimelock.connect(deployer).cancelAction(action0)).to.be.revertedWith(
      "XdxTimelock: invalid _action",
    );

    await xdxTimelock.connect(deployer).cancelAction(action1);

    await expect(xdxTimelock.connect(deployer).addPlugin(router.address, user2.address)).to.be.revertedWith(
      "XdxTimelock: action not signalled",
    );
  });

  it("addExcludedToken", async () => {
    const xdx = await ship.connect(XDX__factory);
    await expect(xdxTimelock.connect(user0).addExcludedToken(xdx.address)).to.be.revertedWith(
      "XdxTimelock: forbidden",
    );

    expect(await xdxTimelock.excludedTokens(xdx.address)).eq(false);
    await xdxTimelock.connect(deployer).addExcludedToken(xdx.address);
    expect(await xdxTimelock.excludedTokens(xdx.address)).eq(true);
  });

  it("setInPrivateTransferMode", async () => {
    const xdx = await ship.connect(XDX__factory);
    await xdx.setMinter(deployer.address, true);
    await xdx.mint(user0.address, 100);
    await expect(xdxTimelock.connect(user0).setInPrivateTransferMode(xdx.address, true)).to.be.revertedWith(
      "XdxTimelock: forbidden",
    );

    await expect(
      xdxTimelock.connect(deployer).setInPrivateTransferMode(xdx.address, true),
    ).to.be.revertedWith("BaseToken: forbidden");

    await xdx.setGov(xdxTimelock.address);

    expect(await xdx.inPrivateTransferMode()).eq(false);
    await xdxTimelock.connect(deployer).setInPrivateTransferMode(xdx.address, true);
    expect(await xdx.inPrivateTransferMode()).eq(true);

    await xdxTimelock.connect(deployer).setInPrivateTransferMode(xdx.address, false);
    expect(await xdx.inPrivateTransferMode()).eq(false);

    await xdxTimelock.connect(deployer).setInPrivateTransferMode(xdx.address, true);
    expect(await xdx.inPrivateTransferMode()).eq(true);

    await expect(xdx.connect(user0).transfer(user1.address, 100)).to.be.revertedWith(
      "BaseToken: msg.sender not whitelisted",
    );

    await xdxTimelock.addExcludedToken(xdx.address);
    await expect(
      xdxTimelock.connect(deployer).setInPrivateTransferMode(xdx.address, true),
    ).to.be.revertedWith("XdxTimelock: invalid _inPrivateTransferMode");

    await xdxTimelock.connect(deployer).setInPrivateTransferMode(xdx.address, false);
    expect(await xdx.inPrivateTransferMode()).eq(false);

    await xdx.connect(user0).transfer(user1.address, 100);
  });

  it("setAdmin", async () => {
    await expect(xdxTimelock.connect(user0).setAdmin(user1.address)).to.be.revertedWith(
      "XdxTimelock: forbidden",
    );

    expect(await xdxTimelock.admin()).eq(deployer.address);
    await xdxTimelock.connect(deployer).setAdmin(user1.address);
    expect(await xdxTimelock.admin()).eq(user1.address);
  });

  it("setExternalAdmin", async () => {
    const distributor = (
      await ship.deploy(RewardDistributor__factory, {
        args: [user1.address, user2.address],
      })
    ).contract;
    await distributor.setGov(xdxTimelock.address);
    await expect(
      xdxTimelock.connect(user0).setExternalAdmin(distributor.address, user3.address),
    ).to.be.revertedWith("XdxTimelock: forbidden");

    expect(await distributor.admin()).eq(deployer.address);
    await xdxTimelock.connect(deployer).setExternalAdmin(distributor.address, user3.address);
    expect(await distributor.admin()).eq(user3.address);

    await expect(
      xdxTimelock.connect(deployer).setExternalAdmin(xdxTimelock.address, user3.address),
    ).to.be.revertedWith("XdxTimelock: invalid _target");
  });

  it("setInPrivateLiquidationMode", async () => {
    await expect(
      xdxTimelock.connect(user0).setInPrivateLiquidationMode(vault.address, true),
    ).to.be.revertedWith("XdxTimelock: forbidden");

    expect(await vault.inPrivateLiquidationMode()).eq(false);
    await xdxTimelock.connect(deployer).setInPrivateLiquidationMode(vault.address, true);
    expect(await vault.inPrivateLiquidationMode()).eq(true);

    await xdxTimelock.connect(deployer).setInPrivateLiquidationMode(vault.address, false);
    expect(await vault.inPrivateLiquidationMode()).eq(false);
  });

  it("setLiquidator", async () => {
    await expect(
      xdxTimelock.connect(user0).setLiquidator(vault.address, user1.address, true),
    ).to.be.revertedWith("XdxTimelock: forbidden");

    expect(await vault.isLiquidator(user1.address)).eq(false);
    await xdxTimelock.connect(deployer).setLiquidator(vault.address, user1.address, true);
    expect(await vault.isLiquidator(user1.address)).eq(true);

    await xdxTimelock.connect(deployer).setLiquidator(vault.address, user1.address, false);
    expect(await vault.isLiquidator(user1.address)).eq(false);

    await expect(
      vault.connect(user1).liquidatePosition(user0.address, avax.address, avax.address, true, user2.address),
    ).to.be.revertedWith("Vault: empty position");

    await xdxTimelock.connect(deployer).setInPrivateLiquidationMode(vault.address, true);

    await expect(
      vault.connect(user1).liquidatePosition(user0.address, avax.address, avax.address, true, user2.address),
    ).to.be.revertedWith("Vault: invalid liquidator");

    await xdxTimelock.connect(deployer).setLiquidator(vault.address, user1.address, true);

    await expect(
      vault.connect(user1).liquidatePosition(user0.address, avax.address, avax.address, true, user2.address),
    ).to.be.revertedWith("Vault: empty position");
  });

  it("redeemUsdg", async () => {
    await expect(
      xdxTimelock.connect(user0).redeemUsdg(vault.address, avax.address, toWei(1000, 18)),
    ).to.be.revertedWith("XdxTimelock: forbidden");

    await expect(
      xdxTimelock.connect(deployer).redeemUsdg(vault.address, avax.address, toWei(1000, 18)),
    ).to.be.revertedWith("XdxTimelock: action not signalled");

    await expect(
      xdxTimelock.connect(user0).signalRedeemUsdg(vault.address, avax.address, toWei(1000, 18)),
    ).to.be.revertedWith("XdxTimelock: forbidden");

    await xdxTimelock.connect(deployer).signalRedeemUsdg(vault.address, avax.address, toWei(1000, 18));

    await expect(
      xdxTimelock.connect(deployer).redeemUsdg(vault.address, avax.address, toWei(1000, 18)),
    ).to.be.revertedWith("XdxTimelock: action time not yet passed");

    await advanceTimeAndBlock(5 * 24 * 60 * 60);

    await expect(
      xdxTimelock.connect(deployer).redeemUsdg(vault.address, avax.address, toWei(1000, 18)),
    ).to.be.revertedWith("YieldToken: forbidden");

    await usdg.setGov(xdxTimelock.address);

    await expect(
      xdxTimelock.connect(deployer).redeemUsdg(vault.address, avax.address, toWei(1000, 18)),
    ).to.be.revertedWith("Vault: _token not whitelisted");

    await xdxTimelock.connect(deployer).signalSetPriceFeed(vault.address, vaultPriceFeed.address);
    await advanceTimeAndBlock(5 * 24 * 60 * 60 + 10);
    await xdxTimelock.connect(deployer).setPriceFeed(vault.address, vaultPriceFeed.address);

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(500));

    await xdxTimelock.connect(deployer).signalVaultSetTokenConfig(
      vault.address,
      avax.address, // _token
      18, // _tokenDecimals
      7000, // _tokenWeight
      300, // _minProfitBps
      toWei(5000, 18), // _maxUsdgAmount
      false, // _isStable
      true, // isShortable
    );

    await advanceTimeAndBlock(7 * 24 * 60 * 60 + 10);

    await xdxTimelock.connect(deployer).vaultSetTokenConfig(
      vault.address,
      avax.address, // _token
      18, // _tokenDecimals
      7000, // _tokenWeight
      300, // _minProfitBps
      toWei(5000, 18), // _maxUsdgAmount
      false, // _isStable
      true, // isShortable
    );

    await avax.mint(vault.address, toWei(3, 18));
    await vault.buyUSDG(avax.address, user3.address);

    await xdxTimelock.connect(deployer).signalSetGov(vault.address, user1.address);

    await advanceTimeAndBlock(7 * 24 * 60 * 60 + 10);

    await xdxTimelock.setGov(vault.address, user1.address);
    await vault.connect(user1).setInManagerMode(true);
    await vault.connect(user1).setGov(xdxTimelock.address);

    expect(await avax.balanceOf(mintReceiver.address)).eq(0);
    await xdxTimelock.connect(deployer).redeemUsdg(vault.address, avax.address, toWei(1000, 18));
    expect(await avax.balanceOf(mintReceiver.address)).eq("1898095238095238094"); // 1.898
  });
});
