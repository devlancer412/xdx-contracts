import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  Timelock,
  Timelock__factory,
  Token,
  Vault,
  XlxManager,
  Router,
  ShortsTracker,
  Vault__factory,
  XlxManager__factory,
  Router__factory,
  VaultPriceFeed__factory,
  ShortsTracker__factory,
  PositionRouter__factory,
  ReferralStorage__factory,
  ReferralStorage,
  PositionRouter,
  FastPriceFeed,
  FastPriceFeed__factory,
  MaliciousTraderTest__factory,
  PositionRouterCallbackReceiverTest__factory,
  XLX__factory,
} from "../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import {
  advanceBlock,
  advanceTimeAndBlock,
  getTime,
  reportGasUsed,
  Ship,
  toChainlinkPrice,
  toUsd,
  toWei,
} from "../../utils";
import { PriceFeed } from "types";
import { BigNumberish, constants, Wallet } from "ethers";

chai.use(solidity);
const { expect } = chai;

const depositFee = 50;
const minExecutionFee = 4000;

let ship: Ship;
let vault: Vault;
let timelock: Timelock;
let router: Router;
let positionRouter: PositionRouter;
let referralStorage: ReferralStorage;
let avax: Token;
let avaxPriceFeed: PriceFeed;
let btc: Token;
let eth: Token;
let usdc: Token;
let fastPriceFeed: FastPriceFeed;
let shortsTracker: ShortsTracker;

let deployer: SignerWithAddress;
let positionKeeper: SignerWithAddress;
let minter: SignerWithAddress;
let user0: SignerWithAddress;
let user1: SignerWithAddress;
let user2: SignerWithAddress;
let user3: SignerWithAddress;
let user4: SignerWithAddress;
let updater0: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture([
    "vault",
    "timelock",
    "router",
    "positionRouter",
    "referralStorage",
    "tokens",
    "shortsTracker",
    "fastPriceFeed",
  ]);

  return {
    ship,
    accounts,
    users,
  };
});

describe("PositionManager core", function () {
  beforeEach(async () => {
    const { accounts, users } = await setup();

    deployer = accounts.deployer;
    updater0 = accounts.updater1;
    positionKeeper = users[0];
    minter = users[1];
    user0 = users[2];
    user1 = users[3];
    user2 = users[4];
    user3 = users[5];
    user4 = users[6];

    vault = await ship.connect(Vault__factory);
    timelock = await ship.connect(Timelock__factory);
    router = await ship.connect(Router__factory);
    positionRouter = await ship.connect(PositionRouter__factory);
    referralStorage = await ship.connect(ReferralStorage__factory);
    avax = (await ship.connect("avax")) as Token;
    avaxPriceFeed = (await ship.connect("avaxPriceFeed")) as PriceFeed;
    btc = (await ship.connect("btc")) as Token;
    eth = (await ship.connect("eth")) as Token;
    usdc = (await ship.connect("usdc")) as Token;
    shortsTracker = await ship.connect(ShortsTracker__factory);
    fastPriceFeed = await ship.connect(FastPriceFeed__factory);
    const vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);

    await timelock.setBuffer(5 * 24 * 60 * 60);
    await positionRouter.setDepositFee(depositFee);
    await positionRouter.setMinExecutionFee(minExecutionFee);
    await fastPriceFeed.setMaxPriceUpdateDelay(120 * 60);
    await fastPriceFeed.setMinBlockInterval(1);

    await vault.setManager(deployer.address, true);
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
    await vaultPriceFeed.setIsSecondaryPriceEnabled(false);
    await positionRouter.setDelayValues(0, 0, 0);
    await router.removePlugin(positionRouter.address);
    await timelock.setContractHandler(positionRouter.address, false);
    await router.connect(user0).denyPlugin(positionRouter.address);
    await vault.setIsLeverageEnabled(false);
    await timelock.setShouldToggleIsLeverageEnabled(false);
    await vault.setGov(timelock.address);

    await avax.connect(minter).deposit({ value: toWei(100, 18) });
  });

  it("inits", async () => {
    expect(await positionRouter.vault()).eq(vault.address);
    expect(await positionRouter.router()).eq(router.address);
    expect(await positionRouter.weth()).eq(avax.address);
    expect(await positionRouter.depositFee()).eq(depositFee);
    expect(await positionRouter.minExecutionFee()).eq(minExecutionFee);
    expect(await positionRouter.admin()).eq(deployer.address);
    expect(await positionRouter.gov()).eq(deployer.address);
  });

  it("setAdmin", async () => {
    await expect(positionRouter.connect(user0).setAdmin(user1.address)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await positionRouter.setGov(user0.address);

    expect(await positionRouter.admin()).eq(deployer.address);
    await positionRouter.connect(user0).setAdmin(user1.address);
    expect(await positionRouter.admin()).eq(user1.address);
  });

  it("setDepositFee", async () => {
    await expect(positionRouter.connect(user0).setDepositFee(25)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    await positionRouter.setAdmin(user0.address);

    expect(await positionRouter.depositFee()).eq(depositFee);
    await positionRouter.connect(user0).setDepositFee(25);
    expect(await positionRouter.depositFee()).eq(25);
  });

  it("setIncreasePositionBufferBps", async () => {
    await expect(positionRouter.connect(user0).setIncreasePositionBufferBps(200)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    await positionRouter.setAdmin(user0.address);

    expect(await positionRouter.increasePositionBufferBps()).eq(100);
    await positionRouter.connect(user0).setIncreasePositionBufferBps(200);
    expect(await positionRouter.increasePositionBufferBps()).eq(200);
  });

  it("setReferralStorage", async () => {
    await expect(positionRouter.connect(user0).setReferralStorage(user1.address)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    await positionRouter.setAdmin(user0.address);

    expect(await positionRouter.referralStorage()).eq(referralStorage.address);
    await positionRouter.connect(user0).setReferralStorage(user1.address);
    expect(await positionRouter.referralStorage()).eq(user1.address);
  });

  it("setMaxGlobalSizes", async () => {
    const tokens = [avax.address, btc.address, eth.address];
    const maxGlobalLongSizes = [7, 20, 15];
    const maxGlobalShortSizes = [3, 12, 8];

    await expect(
      positionRouter.connect(user0).setMaxGlobalSizes(tokens, maxGlobalLongSizes, maxGlobalShortSizes),
    ).to.be.revertedWith("BasePositionManager: forbidden");

    await positionRouter.setAdmin(user0.address);

    expect(await positionRouter.maxGlobalLongSizes(avax.address)).eq(0);
    expect(await positionRouter.maxGlobalLongSizes(btc.address)).eq(0);
    expect(await positionRouter.maxGlobalLongSizes(eth.address)).eq(0);

    expect(await positionRouter.maxGlobalShortSizes(avax.address)).eq(0);
    expect(await positionRouter.maxGlobalShortSizes(btc.address)).eq(0);
    expect(await positionRouter.maxGlobalShortSizes(eth.address)).eq(0);

    await positionRouter.connect(user0).setMaxGlobalSizes(tokens, maxGlobalLongSizes, maxGlobalShortSizes);

    expect(await positionRouter.maxGlobalLongSizes(avax.address)).eq(7);
    expect(await positionRouter.maxGlobalLongSizes(btc.address)).eq(20);
    expect(await positionRouter.maxGlobalLongSizes(eth.address)).eq(15);

    expect(await positionRouter.maxGlobalShortSizes(avax.address)).eq(3);
    expect(await positionRouter.maxGlobalShortSizes(btc.address)).eq(12);
    expect(await positionRouter.maxGlobalShortSizes(eth.address)).eq(8);
  });

  it("withdrawFees", async () => {
    await positionRouter.setDelayValues(0, 300, 500);
    await avax.mint(vault.address, toWei(30, 18));
    await vault.buyUSDG(avax.address, user1.address);
    await timelock.setContractHandler(positionRouter.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123";

    let params: [string[], string, BigNumberish, BigNumberish, BigNumberish, boolean, BigNumberish] = [
      [usdc.address, avax.address], // _path
      avax.address, // _indexToken
      toWei(600, 6), // _amountIn
      toWei(1, 6), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(300), // _acceptablePrice
    ];

    await router.addPlugin(positionRouter.address);
    await router.connect(user0).approvePlugin(positionRouter.address);

    await usdc.mint(user0.address, toWei(600, 6));
    await usdc.connect(user0).approve(router.address, toWei(600, 6));

    let key = await positionRouter.getRequestKey(user0.address, 1);

    const executionFeeReceiver = Wallet.createRandom();
    await positionRouter.setPositionKeeper(positionKeeper.address, true);

    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address);
    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(4000);

    params = [
      [usdc.address, avax.address], // _path
      avax.address, // _indexToken
      toWei(600, 6), // _amountIn
      toWei(1, 6), // _minOut
      toUsd(0), // _sizeDelta
      true, // _isLong
      toUsd(300), // _acceptablePrice
    ];

    await usdc.mint(user0.address, toWei(600, 6));
    await usdc.connect(user0).approve(router.address, toWei(600, 6));

    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });
    key = await positionRouter.getRequestKey(user0.address, 2);

    expect(await positionRouter.feeReserves(avax.address)).eq(0);
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address);
    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(8000);
    expect(await positionRouter.feeReserves(usdc.address)).eq(0);
    expect(await positionRouter.feeReserves(avax.address)).eq("9970000000000000"); // 0.00997

    await expect(positionRouter.connect(user2).withdrawFees(usdc.address, user3.address)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    await positionRouter.setAdmin(user2.address);

    expect(await usdc.balanceOf(user3.address)).eq(0);
    expect(await avax.balanceOf(user3.address)).eq(0);

    await positionRouter.connect(user2).withdrawFees(usdc.address, user3.address);

    expect(await positionRouter.feeReserves(usdc.address)).eq(0);
    expect(await positionRouter.feeReserves(avax.address)).eq("9970000000000000"); // 0.00997

    expect(await usdc.balanceOf(user3.address)).eq(0);
    expect(await avax.balanceOf(user3.address)).eq(0);

    await positionRouter.connect(user2).withdrawFees(avax.address, user3.address);

    expect(await usdc.balanceOf(user3.address)).eq(0);
    expect(await avax.balanceOf(user3.address)).eq("9970000000000000");

    expect(await positionRouter.feeReserves(usdc.address)).eq(0);
    expect(await positionRouter.feeReserves(avax.address)).eq(0);
  });

  it("approve", async () => {
    await expect(positionRouter.connect(user0).approve(avax.address, user1.address, 100)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await positionRouter.setGov(user0.address);

    expect(await avax.allowance(positionRouter.address, user1.address)).eq(0);
    await positionRouter.connect(user0).approve(avax.address, user1.address, 100);
    expect(await avax.allowance(positionRouter.address, user1.address)).eq(100);
  });

  it("sendValue", async () => {
    await expect(positionRouter.connect(user0).sendValue(user1.address, 0)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await positionRouter.setGov(user0.address);

    await positionRouter.connect(user0).sendValue(user1.address, 0);
  });

  it("setPositionKeeper", async () => {
    await expect(positionRouter.connect(user0).setPositionKeeper(user1.address, true)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    await positionRouter.setAdmin(user0.address);

    expect(await positionRouter.isPositionKeeper(user1.address)).eq(false);
    await positionRouter.connect(user0).setPositionKeeper(user1.address, true);
    expect(await positionRouter.isPositionKeeper(user1.address)).eq(true);

    await positionRouter.connect(user0).setPositionKeeper(user1.address, false);
    expect(await positionRouter.isPositionKeeper(user1.address)).eq(false);
  });

  it("setMinExecutionFee", async () => {
    await expect(positionRouter.connect(user0).setMinExecutionFee("7000")).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    await positionRouter.setAdmin(user0.address);

    expect(await positionRouter.minExecutionFee()).eq(minExecutionFee);
    await positionRouter.connect(user0).setMinExecutionFee("7000");
    expect(await positionRouter.minExecutionFee()).eq("7000");
  });

  it("setIsLeverageEnabled", async () => {
    await expect(positionRouter.connect(user0).setIsLeverageEnabled(false)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    await positionRouter.setAdmin(user0.address);

    expect(await positionRouter.isLeverageEnabled()).eq(true);
    await positionRouter.connect(user0).setIsLeverageEnabled(false);
    expect(await positionRouter.isLeverageEnabled()).eq(false);
  });

  it("setDelayValues", async () => {
    await expect(positionRouter.connect(user0).setDelayValues(7, 21, 600)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    await positionRouter.setAdmin(user0.address);

    expect(await positionRouter.minBlockDelayKeeper()).eq(0);
    expect(await positionRouter.minTimeDelayPublic()).eq(0);
    expect(await positionRouter.maxTimeDelay()).eq(0);

    await positionRouter.connect(user0).setDelayValues(7, 21, 600);

    expect(await positionRouter.minBlockDelayKeeper()).eq(7);
    expect(await positionRouter.minTimeDelayPublic()).eq(21);
    expect(await positionRouter.maxTimeDelay()).eq(600);
  });

  it("setRequestKeysStartValues", async () => {
    await expect(positionRouter.connect(user0).setRequestKeysStartValues(5, 8)).to.be.revertedWith(
      "BasePositionManager: forbidden",
    );

    await positionRouter.setAdmin(user0.address);

    expect(await positionRouter.increasePositionRequestKeysStart()).eq(0);
    expect(await positionRouter.decreasePositionRequestKeysStart()).eq(0);

    await positionRouter.connect(user0).setRequestKeysStartValues(5, 8);

    expect(await positionRouter.increasePositionRequestKeysStart()).eq(5);
    expect(await positionRouter.decreasePositionRequestKeysStart()).eq(8);
  });

  it("increasePosition acceptablePrice long", async () => {
    await positionRouter.setDelayValues(0, 300, 500);
    await avax.mint(vault.address, toWei(30, 18));
    await vault.buyUSDG(avax.address, user1.address);
    await timelock.setContractHandler(positionRouter.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123";

    const params: [string[], string, BigNumberish, BigNumberish, BigNumberish, boolean, BigNumberish] = [
      [usdc.address, avax.address], // _path
      avax.address, // _indexToken
      toWei(600, 6), // _amountIn
      toWei(1, 6), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(290), // _acceptablePrice
    ];

    await router.addPlugin(positionRouter.address);
    await router.connect(user0).approvePlugin(positionRouter.address);

    await usdc.mint(user0.address, toWei(600, 6));
    await usdc.connect(user0).approve(router.address, toWei(600, 6));

    const key = await positionRouter.getRequestKey(user0.address, 1);

    const executionFeeReceiver = Wallet.createRandom();
    await positionRouter.setPositionKeeper(positionKeeper.address, true);

    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });
    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("BasePositionManager: mark price higher than limit");
  });

  it("increasePosition minOut long", async () => {
    await positionRouter.setDelayValues(0, 300, 500);
    await avax.mint(vault.address, toWei(30, 18));
    await vault.buyUSDG(avax.address, user1.address);
    await timelock.setContractHandler(positionRouter.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123";

    const params: [string[], string, BigNumberish, BigNumberish, BigNumberish, boolean, BigNumberish] = [
      [usdc.address, avax.address], // _path
      avax.address, // _indexToken
      toWei(600, 6), // _amountIn
      toWei(2, 18), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(310), // _acceptablePrice
    ];

    await router.addPlugin(positionRouter.address);
    await router.connect(user0).approvePlugin(positionRouter.address);

    await usdc.mint(user0.address, toWei(600, 6));
    await usdc.connect(user0).approve(router.address, toWei(600, 6));

    const key = await positionRouter.getRequestKey(user0.address, 1);

    const executionFeeReceiver = Wallet.createRandom();
    await positionRouter.setPositionKeeper(positionKeeper.address, true);

    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });
    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("BasePositionManager: insufficient amountOut");
  });

  it("validateExecution", async () => {
    await positionRouter.setDelayValues(5, 300, 500);
    await avax.mint(vault.address, toWei(30, 18));
    await vault.buyUSDG(avax.address, user1.address);
    await timelock.setContractHandler(positionRouter.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123";

    const params: [string[], string, BigNumberish, BigNumberish, BigNumberish, boolean, BigNumberish] = [
      [usdc.address, avax.address], // _path
      avax.address, // _indexToken
      toWei(600, 6), // _amountIn
      toWei(1, 6), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(310), // _acceptablePrice
    ];

    await router.addPlugin(positionRouter.address);
    await router.connect(user0).approvePlugin(positionRouter.address);

    let key = await positionRouter.getRequestKey(user0.address, 1);

    const executionFeeReceiver = Wallet.createRandom();
    await positionRouter.setPositionKeeper(positionKeeper.address, true);

    await usdc.mint(user0.address, toWei(600, 6));
    await usdc.connect(user0).approve(router.address, toWei(600, 6));

    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address);

    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(0);

    await expect(
      positionRouter.connect(user1).executeIncreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("403");

    await expect(
      positionRouter.connect(user0).executeIncreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("delay");

    await advanceTimeAndBlock(200);

    await expect(
      positionRouter.connect(user0).executeIncreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("delay");

    await advanceTimeAndBlock(110);

    let request = await positionRouter.increasePositionRequests(key);

    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(0);
    expect(request.account).eq(user0.address);

    await positionRouter.connect(user0).executeIncreasePosition(key, executionFeeReceiver.address);

    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(constants.AddressZero);

    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(4000);
    expect(await vault.guaranteedUsd(avax.address)).eq("5407800000000000000000000000000000");

    await usdc.mint(user0.address, toWei(600, 6));
    await usdc.connect(user0).approve(router.address, toWei(600, 6));

    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });

    await advanceTimeAndBlock(510);

    key = await positionRouter.getRequestKey(user0.address, 2);
    await expect(
      positionRouter.connect(user0).executeIncreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("expired");
  });

  it("validateCancellation", async () => {
    await positionRouter.setDelayValues(5, 300, 500);
    await avax.mint(vault.address, toWei(30, 18));
    await vault.buyUSDG(avax.address, user1.address);
    await timelock.setContractHandler(positionRouter.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123";

    const params: [string[], string, BigNumberish, BigNumberish, BigNumberish, boolean, BigNumberish] = [
      [usdc.address, avax.address], // _path
      avax.address, // _indexToken
      toWei(600, 6), // _amountIn
      toWei(1, 6), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(310), // _acceptablePrice
    ];

    await router.addPlugin(positionRouter.address);
    await router.connect(user0).approvePlugin(positionRouter.address);

    let key = await positionRouter.getRequestKey(user0.address, 1);

    const executionFeeReceiver = Wallet.createRandom();
    await positionRouter.setPositionKeeper(positionKeeper.address, true);

    await usdc.mint(user0.address, toWei(600, 6));
    await usdc.connect(user0).approve(router.address, toWei(600, 6));

    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });
    await positionRouter.connect(positionKeeper).cancelIncreasePosition(key, executionFeeReceiver.address);

    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(0);

    await expect(
      positionRouter.connect(user1).cancelIncreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("403");

    await expect(
      positionRouter.connect(user0).cancelIncreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("delay");

    await advanceTimeAndBlock(200);

    await expect(
      positionRouter.connect(user0).cancelIncreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("delay");

    await advanceTimeAndBlock(110);

    let request = await positionRouter.increasePositionRequests(key);

    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(0);
    expect(request.account).eq(user0.address);

    await positionRouter.connect(user0).cancelIncreasePosition(key, executionFeeReceiver.address);

    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(constants.AddressZero);

    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(4000);
    expect(await vault.guaranteedUsd(avax.address)).eq(0);

    await usdc.mint(user0.address, toWei(600, 6));
    await usdc.connect(user0).approve(router.address, toWei(600, 6));

    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });

    await advanceTimeAndBlock(1000);

    key = await positionRouter.getRequestKey(user0.address, 2);

    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(user0.address);

    await positionRouter.connect(user0).cancelIncreasePosition(key, executionFeeReceiver.address);

    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(constants.AddressZero);
    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(8000);
  });

  it("maxGlobalLongSize", async () => {
    await positionRouter.setDelayValues(0, 300, 500);
    await avax.mint(vault.address, toWei(30, 18));
    await vault.buyUSDG(avax.address, user1.address);
    await timelock.setContractHandler(positionRouter.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);
    await positionRouter.setMaxGlobalSizes([avax.address, btc.address], [toUsd(5000), toUsd(10000)], [0, 0]);

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123";

    const params: [string[], string, BigNumberish, BigNumberish, BigNumberish, boolean, BigNumberish] = [
      [usdc.address, avax.address], // _path
      avax.address, // _indexToken
      toWei(600, 6), // _amountIn
      toWei(1, 6), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(310), // _acceptablePrice
    ];

    await router.addPlugin(positionRouter.address);
    await router.connect(user0).approvePlugin(positionRouter.address);

    await usdc.mint(user0.address, toWei(600, 6));
    await usdc.connect(user0).approve(router.address, toWei(600, 6));

    const executionFeeReceiver = Wallet.createRandom();
    await positionRouter.setPositionKeeper(positionKeeper.address, true);

    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });
    const key = await positionRouter.getRequestKey(user0.address, 1);
    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("BasePositionManager: max global longs exceeded");

    await positionRouter.setMaxGlobalSizes([avax.address, btc.address], [toUsd(6000), toUsd(10000)], [0, 0]);

    expect(await vault.guaranteedUsd(avax.address)).eq(0);
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address);
    expect(await vault.guaranteedUsd(avax.address)).eq("5407800000000000000000000000000000"); // 5407.8
  });

  it("decreasePosition acceptablePrice long", async () => {
    await positionRouter.setDelayValues(0, 300, 500);
    await avax.mint(vault.address, toWei(30, 18));
    await vault.buyUSDG(avax.address, user1.address);
    await timelock.setContractHandler(positionRouter.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123";

    const params: [string[], string, BigNumberish, BigNumberish, BigNumberish, boolean, BigNumberish] = [
      [usdc.address, avax.address], // _path
      avax.address, // _indexToken
      toWei(600, 6), // _amountIn
      toWei(1, 6), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(310), // _acceptablePrice
    ];

    await router.addPlugin(positionRouter.address);
    await router.connect(user0).approvePlugin(positionRouter.address);

    await usdc.mint(user0.address, toWei(600, 6));
    await usdc.connect(user0).approve(router.address, toWei(600, 6));

    let key = await positionRouter.getRequestKey(user0.address, 1);

    const executionFeeReceiver = Wallet.createRandom();
    await positionRouter.setPositionKeeper(positionKeeper.address, true);

    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address);

    const decreasePositionParams: [
      string[],
      string,
      BigNumberish,
      BigNumberish,
      boolean,
      string,
      BigNumberish,
      BigNumberish,
    ] = [
      [avax.address, usdc.address], // _collateralToken
      avax.address, // _indexToken
      toUsd(300), // _collateralDelta
      toUsd(1000), // _sizeDelta
      true, // _isLong
      user1.address, // _receiver
      toUsd(310), // _acceptablePrice
      0, // _minOut
    ];

    await positionRouter
      .connect(user0)
      .createDecreasePosition(...decreasePositionParams, 4000, false, constants.AddressZero, {
        value: 4000,
      });
    key = await positionRouter.getRequestKey(user0.address, 1);
    await expect(
      positionRouter.connect(positionKeeper).executeDecreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("BasePositionManager: mark price lower than limit");
  });

  it("decreasePosition minOut long", async () => {
    await positionRouter.setDelayValues(0, 300, 500);
    await avax.mint(vault.address, toWei(30, 18));
    await vault.buyUSDG(avax.address, user1.address);
    await timelock.setContractHandler(positionRouter.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123";

    const params: [string[], string, BigNumberish, BigNumberish, BigNumberish, boolean, BigNumberish] = [
      [usdc.address, avax.address], // _path
      avax.address, // _indexToken
      toWei(600, 6), // _amountIn
      toWei(1, 6), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(310), // _acceptablePrice
    ];

    await router.addPlugin(positionRouter.address);
    await router.connect(user0).approvePlugin(positionRouter.address);

    await usdc.mint(user0.address, toWei(600, 6));
    await usdc.connect(user0).approve(router.address, toWei(600, 6));

    let key = await positionRouter.getRequestKey(user0.address, 1);

    const executionFeeReceiver = Wallet.createRandom();
    await positionRouter.setPositionKeeper(positionKeeper.address, true);

    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address);

    const decreasePositionParams: [
      string[],
      string,
      BigNumberish,
      BigNumberish,
      boolean,
      string,
      BigNumberish,
      BigNumberish,
    ] = [
      [avax.address, usdc.address], // _collateralToken
      avax.address, // _indexToken
      toUsd(300), // _collateralDelta
      toUsd(1000), // _sizeDelta
      true, // _isLong
      user1.address, // _receiver
      toUsd(290), // _acceptablePrice
      toWei(300, 18), // _minOut
    ];

    await positionRouter
      .connect(user0)
      .createDecreasePosition(...decreasePositionParams, 4000, false, constants.AddressZero, {
        value: 4000,
      });
    key = await positionRouter.getRequestKey(user0.address, 1);
    await expect(
      positionRouter.connect(positionKeeper).executeDecreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("BasePositionManager: insufficient amountOut");
  });

  it("increasePosition acceptablePrice short", async () => {
    await positionRouter.setDelayValues(0, 300, 500);
    await usdc.mint(vault.address, toWei(8000, 18));
    await vault.buyUSDG(usdc.address, user1.address);
    await timelock.setContractHandler(positionRouter.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123";

    const params: [string[], string, BigNumberish, BigNumberish, BigNumberish, boolean, BigNumberish] = [
      [avax.address, usdc.address], // _path
      avax.address, // _indexToken
      toWei(2, 18), // _amountIn
      toWei(1, 6), // _minOut
      toUsd(6000), // _sizeDelta
      false, // _isLong
      toUsd(310), // _acceptablePrice
    ];

    await router.addPlugin(positionRouter.address);
    await router.connect(user0).approvePlugin(positionRouter.address);

    await avax.mint(user0.address, toWei(2, 18));
    await avax.connect(user0).approve(router.address, toWei(2, 18));

    const key = await positionRouter.getRequestKey(user0.address, 1);

    const executionFeeReceiver = Wallet.createRandom();
    await positionRouter.setPositionKeeper(positionKeeper.address, true);

    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });
    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("BasePositionManager: mark price lower than limit");
  });

  it("maxGlobalShortSize", async () => {
    await positionRouter.setDelayValues(0, 300, 500);
    await usdc.mint(vault.address, toWei(8000, 18));
    await vault.buyUSDG(usdc.address, user1.address);
    await timelock.setContractHandler(positionRouter.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);

    await positionRouter.setMaxGlobalSizes([avax.address, btc.address], [0, 0], [toUsd(5000), toUsd(10000)]);

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123";

    const params: [string[], string, BigNumberish, BigNumberish, BigNumberish, boolean, BigNumberish] = [
      [avax.address, usdc.address], // _path
      avax.address, // _indexToken
      toWei(2, 18), // _amountIn
      toWei(1, 6), // _minOut
      toUsd(6000), // _sizeDelta
      false, // _isLong
      toUsd(290), // _acceptablePrice
    ];

    await router.addPlugin(positionRouter.address);
    await router.connect(user0).approvePlugin(positionRouter.address);

    await avax.mint(user0.address, toWei(2, 18));
    await avax.connect(user0).approve(router.address, toWei(2, 18));

    const key = await positionRouter.getRequestKey(user0.address, 1);

    const executionFeeReceiver = Wallet.createRandom();
    await positionRouter.setPositionKeeper(positionKeeper.address, true);

    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });
    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("BasePositionManager: max global shorts exceeded");

    await positionRouter.setMaxGlobalSizes([avax.address, btc.address], [0, 0], [toUsd(6000), toUsd(10000)]);

    expect(await vault.globalShortSizes(avax.address)).eq(0);
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address);
    expect(await vault.globalShortSizes(avax.address)).eq("6000000000000000000000000000000000"); // 6000
  });

  it("decreasePosition acceptablePrice short", async () => {
    await positionRouter.setDelayValues(0, 300, 500);
    await usdc.mint(vault.address, toWei(8000, 18));
    await vault.buyUSDG(usdc.address, user1.address);
    await timelock.setContractHandler(positionRouter.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123";

    const params: [string[], string, BigNumberish, BigNumberish, BigNumberish, boolean, BigNumberish] = [
      [avax.address, usdc.address], // _path
      avax.address, // _indexToken
      toWei(2, 18), // _amountIn
      toWei(1, 6), // _minOut
      toUsd(6000), // _sizeDelta
      false, // _isLong
      toUsd(290), // _acceptablePrice
    ];

    await router.addPlugin(positionRouter.address);
    await router.connect(user0).approvePlugin(positionRouter.address);

    await avax.mint(user0.address, toWei(2, 18));
    await avax.connect(user0).approve(router.address, toWei(2, 18));

    let key = await positionRouter.getRequestKey(user0.address, 1);

    const executionFeeReceiver = Wallet.createRandom();
    await positionRouter.setPositionKeeper(positionKeeper.address, true);

    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address);

    const decreasePositionParams: [
      string[],
      string,
      BigNumberish,
      BigNumberish,
      boolean,
      string,
      BigNumberish,
      BigNumberish,
    ] = [
      [usdc.address, avax.address], // _collateralToken
      avax.address, // _indexToken
      toUsd(300), // _collateralDelta
      toUsd(1000), // _sizeDelta
      false, // _isLong
      user1.address, // _receiver
      toUsd(290), // _acceptablePrice
      0, // _minOut
    ];

    await positionRouter
      .connect(user0)
      .createDecreasePosition(...decreasePositionParams, 4000, false, constants.AddressZero, {
        value: 4000,
      });
    key = await positionRouter.getRequestKey(user0.address, 1);
    await expect(
      positionRouter.connect(positionKeeper).executeDecreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("BasePositionManager: mark price higher than limit");
  });

  it("createIncreasePosition, executeIncreasePosition, cancelIncreasePosition", async () => {
    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123";

    const params: [string[], string, BigNumberish, BigNumberish, BigNumberish, boolean, BigNumberish] = [
      [usdc.address, avax.address], // _path
      avax.address, // _indexToken
      toWei(600, 6), // _amountIn
      toWei(1, 6), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(300), // _acceptablePrice
    ];

    await expect(
      positionRouter
        .connect(user0)
        .createIncreasePosition(...params, 3000, referralCode, constants.AddressZero),
    ).to.be.revertedWith("fee");

    await expect(
      positionRouter
        .connect(user0)
        .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero),
    ).to.be.revertedWith("val");

    await expect(
      positionRouter
        .connect(user0)
        .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 3000 }),
    ).to.be.revertedWith("val");

    params[0] = [];
    await expect(
      positionRouter
        .connect(user0)
        .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 }),
    ).to.be.revertedWith("len");

    params[0] = [usdc.address, avax.address, avax.address];

    await expect(
      positionRouter
        .connect(user0)
        .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 }),
    ).to.be.revertedWith("len");

    params[0] = [usdc.address, avax.address];

    await expect(
      positionRouter
        .connect(user0)
        .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 }),
    ).to.be.revertedWith("Router: invalid plugin");

    await router.addPlugin(positionRouter.address);

    await expect(
      positionRouter
        .connect(user0)
        .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 }),
    ).to.be.revertedWith("Router: plugin not approved");

    await router.connect(user0).approvePlugin(positionRouter.address);

    await expect(
      positionRouter
        .connect(user0)
        .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 }),
    ).to.be.revertedWith("ERC20: transfer amount exceeds balance");

    await usdc.mint(user0.address, toWei(600, 6));

    await expect(
      positionRouter
        .connect(user0)
        .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 }),
    ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");

    await usdc.connect(user0).approve(router.address, toWei(600, 6));

    let key = await positionRouter.getRequestKey(user0.address, 1);
    let request = await positionRouter.increasePositionRequests(key);

    expect(await referralStorage.traderReferralCodes(user0.address)).eq(constants.HashZero);
    expect(await usdc.balanceOf(positionRouter.address)).eq(0);
    expect(await positionRouter.increasePositionsIndex(user0.address)).eq(0);

    expect(request.account).eq(constants.AddressZero);
    expect(request.indexToken).eq(constants.AddressZero);
    expect(request.amountIn).eq(0);
    expect(request.minOut).eq(0);
    expect(request.sizeDelta).eq(0);
    expect(request.isLong).eq(false);
    expect(request.acceptablePrice).eq(0);
    expect(request.executionFee).eq(0);
    expect(request.blockNumber).eq(0);
    expect(request.blockTime).eq(0);
    expect(request.hasCollateralInETH).eq(false);

    let queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(0); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    expect(await ship.provider.getBalance(positionRouter.address)).eq(0);
    expect(await avax.balanceOf(positionRouter.address)).eq(0);
    expect(await usdc.balanceOf(positionRouter.address)).eq(0);

    const tx0 = await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });
    await reportGasUsed(tx0, "createIncreasePosition gas used");

    expect(await ship.provider.getBalance(positionRouter.address)).eq(0);
    expect(await avax.balanceOf(positionRouter.address)).eq(4000);
    expect(await usdc.balanceOf(positionRouter.address)).eq(toWei(600, 6));

    const blockNumber = await ship.provider.getBlockNumber();
    const blockTime = await getTime();

    request = await positionRouter.increasePositionRequests(key);

    expect(await referralStorage.traderReferralCodes(user0.address)).eq(referralCode);
    expect(await usdc.balanceOf(positionRouter.address)).eq(toWei(600, 6));
    expect(await positionRouter.increasePositionsIndex(user0.address)).eq(1);

    expect(request.account).eq(user0.address);
    expect(request.indexToken).eq(avax.address);
    expect(request.amountIn).eq(toWei(600, 6));
    expect(request.minOut).eq(toWei(1, 6));
    expect(request.sizeDelta).eq(toUsd(6000));
    expect(request.isLong).eq(true);
    expect(request.acceptablePrice).eq(toUsd(300));
    expect(request.executionFee).eq(4000);
    expect(request.blockNumber).eq(blockNumber);
    expect(request.blockTime).eq(blockTime);
    expect(request.hasCollateralInETH).eq(false);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(1); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    await positionRouter.setDelayValues(5, 300, 500);

    const executionFeeReceiver = Wallet.createRandom();
    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("403");

    await positionRouter.setPositionKeeper(positionKeeper.address, true);

    // executeIncreasePosition will return without error and without executing the position if the minBlockDelayKeeper has not yet passed
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address);

    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(user0.address);

    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("Vault: poolAmount exceeded");

    await avax.mint(vault.address, toWei(30, 18));
    await vault.buyUSDG(avax.address, user1.address);

    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("Timelock: forbidden");

    await timelock.setContractHandler(positionRouter.address, true);

    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("Vault: leverage not enabled");

    await timelock.setShouldToggleIsLeverageEnabled(true);

    let position = await vault.getPosition(user0.address, avax.address, avax.address, true);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit
    expect(position[7]).eq(0); // lastIncreasedTime

    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(0);

    const tx1 = await positionRouter
      .connect(positionKeeper)
      .executeIncreasePosition(key, executionFeeReceiver.address);
    await reportGasUsed(tx1, "executeIncreasePosition gas used");

    expect(await ship.provider.getBalance(positionRouter.address)).eq(0);
    expect(await avax.balanceOf(positionRouter.address)).eq(0);
    expect(await usdc.balanceOf(positionRouter.address)).eq(0);

    request = await positionRouter.increasePositionRequests(key);

    expect(request.account).eq(constants.AddressZero);
    expect(request.indexToken).eq(constants.AddressZero);
    expect(request.amountIn).eq(0);
    expect(request.minOut).eq(0);
    expect(request.sizeDelta).eq(0);
    expect(request.isLong).eq(false);
    expect(request.acceptablePrice).eq(0);
    expect(request.executionFee).eq(0);
    expect(request.blockNumber).eq(0);
    expect(request.blockTime).eq(0);
    expect(request.hasCollateralInETH).eq(false);

    position = await vault.getPosition(user0.address, avax.address, avax.address, true);
    expect(position[0]).eq(toUsd(6000)); // size
    expect(position[1]).eq("592200000000000000000000000000000"); // collateral, 592.2
    expect(position[2]).eq(toUsd(300)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(toWei(20, 18)); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit

    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(4000);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(1); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    await usdc.mint(user1.address, toWei(600, 6));
    await usdc.connect(user1).approve(router.address, toWei(600, 6));
    await router.connect(user1).approvePlugin(positionRouter.address);

    await positionRouter
      .connect(user1)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });

    expect(await ship.provider.getBalance(positionRouter.address)).eq(0);
    expect(await avax.balanceOf(positionRouter.address)).eq(4000);
    expect(await usdc.balanceOf(positionRouter.address)).eq(toWei(600, 6));
    expect(await usdc.balanceOf(user1.address)).eq(0);

    key = await positionRouter.getRequestKey(user1.address, 1);
    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(user1.address);

    await positionRouter.connect(positionKeeper).cancelIncreasePosition(key, executionFeeReceiver.address);
    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(user1.address);

    await advanceBlock();
    await advanceBlock();
    await advanceBlock();

    const tx2 = await positionRouter
      .connect(positionKeeper)
      .cancelIncreasePosition(key, executionFeeReceiver.address);
    await reportGasUsed(tx2, "cancelIncreasePosition gas used");

    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(constants.AddressZero);

    expect(await ship.provider.getBalance(positionRouter.address)).eq(0);
    expect(await avax.balanceOf(positionRouter.address)).eq(0);
    expect(await usdc.balanceOf(positionRouter.address)).eq(0);
    expect(await usdc.balanceOf(user1.address)).eq(toWei(600, 6));

    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(8000);

    await usdc.mint(user2.address, toWei(600, 6));
    await usdc.connect(user2).approve(router.address, toWei(600, 6));
    await router.connect(user2).approvePlugin(positionRouter.address);

    params[0] = [usdc.address]; // _path
    params[5] = false; // _isLong

    const tx3 = await positionRouter
      .connect(user2)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });
    await reportGasUsed(tx3, "createIncreasePosition gas used");

    key = await positionRouter.getRequestKey(user2.address, 1);

    await usdc.mint(vault.address, toWei(7000, 18));
    await vault.buyUSDG(usdc.address, user1.address);

    await advanceBlock();
    await advanceBlock();

    const tx4 = await positionRouter
      .connect(positionKeeper)
      .executeIncreasePosition(key, executionFeeReceiver.address);
    await reportGasUsed(tx4, "executeIncreasePosition gas used");

    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(constants.AddressZero);

    position = await vault.getPosition(user2.address, usdc.address, avax.address, false);
    expect(position[0]).eq(toUsd(6000)); // size
    expect(position[1]).eq("594000000000000000000000000000000"); // collateral, 594
    expect(position[2]).eq(toUsd(300)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(toWei(6000, 6)); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(3); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length
  });

  it("createIncreasePositionETH, executeIncreasePosition, cancelIncreasePosition", async () => {
    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123";

    const params: [string[], string, BigNumberish, BigNumberish, boolean, BigNumberish] = [
      [usdc.address, avax.address], // _path
      avax.address, // _indexToken
      toWei(290, 6), // _minOut
      toUsd(6000), // _sizeDelta
      false, // _isLong
      toUsd(300), // _acceptablePrice
    ];

    await expect(
      positionRouter
        .connect(user0)
        .createIncreasePositionETH(...params, 3000, referralCode, constants.AddressZero),
    ).to.be.revertedWith("fee");

    await expect(
      positionRouter
        .connect(user0)
        .createIncreasePositionETH(...params, 4000, referralCode, constants.AddressZero, { value: 3000 }),
    ).to.be.revertedWith("val");

    await expect(
      positionRouter
        .connect(user0)
        .createIncreasePositionETH(...params, 4000, referralCode, constants.AddressZero, {
          value: 4000,
        }),
    ).to.be.revertedWith("path");

    params[0] = [];
    await expect(
      positionRouter
        .connect(user0)
        .createIncreasePositionETH(...params, 4000, referralCode, constants.AddressZero, {
          value: 4000,
        }),
    ).to.be.revertedWith("len");

    params[0] = [avax.address, usdc.address, usdc.address];
    await expect(
      positionRouter
        .connect(user0)
        .createIncreasePositionETH(...params, 4000, referralCode, constants.AddressZero, {
          value: 4000,
        }),
    ).to.be.revertedWith("len");

    params[0] = [avax.address, usdc.address];

    let key = await positionRouter.getRequestKey(user0.address, 1);
    let request = await positionRouter.increasePositionRequests(key);

    expect(await referralStorage.traderReferralCodes(user0.address)).eq(constants.HashZero);
    expect(await avax.balanceOf(positionRouter.address)).eq(0);
    expect(await positionRouter.increasePositionsIndex(user0.address)).eq(0);

    expect(request.account).eq(constants.AddressZero);
    expect(request.indexToken).eq(constants.AddressZero);
    expect(request.amountIn).eq(0);
    expect(request.minOut).eq(0);
    expect(request.sizeDelta).eq(0);
    expect(request.isLong).eq(false);
    expect(request.acceptablePrice).eq(0);
    expect(request.executionFee).eq(0);
    expect(request.blockNumber).eq(0);
    expect(request.blockTime).eq(0);
    expect(request.hasCollateralInETH).eq(false);

    let queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(0); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    expect(await ship.provider.getBalance(positionRouter.address)).eq(0);
    expect(await avax.balanceOf(positionRouter.address)).eq(0);
    expect(await usdc.balanceOf(positionRouter.address)).eq(0);

    const tx = await positionRouter
      .connect(user0)
      .createIncreasePositionETH(...params, 4000, referralCode, constants.AddressZero, {
        value: toWei(1, 18).add(4000),
      });
    await reportGasUsed(tx, "createIncreasePositionETH gas used");

    expect(await ship.provider.getBalance(positionRouter.address)).eq(0);
    expect(await avax.balanceOf(positionRouter.address)).eq(toWei(1, 18).add(4000));
    expect(await usdc.balanceOf(positionRouter.address)).eq(0);

    const blockNumber = await ship.provider.getBlockNumber();
    const blockTime = await getTime();

    request = await positionRouter.increasePositionRequests(key);

    expect(await referralStorage.traderReferralCodes(user0.address)).eq(referralCode);
    expect(await avax.balanceOf(positionRouter.address)).eq(toWei(1, 18).add(4000));
    expect(await positionRouter.increasePositionsIndex(user0.address)).eq(1);

    expect(request.account).eq(user0.address);
    expect(request.indexToken).eq(avax.address);
    expect(request.amountIn).eq(toWei(1, 18));
    expect(request.minOut).eq(toWei(290, 6));
    expect(request.sizeDelta).eq(toUsd(6000));
    expect(request.isLong).eq(false);
    expect(request.acceptablePrice).eq(toUsd(300));
    expect(request.executionFee).eq(4000);
    expect(request.blockNumber).eq(blockNumber);
    expect(request.blockTime).eq(blockTime);
    expect(request.hasCollateralInETH).eq(true);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(1); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    await positionRouter.setDelayValues(5, 300, 500);

    const executionFeeReceiver = Wallet.createRandom();
    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("403");

    await positionRouter.setPositionKeeper(positionKeeper.address, true);

    // executeIncreasePosition will return without error and without executing the position if the minBlockDelayKeeper has not yet passed
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address);

    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(user0.address);

    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("Vault: poolAmount exceeded");

    await usdc.mint(vault.address, toWei(7000, 6));
    await vault.buyUSDG(usdc.address, user1.address);

    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("Timelock: forbidden");

    await timelock.setContractHandler(positionRouter.address, true);

    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("Router: invalid plugin");

    await router.addPlugin(positionRouter.address);

    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("Router: plugin not approved");

    await router.connect(user0).approvePlugin(positionRouter.address);

    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("Vault: leverage not enabled");

    await timelock.setShouldToggleIsLeverageEnabled(true);

    let position = await vault.getPosition(user0.address, avax.address, avax.address, true);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit
    expect(position[7]).eq(0); // lastIncreasedTime

    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(0);

    const tx1 = await positionRouter
      .connect(positionKeeper)
      .executeIncreasePosition(key, executionFeeReceiver.address);
    await reportGasUsed(tx1, "executeIncreasePosition gas used");

    expect(await ship.provider.getBalance(positionRouter.address)).eq(0);
    expect(await avax.balanceOf(positionRouter.address)).eq(0);
    expect(await usdc.balanceOf(positionRouter.address)).eq(0);

    request = await positionRouter.increasePositionRequests(key);

    expect(request.account).eq(constants.AddressZero);
    expect(request.indexToken).eq(constants.AddressZero);
    expect(request.amountIn).eq(0);
    expect(request.minOut).eq(0);
    expect(request.sizeDelta).eq(0);
    expect(request.isLong).eq(false);
    expect(request.acceptablePrice).eq(0);
    expect(request.executionFee).eq(0);
    expect(request.blockNumber).eq(0);
    expect(request.blockTime).eq(0);
    expect(request.hasCollateralInETH).eq(false);

    position = await vault.getPosition(user0.address, usdc.address, avax.address, false);
    expect(position[0]).eq(toUsd(6000)); // size
    expect(position[1]).eq("293100000000000000000000000000000"); // collateral, 293.1
    expect(position[2]).eq(toUsd(300)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(toWei(6000, 6)); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit

    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(4000);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(1); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    await router.connect(user1).approvePlugin(positionRouter.address);
    await positionRouter
      .connect(user1)
      .createIncreasePositionETH(...params, 4000, referralCode, constants.AddressZero, {
        value: toWei(1, 18).add(4000),
      });

    expect(await ship.provider.getBalance(positionRouter.address)).eq(0);
    expect(await avax.balanceOf(positionRouter.address)).eq(toWei(1, 18).add(4000));
    expect(await usdc.balanceOf(positionRouter.address)).eq(0);
    expect(await usdc.balanceOf(user1.address)).eq(0);

    key = await positionRouter.getRequestKey(user1.address, 1);
    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(user1.address);

    await advanceBlock();
    await advanceBlock();
    await advanceBlock();

    await positionRouter.connect(positionKeeper).cancelIncreasePosition(key, executionFeeReceiver.address);
    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(user1.address);

    const balanceBefore = await ship.provider.getBalance(user1.address);
    const tx2 = await positionRouter
      .connect(positionKeeper)
      .cancelIncreasePosition(key, executionFeeReceiver.address);
    await reportGasUsed(tx2, "cancelIncreasePosition gas used");

    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(constants.AddressZero);

    expect(await ship.provider.getBalance(positionRouter.address)).eq(0);
    expect((await ship.provider.getBalance(user1.address)).sub(balanceBefore)).eq(toWei(1, 18));
    expect(await avax.balanceOf(positionRouter.address)).eq(0);
    expect(await usdc.balanceOf(positionRouter.address)).eq(0);
    expect(await usdc.balanceOf(user1.address)).eq(0);

    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(8000);

    await router.connect(user2).approvePlugin(positionRouter.address);

    params[0] = [avax.address]; // _path
    params[4] = true; // _isLong

    const tx3 = await positionRouter
      .connect(user2)
      .createIncreasePositionETH(...params, 4000, referralCode, constants.AddressZero, {
        value: toWei(1, 18).add(4000),
      });
    await reportGasUsed(tx3, "createIncreasePosition gas used");

    key = await positionRouter.getRequestKey(user2.address, 1);

    await avax.mint(vault.address, toWei(25, 18));
    await vault.buyUSDG(avax.address, user1.address);

    await advanceBlock();
    await advanceBlock();

    const tx4 = await positionRouter
      .connect(positionKeeper)
      .executeIncreasePosition(key, executionFeeReceiver.address);
    await reportGasUsed(tx4, "executeIncreasePosition gas used");

    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(constants.AddressZero);

    position = await vault.getPosition(user2.address, avax.address, avax.address, true);
    expect(position[0]).eq(toUsd(6000)); // size
    expect(position[1]).eq("294000000000000000000000000000000"); // collateral, 294
    expect(position[2]).eq(toUsd(300)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(toWei(20, 18)); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(3); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length
  });

  it("createIncreasePosition, createDecreasePosition, executeDecreasePosition, cancelDecreasePosition", async () => {
    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123";

    const params: [string[], string, BigNumberish, BigNumberish, BigNumberish, boolean, BigNumberish] = [
      [usdc.address, avax.address], // _path
      avax.address, // _indexToken
      toWei(600, 6), // _amountIn
      toWei(1, 18), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(300), // _acceptablePrice
    ];

    await router.addPlugin(positionRouter.address);
    await router.connect(user0).approvePlugin(positionRouter.address);

    await usdc.mint(user0.address, toWei(600, 6));
    await usdc.connect(user0).approve(router.address, toWei(600, 6));

    let key = await positionRouter.getRequestKey(user0.address, 1);
    let request = await positionRouter.increasePositionRequests(key);

    expect(await referralStorage.traderReferralCodes(user0.address)).eq(constants.HashZero);
    expect(await usdc.balanceOf(positionRouter.address)).eq(0);
    expect(await positionRouter.increasePositionsIndex(user0.address)).eq(0);

    expect(request.account).eq(constants.AddressZero);
    expect(request.indexToken).eq(constants.AddressZero);
    expect(request.amountIn).eq(0);
    expect(request.minOut).eq(0);
    expect(request.sizeDelta).eq(0);
    expect(request.isLong).eq(false);
    expect(request.acceptablePrice).eq(0);
    expect(request.executionFee).eq(0);
    expect(request.blockNumber).eq(0);
    expect(request.blockTime).eq(0);
    expect(request.hasCollateralInETH).eq(false);

    let queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(0); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    expect(await ship.provider.getBalance(positionRouter.address)).eq(0);
    expect(await avax.balanceOf(positionRouter.address)).eq(0);
    expect(await usdc.balanceOf(positionRouter.address)).eq(0);

    const tx0 = await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });
    await reportGasUsed(tx0, "createIncreasePosition gas used");

    expect(await ship.provider.getBalance(positionRouter.address)).eq(0);
    expect(await avax.balanceOf(positionRouter.address)).eq(4000);
    expect(await usdc.balanceOf(positionRouter.address)).eq(toWei(600, 6));

    let blockNumber = await ship.provider.getBlockNumber();
    let blockTime = await getTime();

    request = await positionRouter.increasePositionRequests(key);

    expect(await referralStorage.traderReferralCodes(user0.address)).eq(referralCode);
    expect(await usdc.balanceOf(positionRouter.address)).eq(toWei(600, 6));
    expect(await positionRouter.increasePositionsIndex(user0.address)).eq(1);

    expect(request.account).eq(user0.address);
    expect(request.indexToken).eq(avax.address);
    expect(request.amountIn).eq(toWei(600, 6));
    expect(request.minOut).eq(toWei(1, 18));
    expect(request.sizeDelta).eq(toUsd(6000));
    expect(request.isLong).eq(true);
    expect(request.acceptablePrice).eq(toUsd(300));
    expect(request.executionFee).eq(4000);
    expect(request.blockNumber).eq(blockNumber);
    expect(request.blockTime).eq(blockTime);
    expect(request.hasCollateralInETH).eq(false);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(1); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    await positionRouter.setDelayValues(5, 300, 500);

    const executionFeeReceiver = Wallet.createRandom();
    await positionRouter.setPositionKeeper(positionKeeper.address, true);

    // executeIncreasePosition will return without error and without executing the position if the minBlockDelayKeeper has not yet passed
    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address);

    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(user0.address);

    await avax.mint(vault.address, toWei(30, 18));
    await vault.buyUSDG(avax.address, user1.address);

    await timelock.setContractHandler(positionRouter.address, true);

    await timelock.setShouldToggleIsLeverageEnabled(true);

    let position = await vault.getPosition(user0.address, avax.address, avax.address, true);
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit
    expect(position[7]).eq(0); // lastIncreasedTime

    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(0);

    const tx1 = await positionRouter
      .connect(positionKeeper)
      .executeIncreasePosition(key, executionFeeReceiver.address);
    await reportGasUsed(tx1, "executeIncreasePosition gas used");

    expect(await ship.provider.getBalance(positionRouter.address)).eq(0);
    expect(await avax.balanceOf(positionRouter.address)).eq(0);
    expect(await usdc.balanceOf(positionRouter.address)).eq(0);

    const increaseRequest = await positionRouter.increasePositionRequests(key);

    expect(increaseRequest.account).eq(constants.AddressZero);
    expect(increaseRequest.indexToken).eq(constants.AddressZero);
    expect(increaseRequest.amountIn).eq(0);
    expect(increaseRequest.minOut).eq(0);
    expect(increaseRequest.sizeDelta).eq(0);
    expect(increaseRequest.isLong).eq(false);
    expect(increaseRequest.acceptablePrice).eq(0);
    expect(increaseRequest.executionFee).eq(0);
    expect(increaseRequest.blockNumber).eq(0);
    expect(increaseRequest.blockTime).eq(0);
    expect(increaseRequest.hasCollateralInETH).eq(false);

    position = await vault.getPosition(user0.address, avax.address, avax.address, true);
    expect(position[0]).eq(toUsd(6000)); // size
    expect(position[1]).eq("592200000000000000000000000000000"); // collateral, 592.2
    expect(position[2]).eq(toUsd(300)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(toWei(20, 18)); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit

    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(4000);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(1); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    let decreasePositionParams: [
      string[],
      string,
      BigNumberish,
      BigNumberish,
      boolean,
      string,
      BigNumberish,
      BigNumberish,
    ] = [
      [avax.address, usdc.address], // _collateralToken
      avax.address, // _indexToken
      toUsd(300), // _collateralDelta
      toUsd(1000), // _sizeDelta
      true, // _isLong
      user1.address, // _receiver
      toUsd(290), // _acceptablePrice
      0, // _minOut
    ];

    await expect(
      positionRouter
        .connect(user0)
        .createDecreasePosition(...decreasePositionParams, 3000, false, constants.AddressZero),
    ).to.be.revertedWith("fee");

    await expect(
      positionRouter
        .connect(user0)
        .createDecreasePosition(...decreasePositionParams, 4000, false, constants.AddressZero),
    ).to.be.revertedWith("val");

    await expect(
      positionRouter
        .connect(user0)
        .createDecreasePosition(...decreasePositionParams, 4000, false, constants.AddressZero, {
          value: 3000,
        }),
    ).to.be.revertedWith("val");

    await expect(
      positionRouter
        .connect(user0)
        .createDecreasePosition(...decreasePositionParams, 4000, false, constants.AddressZero, {
          value: 3000,
        }),
    ).to.be.revertedWith("val");

    await expect(
      positionRouter
        .connect(user0)
        .createDecreasePosition(...decreasePositionParams, 4000, true, constants.AddressZero, {
          value: 4000,
        }),
    ).to.be.revertedWith("path");

    decreasePositionParams[0] = [];

    await expect(
      positionRouter
        .connect(user0)
        .createDecreasePosition(...decreasePositionParams, 4000, true, constants.AddressZero, {
          value: 4000,
        }),
    ).to.be.revertedWith("len");

    decreasePositionParams[0] = [avax.address, usdc.address, avax.address];

    await expect(
      positionRouter
        .connect(user0)
        .createDecreasePosition(...decreasePositionParams, 4000, true, constants.AddressZero, {
          value: 4000,
        }),
    ).to.be.revertedWith("len");

    decreasePositionParams[0] = [avax.address];

    const tx2 = await positionRouter
      .connect(user0)
      .createDecreasePosition(...decreasePositionParams, 4000, false, constants.AddressZero, {
        value: 4000,
      });
    await reportGasUsed(tx2, "createDecreasePosition gas used");

    blockNumber = await ship.provider.getBlockNumber();
    blockTime = await getTime();

    key = await positionRouter.getRequestKey(user0.address, 1);
    let decreaseRequest = await positionRouter.decreasePositionRequests(key);
    const decreaseRequestPath = await positionRouter.getDecreasePositionRequestPath(key);

    expect(decreaseRequest.account).eq(user0.address);
    expect(decreaseRequestPath.length).eq(1);
    expect(decreaseRequestPath[0]).eq(avax.address);
    expect(decreaseRequest.indexToken).eq(avax.address);
    expect(decreaseRequest.collateralDelta).eq(toUsd(300));
    expect(decreaseRequest.sizeDelta).eq(toUsd(1000));
    expect(decreaseRequest.isLong).eq(true);
    expect(decreaseRequest.receiver).eq(user1.address);
    expect(decreaseRequest.acceptablePrice).eq(toUsd(290));
    expect(decreaseRequest.blockNumber).eq(blockNumber);
    expect(decreaseRequest.blockTime).eq(blockTime);
    expect(decreaseRequest.withdrawETH).eq(false);

    await positionRouter.setPositionKeeper(positionKeeper.address, false);

    await expect(
      positionRouter.connect(positionKeeper).executeDecreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("403");

    await positionRouter.setPositionKeeper(positionKeeper.address, true);

    await positionRouter.connect(positionKeeper).executeDecreasePosition(key, executionFeeReceiver.address);

    decreaseRequest = await positionRouter.decreasePositionRequests(key);
    expect(decreaseRequest.account).eq(user0.address);

    expect(await avax.balanceOf(user1.address)).eq(0);

    const tx3 = await positionRouter
      .connect(positionKeeper)
      .executeDecreasePosition(key, executionFeeReceiver.address);
    await reportGasUsed(tx3, "executeDecreasePosition gas used");

    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(8000);

    decreaseRequest = await positionRouter.decreasePositionRequests(key);
    expect(decreaseRequest.account).eq(constants.AddressZero);
    expect(decreaseRequest.indexToken).eq(constants.AddressZero);

    position = await vault.getPosition(user0.address, avax.address, avax.address, true);

    expect(position[0]).eq(toUsd(5000)); // size
    expect(position[1]).eq("292200000000000000000000000000000"); // collateral, 592.2
    expect(position[2]).eq(toUsd(300)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq("16666666666666666667"); // reserveAmount, 16.666666666666666667
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit

    expect(await avax.balanceOf(user1.address)).eq("996666666666666666"); // 0.996666666666666666

    const collateralReceiver = Wallet.createRandom();
    decreasePositionParams[2] = toUsd(150);
    decreasePositionParams[5] = collateralReceiver.address;

    await positionRouter
      .connect(user0)
      .createDecreasePosition(...decreasePositionParams, 4000, true, constants.AddressZero, {
        value: 4000,
      });

    key = await positionRouter.getRequestKey(user0.address, 2);
    decreaseRequest = await positionRouter.decreasePositionRequests(key);

    expect(decreaseRequest.account).eq(user0.address);
    expect(decreaseRequest.indexToken).eq(avax.address);
    expect(decreaseRequest.collateralDelta).eq(toUsd(150));
    expect(decreaseRequest.sizeDelta).eq(toUsd(1000));
    expect(decreaseRequest.isLong).eq(true);
    expect(decreaseRequest.receiver).eq(collateralReceiver.address);
    expect(decreaseRequest.acceptablePrice).eq(toUsd(290));
    expect(decreaseRequest.withdrawETH).eq(true);

    await advanceBlock();
    await advanceBlock();
    await advanceBlock();
    await advanceBlock();

    expect(await ship.provider.getBalance(collateralReceiver.address)).eq(0);

    await positionRouter.connect(positionKeeper).executeDecreasePosition(key, executionFeeReceiver.address);
    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(12000);

    decreaseRequest = await positionRouter.decreasePositionRequests(key);
    expect(decreaseRequest.account).eq(constants.AddressZero);

    expect(await ship.provider.getBalance(collateralReceiver.address)).eq("496666666666666666"); // 0.496666666666666666

    await positionRouter
      .connect(user0)
      .createDecreasePosition(...decreasePositionParams, 4000, true, constants.AddressZero, {
        value: 4000,
      });

    key = await positionRouter.getRequestKey(user0.address, 3);

    decreaseRequest = await positionRouter.decreasePositionRequests(key);
    expect(decreaseRequest.account).eq(user0.address);

    await positionRouter.connect(positionKeeper).cancelDecreasePosition(key, executionFeeReceiver.address);

    decreaseRequest = await positionRouter.decreasePositionRequests(key);
    expect(decreaseRequest.account).eq(user0.address);

    await advanceBlock();
    await advanceBlock();
    await advanceBlock();

    await positionRouter.connect(positionKeeper).cancelDecreasePosition(key, executionFeeReceiver.address);

    decreaseRequest = await positionRouter.decreasePositionRequests(key);
    expect(decreaseRequest.account).eq(constants.AddressZero);

    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(16000);

    await positionRouter.connect(positionKeeper).cancelDecreasePosition(key, executionFeeReceiver.address);
    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(16000);

    decreasePositionParams = [
      [avax.address, usdc.address], // _collateralToken
      avax.address, // _indexToken
      toUsd(50), // _collateralDelta
      toUsd(500), // _sizeDelta
      true, // _isLong
      user1.address, // _receiver
      toUsd(290), // _acceptablePrice
      toWei(100, 6), // _minOut
    ];

    await positionRouter
      .connect(user0)
      .createDecreasePosition(...decreasePositionParams, 4000, false, constants.AddressZero, {
        value: 4000,
      });
    key = await positionRouter.getRequestKey(user0.address, 4);

    expect(await usdc.balanceOf(user1.address)).eq(0);

    await advanceBlock();
    await advanceBlock();
    await advanceBlock();
    await advanceBlock();

    await expect(
      positionRouter.connect(positionKeeper).executeDecreasePosition(key, executionFeeReceiver.address),
    ).to.be.revertedWith("BasePositionManager: insufficient amountOut");

    decreasePositionParams[7] = toWei(40, 6);

    await positionRouter
      .connect(user0)
      .createDecreasePosition(...decreasePositionParams, 4000, false, constants.AddressZero, {
        value: 4000,
      });
    key = await positionRouter.getRequestKey(user0.address, 5);

    await advanceBlock();
    await advanceBlock();
    await advanceBlock();
    await advanceBlock();

    const tx4 = await positionRouter
      .connect(positionKeeper)
      .executeDecreasePosition(key, executionFeeReceiver.address);
    await reportGasUsed(tx4, "executeDecreasePosition gas used");

    expect(await usdc.balanceOf(user1.address)).eq("49351500"); // 49.3515

    const increasePositionParams: [
      string[],
      string,
      BigNumberish,
      BigNumberish,
      BigNumberish,
      boolean,
      BigNumberish,
    ] = [
      [avax.address, usdc.address], // _path
      avax.address, // _indexToken
      toWei(2, 18), // _amountIn
      toWei(1, 6), // _minOut
      toUsd(6000), // _sizeDelta
      false, // _isLong
      toUsd(300), // _acceptablePrice
    ];

    await avax.mint(user0.address, toWei(2, 18));
    await avax.connect(user0).approve(router.address, toWei(2, 18));
    await usdc.mint(vault.address, toWei(10000, 6));
    await vault.buyUSDG(usdc.address, user1.address);

    await positionRouter
      .connect(user0)
      .createIncreasePosition(...increasePositionParams, 4000, referralCode, constants.AddressZero, {
        value: 4000,
      });
    key = await positionRouter.getRequestKey(user0.address, 2);

    await advanceBlock();
    await advanceBlock();
    await advanceBlock();
    await advanceBlock();

    await positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address);

    position = await vault.getPosition(user0.address, usdc.address, avax.address, false);
    expect(position[0]).eq(toUsd(6000)); // size
    expect(position[1]).eq("592200000000000000000000000000000"); // collateral, 592.2
    expect(position[2]).eq(toUsd(300)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(toWei(6000, 6)); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit

    const collateralReceiver1 = Wallet.createRandom();

    decreasePositionParams = [
      [usdc.address, avax.address], // _collateralToken
      avax.address, // _indexToken
      toUsd(150), // _collateralDelta
      toUsd(500), // _sizeDelta
      false, // _isLong
      collateralReceiver1.address, // _receiver
      toUsd(310), // _acceptablePrice
      "400000000000000000", // _minOut
    ];

    await positionRouter
      .connect(user0)
      .createDecreasePosition(...decreasePositionParams, 4000, true, constants.AddressZero, {
        value: 4000,
      });
    key = await positionRouter.getRequestKey(user0.address, 6);

    await advanceBlock();
    await advanceBlock();
    await advanceBlock();
    await advanceBlock();
    await advanceBlock();

    expect(await ship.provider.getBalance(collateralReceiver1.address)).eq(0);
    await positionRouter.connect(positionKeeper).executeDecreasePosition(key, executionFeeReceiver.address);
    expect(await ship.provider.getBalance(collateralReceiver1.address)).eq("496838001000000000"); // 0.496838001000000000
  });

  it("executeIncreasePositions, executeDecreasePositions", async () => {
    await positionRouter.setDelayValues(5, 300, 500);
    const executionFeeReceiver = Wallet.createRandom();

    await avax.mint(vault.address, toWei(500, 18));
    await vault.buyUSDG(avax.address, user1.address);

    await router.addPlugin(positionRouter.address);
    await router.connect(user0).approvePlugin(positionRouter.address);
    await router.connect(user1).approvePlugin(positionRouter.address);
    await router.connect(user2).approvePlugin(positionRouter.address);

    await timelock.setContractHandler(positionRouter.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);

    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePositions(100, executionFeeReceiver.address),
    ).to.be.revertedWith("403");

    await expect(
      positionRouter.connect(positionKeeper).executeDecreasePositions(100, executionFeeReceiver.address),
    ).to.be.revertedWith("403");

    await positionRouter.setPositionKeeper(positionKeeper.address, true);

    let queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(0); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    await positionRouter.connect(positionKeeper).executeIncreasePositions(100, executionFeeReceiver.address);
    await positionRouter.connect(positionKeeper).executeDecreasePositions(100, executionFeeReceiver.address);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(0); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123";

    const params: [string[], string, BigNumberish, BigNumberish, BigNumberish, boolean, BigNumberish] = [
      [usdc.address, avax.address], // _path
      avax.address, // _indexToken
      toWei(600, 6), // _amountIn
      toWei(1, 6), // _minOut
      toUsd(6000), // _sizeDelta
      true, // _isLong
      toUsd(300), // _acceptablePrice
    ];

    await router.addPlugin(positionRouter.address);

    await router.connect(user0).approvePlugin(positionRouter.address);
    await usdc.mint(user0.address, toWei(600, 6));
    await usdc.connect(user0).approve(router.address, toWei(600, 6));
    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });

    const key0 = await positionRouter.getRequestKey(user0.address, 1);
    const request0 = await positionRouter.increasePositionRequests(key0);
    expect(request0.account).eq(user0.address);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(1); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    await router.connect(user1).approvePlugin(positionRouter.address);
    await usdc.mint(user1.address, toWei(600, 6));
    await usdc.connect(user1).approve(router.address, toWei(600, 6));
    await positionRouter
      .connect(user1)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });

    const key1 = await positionRouter.getRequestKey(user1.address, 1);
    const request1 = await positionRouter.increasePositionRequests(key1);
    expect(request1.account).eq(user1.address);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(2); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    await router.connect(user2).approvePlugin(positionRouter.address);
    await usdc.mint(user2.address, toWei(600, 6));
    await usdc.connect(user2).approve(router.address, toWei(600, 6));
    await positionRouter
      .connect(user2)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });

    const key2 = await positionRouter.getRequestKey(user2.address, 1);
    const request2 = await positionRouter.increasePositionRequests(key2);
    expect(request2.account).eq(user2.address);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(3); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    params[4] = toUsd(500000); // _sizeDelta

    await router.connect(user3).approvePlugin(positionRouter.address);
    await usdc.mint(user3.address, toWei(600, 6));
    await usdc.connect(user3).approve(router.address, toWei(600, 6));
    await positionRouter
      .connect(user3)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });

    const key3 = await positionRouter.getRequestKey(user3.address, 1);
    const request3 = await positionRouter.increasePositionRequests(key3);
    expect(request3.account).eq(user3.address);

    params[4] = toUsd(6000); // _sizeDelta

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(4); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    await router.connect(user4).approvePlugin(positionRouter.address);
    await usdc.mint(user4.address, toWei(600, 6));
    await usdc.connect(user4).approve(router.address, toWei(600, 6));
    await positionRouter
      .connect(user4)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });

    const key4 = await positionRouter.getRequestKey(user4.address, 1);
    const request4 = await positionRouter.increasePositionRequests(key4);
    expect(request4.account).eq(user4.address);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(5); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    await positionRouter.connect(positionKeeper).executeIncreasePosition(key2, executionFeeReceiver.address);
    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(4000);

    expect((await positionRouter.increasePositionRequests(key2)).account).eq(constants.AddressZero);

    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePosition(key3, executionFeeReceiver.address),
    ).to.be.revertedWith("Vault: fees exceed collateral");

    // queue: request0, request1, request2 (executed), request3 (not executable), request4

    await positionRouter.connect(positionKeeper).executeIncreasePositions(0, executionFeeReceiver.address);
    expect((await positionRouter.increasePositionRequests(key0)).account).eq(user0.address);
    expect((await positionRouter.increasePositionRequests(key1)).account).eq(user1.address);
    expect((await positionRouter.increasePositionRequests(key2)).account).eq(constants.AddressZero);
    expect((await positionRouter.increasePositionRequests(key3)).account).eq(user3.address);
    expect((await positionRouter.increasePositionRequests(key4)).account).eq(user4.address);

    expect(await positionRouter.increasePositionRequestKeys(0)).eq(key0);
    expect(await positionRouter.increasePositionRequestKeys(1)).eq(key1);
    expect(await positionRouter.increasePositionRequestKeys(2)).eq(key2);
    expect(await positionRouter.increasePositionRequestKeys(3)).eq(key3);
    expect(await positionRouter.increasePositionRequestKeys(4)).eq(key4);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(5); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    await positionRouter.connect(positionKeeper).executeIncreasePositions(1, executionFeeReceiver.address);
    expect((await positionRouter.increasePositionRequests(key0)).account).eq(constants.AddressZero);
    expect((await positionRouter.increasePositionRequests(key1)).account).eq(user1.address);
    expect((await positionRouter.increasePositionRequests(key2)).account).eq(constants.AddressZero);
    expect((await positionRouter.increasePositionRequests(key3)).account).eq(user3.address);
    expect((await positionRouter.increasePositionRequests(key4)).account).eq(user4.address);

    expect(await positionRouter.increasePositionRequestKeys(0)).eq(constants.HashZero);
    expect(await positionRouter.increasePositionRequestKeys(1)).eq(key1);
    expect(await positionRouter.increasePositionRequestKeys(2)).eq(key2);
    expect(await positionRouter.increasePositionRequestKeys(3)).eq(key3);
    expect(await positionRouter.increasePositionRequestKeys(4)).eq(key4);

    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(8000);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(1); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(5); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    await positionRouter.connect(positionKeeper).executeIncreasePositions(0, executionFeeReceiver.address);

    expect((await positionRouter.increasePositionRequests(key0)).account).eq(constants.AddressZero);
    expect((await positionRouter.increasePositionRequests(key1)).account).eq(user1.address);
    expect((await positionRouter.increasePositionRequests(key2)).account).eq(constants.AddressZero);
    expect((await positionRouter.increasePositionRequests(key3)).account).eq(user3.address);
    expect((await positionRouter.increasePositionRequests(key4)).account).eq(user4.address);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(1); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(5); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(8000);

    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user1.address)).eq(0);
    expect(await usdc.balanceOf(user2.address)).eq(0);
    expect(await usdc.balanceOf(user3.address)).eq(0);
    expect(await usdc.balanceOf(user4.address)).eq(0);

    await positionRouter.connect(positionKeeper).executeIncreasePositions(10, executionFeeReceiver.address);

    expect((await positionRouter.increasePositionRequests(key0)).account).eq(constants.AddressZero);
    expect((await positionRouter.increasePositionRequests(key1)).account).eq(constants.AddressZero);
    expect((await positionRouter.increasePositionRequests(key2)).account).eq(constants.AddressZero);
    expect((await positionRouter.increasePositionRequests(key3)).account).eq(constants.AddressZero);
    expect((await positionRouter.increasePositionRequests(key4)).account).eq(constants.AddressZero);

    expect(await positionRouter.increasePositionRequestKeys(0)).eq(constants.HashZero);
    expect(await positionRouter.increasePositionRequestKeys(1)).eq(constants.HashZero);
    expect(await positionRouter.increasePositionRequestKeys(2)).eq(constants.HashZero);
    expect(await positionRouter.increasePositionRequestKeys(3)).eq(constants.HashZero);
    expect(await positionRouter.increasePositionRequestKeys(4)).eq(constants.HashZero);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(5); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(5); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    expect(await ship.provider.getBalance(executionFeeReceiver.address)).eq(20000);

    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user1.address)).eq(0);
    expect(await usdc.balanceOf(user2.address)).eq(0);
    expect(await usdc.balanceOf(user3.address)).eq(toWei(600, 6)); // refunded
    expect(await usdc.balanceOf(user4.address)).eq(0);

    await usdc.mint(user0.address, toWei(600, 6));
    await usdc.connect(user0).approve(router.address, toWei(600, 6));
    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });

    await usdc.mint(user0.address, toWei(600, 6));
    await usdc.connect(user0).approve(router.address, toWei(600, 6));
    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(5); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    await positionRouter.connect(positionKeeper).executeIncreasePositions(10, executionFeeReceiver.address);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(5); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    await advanceBlock();

    await positionRouter.connect(positionKeeper).executeIncreasePositions(6, executionFeeReceiver.address);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(6); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    await advanceBlock();
    await advanceBlock();
    await advanceBlock();
    await advanceBlock();
    await advanceBlock();

    await positionRouter.connect(positionKeeper).executeIncreasePositions(6, executionFeeReceiver.address);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(6); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    await positionRouter.connect(positionKeeper).executeIncreasePositions(10, executionFeeReceiver.address);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(7); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    const decreasePositionParams: [string[], string, BigNumberish, BigNumberish, boolean] = [
      [avax.address], // _path
      avax.address, // _indexToken
      toUsd(300), // _collateralDelta
      toUsd(1000), // _sizeDelta
      true, // _isLong
    ];

    await positionRouter
      .connect(user0)
      .createDecreasePosition(
        ...decreasePositionParams,
        user0.address,
        0,
        toUsd(290),
        4000,
        false,
        constants.AddressZero,
        { value: 4000 },
      );
    const decreaseKey0 = await positionRouter.getRequestKey(user0.address, 1);
    expect((await positionRouter.decreasePositionRequests(decreaseKey0)).account).eq(user0.address);

    await positionRouter
      .connect(user1)
      .createDecreasePosition(
        ...decreasePositionParams,
        user1.address,
        0,
        toUsd(290),
        4000,
        false,
        constants.AddressZero,
        { value: 4000 },
      );
    const decreaseKey1 = await positionRouter.getRequestKey(user1.address, 1);
    expect((await positionRouter.decreasePositionRequests(decreaseKey1)).account).eq(user1.address);

    await positionRouter
      .connect(user2)
      .createDecreasePosition(
        ...decreasePositionParams,
        user2.address,
        0,
        toUsd(290),
        4000,
        false,
        constants.AddressZero,
        { value: 4000 },
      );
    const decreaseKey2 = await positionRouter.getRequestKey(user2.address, 1);
    expect((await positionRouter.decreasePositionRequests(decreaseKey2)).account).eq(user2.address);

    await positionRouter
      .connect(user3)
      .createDecreasePosition(
        ...decreasePositionParams,
        user3.address,
        0,
        toUsd(290),
        4000,
        false,
        constants.AddressZero,
        { value: 4000 },
      );
    const decreaseKey3 = await positionRouter.getRequestKey(user3.address, 1);
    expect((await positionRouter.decreasePositionRequests(decreaseKey3)).account).eq(user3.address);

    await positionRouter
      .connect(user4)
      .createDecreasePosition(
        ...decreasePositionParams,
        user4.address,
        0,
        toUsd(290),
        4000,
        false,
        constants.AddressZero,
        { value: 4000 },
      );
    const decreaseKey4 = await positionRouter.getRequestKey(user4.address, 1);
    expect((await positionRouter.decreasePositionRequests(decreaseKey4)).account).eq(user4.address);

    expect(await avax.balanceOf(user0.address)).eq(0);
    expect(await avax.balanceOf(user1.address)).eq(0);
    expect(await avax.balanceOf(user2.address)).eq(0);
    expect(await avax.balanceOf(user3.address)).eq(0);
    expect(await avax.balanceOf(user4.address)).eq(0);

    await advanceBlock();
    await advanceBlock();
    await advanceBlock();

    await expect(
      positionRouter
        .connect(positionKeeper)
        .executeDecreasePosition(decreaseKey3, executionFeeReceiver.address),
    ).to.be.revertedWith("Vault: empty position");

    await positionRouter
      .connect(positionKeeper)
      .executeDecreasePosition(decreaseKey2, executionFeeReceiver.address);
    expect((await positionRouter.decreasePositionRequests(decreaseKey2)).account).eq(constants.AddressZero);

    expect(await avax.balanceOf(user0.address)).eq(0);
    expect(await avax.balanceOf(user1.address)).eq(0);
    expect(await avax.balanceOf(user2.address)).eq("996666666666666666");
    expect(await avax.balanceOf(user3.address)).eq(0);
    expect(await avax.balanceOf(user4.address)).eq(0);

    // queue: request0, request1, request2 (executed), request3 (not executable), request4

    await positionRouter.connect(positionKeeper).executeDecreasePositions(0, executionFeeReceiver.address);
    expect((await positionRouter.decreasePositionRequests(decreaseKey0)).account).eq(user0.address);
    expect((await positionRouter.decreasePositionRequests(decreaseKey1)).account).eq(user1.address);
    expect((await positionRouter.decreasePositionRequests(decreaseKey2)).account).eq(constants.AddressZero);
    expect((await positionRouter.decreasePositionRequests(decreaseKey3)).account).eq(user3.address);
    expect((await positionRouter.decreasePositionRequests(decreaseKey4)).account).eq(user4.address);

    expect(await positionRouter.decreasePositionRequestKeys(0)).eq(decreaseKey0);
    expect(await positionRouter.decreasePositionRequestKeys(1)).eq(decreaseKey1);
    expect(await positionRouter.decreasePositionRequestKeys(2)).eq(decreaseKey2);
    expect(await positionRouter.decreasePositionRequestKeys(3)).eq(decreaseKey3);
    expect(await positionRouter.decreasePositionRequestKeys(4)).eq(decreaseKey4);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(7); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(5); // decreasePositionRequestKeys.length

    await positionRouter.connect(positionKeeper).executeDecreasePositions(1, executionFeeReceiver.address);
    expect((await positionRouter.decreasePositionRequests(decreaseKey0)).account).eq(constants.AddressZero);
    expect((await positionRouter.decreasePositionRequests(decreaseKey1)).account).eq(user1.address);
    expect((await positionRouter.decreasePositionRequests(decreaseKey2)).account).eq(constants.AddressZero);
    expect((await positionRouter.decreasePositionRequests(decreaseKey3)).account).eq(user3.address);
    expect((await positionRouter.decreasePositionRequests(decreaseKey4)).account).eq(user4.address);

    expect(await positionRouter.decreasePositionRequestKeys(0)).eq(constants.HashZero);
    expect(await positionRouter.decreasePositionRequestKeys(1)).eq(decreaseKey1);
    expect(await positionRouter.decreasePositionRequestKeys(2)).eq(decreaseKey2);
    expect(await positionRouter.decreasePositionRequestKeys(3)).eq(decreaseKey3);
    expect(await positionRouter.decreasePositionRequestKeys(4)).eq(decreaseKey4);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(7); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(1); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(5); // decreasePositionRequestKeys.length

    await positionRouter.connect(positionKeeper).executeDecreasePositions(10, executionFeeReceiver.address);
    expect((await positionRouter.decreasePositionRequests(decreaseKey0)).account).eq(constants.AddressZero);
    expect((await positionRouter.decreasePositionRequests(decreaseKey1)).account).eq(constants.AddressZero);
    expect((await positionRouter.decreasePositionRequests(decreaseKey2)).account).eq(constants.AddressZero);
    expect((await positionRouter.decreasePositionRequests(decreaseKey3)).account).eq(constants.AddressZero);
    expect((await positionRouter.decreasePositionRequests(decreaseKey4)).account).eq(constants.AddressZero);

    expect(await positionRouter.decreasePositionRequestKeys(0)).eq(constants.HashZero);
    expect(await positionRouter.decreasePositionRequestKeys(1)).eq(constants.HashZero);
    expect(await positionRouter.decreasePositionRequestKeys(2)).eq(constants.HashZero);
    expect(await positionRouter.decreasePositionRequestKeys(3)).eq(constants.HashZero);
    expect(await positionRouter.decreasePositionRequestKeys(4)).eq(constants.HashZero);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(7); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(5); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(5); // decreasePositionRequestKeys.length

    expect(await avax.balanceOf(user0.address)).eq("996666666666666666");
    expect(await avax.balanceOf(user1.address)).eq("996666666666666666");
    expect(await avax.balanceOf(user2.address)).eq("996666666666666666");
    expect(await avax.balanceOf(user3.address)).eq(0);
    expect(await avax.balanceOf(user4.address)).eq("996666666666666666");

    await positionRouter
      .connect(user0)
      .createDecreasePosition(
        ...decreasePositionParams,
        user0.address,
        toUsd(290),
        0,
        4000,
        false,
        constants.AddressZero,
        { value: 4000 },
      );
    await positionRouter
      .connect(user0)
      .createDecreasePosition(
        ...decreasePositionParams,
        user0.address,
        toUsd(290),
        0,
        4000,
        false,
        constants.AddressZero,
        { value: 4000 },
      );

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(7); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(5); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(7); // decreasePositionRequestKeys.length

    await positionRouter.connect(positionKeeper).executeDecreasePositions(10, executionFeeReceiver.address);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(7); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(5); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(7); // decreasePositionRequestKeys.length

    await advanceBlock();
    await advanceBlock();

    await positionRouter.connect(positionKeeper).executeDecreasePositions(6, executionFeeReceiver.address);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(7); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(6); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(7); // decreasePositionRequestKeys.length

    await advanceBlock();
    await advanceBlock();
    await advanceBlock();

    await positionRouter.connect(positionKeeper).executeDecreasePositions(6, executionFeeReceiver.address);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(7); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(6); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(7); // decreasePositionRequestKeys.length

    await positionRouter.connect(positionKeeper).executeDecreasePositions(10, executionFeeReceiver.address);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(7); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(7); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(7); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(7); // decreasePositionRequestKeys.length

    await usdc.mint(user0.address, toWei(1800, 6));
    await usdc.connect(user0).approve(router.address, toWei(1800, 6));

    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });
    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });
    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, 4000, referralCode, constants.AddressZero, { value: 4000 });

    await positionRouter
      .connect(user0)
      .createDecreasePosition(
        ...decreasePositionParams,
        user0.address,
        toUsd(290),
        0,
        4000,
        false,
        constants.AddressZero,
        { value: 4000 },
      );
    await positionRouter
      .connect(user0)
      .createDecreasePosition(
        ...decreasePositionParams,
        user0.address,
        toUsd(290),
        0,
        4000,
        false,
        constants.AddressZero,
        { value: 4000 },
      );
    await positionRouter
      .connect(user0)
      .createDecreasePosition(
        ...decreasePositionParams,
        user0.address,
        toUsd(290),
        0,
        4000,
        false,
        constants.AddressZero,
        { value: 4000 },
      );
    await positionRouter
      .connect(user0)
      .createDecreasePosition(
        ...decreasePositionParams,
        user0.address,
        toUsd(290),
        0,
        4000,
        false,
        constants.AddressZero,
        { value: 4000 },
      );
    await positionRouter
      .connect(user0)
      .createDecreasePosition(
        ...decreasePositionParams,
        user0.address,
        toUsd(290),
        0,
        4000,
        false,
        constants.AddressZero,
        { value: 4000 },
      );

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(7); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(10); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(7); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(12); // decreasePositionRequestKeys.length

    await fastPriceFeed.setMaxTimeDeviation(1000);
    await positionRouter.setPositionKeeper(fastPriceFeed.address, true);

    const blockTime = await getTime();

    await expect(
      fastPriceFeed.connect(user0).setPricesWithBitsAndExecute(
        0, // _priceBits
        blockTime, // _timestamp
        9, // _endIndexForIncreasePositions
        10, // _endIndexForDecreasePositions
        1, // _maxIncreasePositions
        2, // _maxDecreasePositions
      ),
    ).to.be.revertedWith("FastPriceFeed: forbidden");

    await fastPriceFeed.connect(updater0).setPricesWithBitsAndExecute(
      0, // _priceBits
      blockTime, // _timestamp
      9, // _endIndexForIncreasePositions
      10, // _endIndexForDecreasePositions
      1, // _maxIncreasePositions
      2, // _maxDecreasePositions
    );

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(8); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(10); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(9); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(12); // decreasePositionRequestKeys.length
  });

  it("does not fail if transfer out eth fails", async () => {
    await positionRouter.setDelayValues(0, 300, 500);
    await avax.mint(vault.address, toWei(30, 18));
    await vault.buyUSDG(avax.address, user1.address);
    await timelock.setContractHandler(positionRouter.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123";

    await router.addPlugin(positionRouter.address);
    await router.connect(user0).approvePlugin(positionRouter.address);

    await usdc.mint(user0.address, toWei(6000, 6));
    await usdc.connect(user0).approve(router.address, toWei(6000, 6));

    const executionFeeReceiver = Wallet.createRandom();
    await positionRouter.setPositionKeeper(positionKeeper.address, true);

    const maliciousTrader = (
      await ship.deploy(MaliciousTraderTest__factory, { args: [positionRouter.address] })
    ).contract;
    const executionFee = 4000;
    const params: [
      string[],
      string,
      BigNumberish,
      BigNumberish,
      boolean,
      BigNumberish,
      BigNumberish,
      string,
      string,
    ] = [
      [avax.address], // _path
      avax.address, // _indexToken
      0, // _minOut
      toUsd(1000), // _sizeDelta
      true, // _isLong
      toUsd(310), // _acceptablePrice
      executionFee,
      referralCode,
      constants.AddressZero,
    ];
    expect(await ship.provider.getBalance(maliciousTrader.address), "balance 0").eq(0);
    await maliciousTrader.connect(user0).createIncreasePositionETH(...params, { value: toWei(1, 18) });
    expect(await ship.provider.getBalance(maliciousTrader.address), "balance 1").eq(0);
    const key = await positionRouter.getRequestKey(maliciousTrader.address, 1);
    let request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(maliciousTrader.address, "request account 0");

    await expect(
      positionRouter.connect(positionKeeper).cancelIncreasePosition(key, executionFeeReceiver.address),
    ).to.not.emit(maliciousTrader, "Received");
    expect(await ship.provider.getBalance(maliciousTrader.address), "balance 2").eq(0);
    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(constants.AddressZero, "request account 1");
  });

  it("callback works", async () => {
    await positionRouter.setDelayValues(0, 300, 500);
    await avax.mint(vault.address, toWei(30, 18));
    await vault.buyUSDG(avax.address, user1.address);
    await timelock.setContractHandler(positionRouter.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123";

    await router.addPlugin(positionRouter.address);
    await router.connect(user0).approvePlugin(positionRouter.address);

    await usdc.mint(user0.address, toWei(6000, 6));
    await usdc.connect(user0).approve(router.address, toWei(6000, 6));

    const executionFeeReceiver = Wallet.createRandom();
    await positionRouter.setPositionKeeper(positionKeeper.address, true);

    const executionFee = 4000;
    const params: [
      string[],
      string,
      BigNumberish,
      BigNumberish,
      BigNumberish,
      boolean,
      BigNumberish,
      BigNumberish,
      string,
    ] = [
      [usdc.address, avax.address], // _path
      avax.address, // _indexToken
      toWei(100, 6), // _amountIn
      0, // _minOut
      toUsd(1000), // _sizeDelta
      true, // _isLong
      toUsd(310), // _acceptablePrice
      executionFee,
      referralCode,
    ];
    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, constants.AddressZero, { value: executionFee });
    let key = await positionRouter.getRequestKey(user0.address, 1);
    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address),
      "increase: no callbackTarget",
    ).to.not.emit(positionRouter, "Callback");

    const decreaseParams: [
      string[],
      string,
      BigNumberish,
      BigNumberish,
      boolean,
      string,
      BigNumberish,
      BigNumberish,
      BigNumberish,
      boolean,
    ] = [
      [avax.address, usdc.address], // _collateralToken
      avax.address, // _indexToken
      0, // _collateralDelta
      toUsd(1000), // _sizeDelta
      true, // _isLong
      user0.address, // _receiver
      toUsd(300), // _acceptablePrice
      0, // _minOut
      executionFee,
      false,
    ];
    await positionRouter
      .connect(user0)
      .createDecreasePosition(...decreaseParams, constants.AddressZero, { value: executionFee });
    key = await positionRouter.getRequestKey(user0.address, 1);
    await expect(
      positionRouter.connect(positionKeeper).executeDecreasePosition(key, executionFeeReceiver.address),
      "decrease: no callbackTarget",
    ).to.not.emit(positionRouter, "Callback");

    const callbackReceiver = (await ship.deploy(PositionRouterCallbackReceiverTest__factory)).contract;
    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, callbackReceiver.address, { value: executionFee });
    key = await positionRouter.getRequestKey(user0.address, 2);
    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address),
      "increase: gas limit == 0",
    )
      .to.not.emit(positionRouter, "Callback")
      .to.not.emit(callbackReceiver, "CallbackCalled");

    await positionRouter
      .connect(user0)
      .createDecreasePosition(...decreaseParams, callbackReceiver.address, { value: executionFee });
    key = await positionRouter.getRequestKey(user0.address, 2);
    await expect(
      positionRouter.connect(positionKeeper).executeDecreasePosition(key, executionFeeReceiver.address),
      "decrease: no gas limit == 0",
    ).to.not.emit(positionRouter, "Callback");

    await positionRouter.setCallbackGasLimit(10);
    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, callbackReceiver.address, { value: executionFee });
    key = await positionRouter.getRequestKey(user0.address, 3);
    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address),
      "increase: gas limit == 10",
    )
      .to.emit(positionRouter, "Callback")
      .withArgs(callbackReceiver.address, false)
      .to.not.emit(callbackReceiver, "CallbackCalled");

    await positionRouter
      .connect(user0)
      .createDecreasePosition(...decreaseParams, callbackReceiver.address, { value: executionFee });
    key = await positionRouter.getRequestKey(user0.address, 3);
    await expect(
      positionRouter.connect(positionKeeper).executeDecreasePosition(key, executionFeeReceiver.address),
      "decrease: no gas limit == 10",
    )
      .to.emit(positionRouter, "Callback")
      .withArgs(callbackReceiver.address, false)
      .to.not.emit(callbackReceiver, "CallbackCalled");

    await positionRouter.setCallbackGasLimit(1000000);
    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, callbackReceiver.address, { value: executionFee });
    key = await positionRouter.getRequestKey(user0.address, 4);
    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address),
      "increase: gas limit = 1000000",
    )
      .to.emit(positionRouter, "Callback")
      .withArgs(callbackReceiver.address, true)
      .to.emit(callbackReceiver, "CallbackCalled")
      .withArgs(key, true, true);

    await positionRouter
      .connect(user0)
      .createDecreasePosition(...decreaseParams, callbackReceiver.address, { value: executionFee });
    key = await positionRouter.getRequestKey(user0.address, 4);
    await expect(
      positionRouter.connect(positionKeeper).executeDecreasePosition(key, executionFeeReceiver.address),
      "decrease: gas limit = 1000000",
    )
      .to.emit(positionRouter, "Callback")
      .withArgs(callbackReceiver.address, true)
      .to.emit(callbackReceiver, "CallbackCalled")
      .withArgs(key, true, false);

    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, callbackReceiver.address, { value: executionFee });
    key = await positionRouter.getRequestKey(user0.address, 5);
    await expect(
      positionRouter.connect(positionKeeper).cancelIncreasePosition(key, executionFeeReceiver.address),
      "increase: gas limit = 1000000",
    )
      .to.emit(positionRouter, "Callback")
      .withArgs(callbackReceiver.address, true)
      .to.emit(callbackReceiver, "CallbackCalled")
      .withArgs(key, false, true);

    await positionRouter
      .connect(user0)
      .createDecreasePosition(...decreaseParams, callbackReceiver.address, { value: executionFee });
    key = await positionRouter.getRequestKey(user0.address, 5);
    await expect(
      positionRouter.connect(positionKeeper).cancelDecreasePosition(key, executionFeeReceiver.address),
      "decrease: gas limit = 1000000",
    )
      .to.emit(positionRouter, "Callback")
      .withArgs(callbackReceiver.address, true)
      .to.emit(callbackReceiver, "CallbackCalled")
      .withArgs(key, false, false);
  });

  it("invalid callback is handled correctly", async () => {
    await positionRouter.setDelayValues(0, 300, 500);
    await avax.mint(vault.address, toWei(30, 18));
    await vault.buyUSDG(avax.address, user1.address);
    await timelock.setContractHandler(positionRouter.address, true);
    await timelock.setShouldToggleIsLeverageEnabled(true);

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123";

    await router.addPlugin(positionRouter.address);
    await router.connect(user0).approvePlugin(positionRouter.address);

    await usdc.mint(user0.address, toWei(6000, 6));
    await usdc.connect(user0).approve(router.address, toWei(6000, 6));

    const executionFeeReceiver = Wallet.createRandom();
    await positionRouter.setPositionKeeper(positionKeeper.address, true);

    await positionRouter.setCallbackGasLimit(10);

    const executionFee = 4000;
    const params: [
      string[],
      string,
      BigNumberish,
      BigNumberish,
      BigNumberish,
      boolean,
      BigNumberish,
      BigNumberish,
      string,
    ] = [
      [usdc.address, avax.address], // _path
      avax.address, // _indexToken
      toWei(100, 6), // _amountIn
      0, // _minOut
      toUsd(1000), // _sizeDelta
      true, // _isLong
      toUsd(310), // _acceptablePrice
      executionFee,
      referralCode,
    ];
    // use EOA as a callbackTarget
    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, user0.address, { value: executionFee });
    let key = await positionRouter.getRequestKey(user0.address, 1);
    let request = await positionRouter.increasePositionRequests(key);
    expect(request.callbackTarget, "callback target 0").to.equal(user0.address);

    // request should be executed successfully, Callback event should not be emitted
    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address),
      "executed 0",
    ).to.not.emit(positionRouter, "Callback");
    // make sure it was executed
    request = await positionRouter.increasePositionRequests(key);
    expect(request.account, "request 0").to.equal(constants.AddressZero);

    // make sure position was increased
    let position = await vault.getPosition(user0.address, avax.address, avax.address, true);
    expect(position[0], "position size 0").to.equal(toUsd(1000));

    // use contract without callback method as a callbackTarget
    await positionRouter
      .connect(user0)
      .createIncreasePosition(...params, btc.address, { value: executionFee });
    key = await positionRouter.getRequestKey(user0.address, 2);
    request = await positionRouter.increasePositionRequests(key);
    expect(request.callbackTarget, "callback target 1").to.equal(btc.address);

    // request should be executed successfully, Callback event should be emitted
    await expect(
      positionRouter.connect(positionKeeper).executeIncreasePosition(key, executionFeeReceiver.address),
      "executed 1",
    )
      .to.emit(positionRouter, "Callback")
      .withArgs(btc.address, false);
    // make sure it was executed
    request = await positionRouter.increasePositionRequests(key);
    expect(request.account, "request 1").to.equal(constants.AddressZero);

    // make sure position was increased
    position = await vault.getPosition(user0.address, avax.address, avax.address, true);
    expect(position[0], "position size 1").to.equal(toUsd(2000));
  });

  describe("Updates short tracker data", () => {
    let xlxManager: XlxManager;

    beforeEach(async () => {
      const xlx = await ship.connect(XLX__factory);
      xlxManager = await ship.connect(XlxManager__factory);
      await xlxManager.setCooldownDuration(24 * 60 * 60);
      await xlxManager.setShortsTrackerAveragePriceWeight(10000);

      await router.addPlugin(positionRouter.address);
      await router.connect(user0).approvePlugin(positionRouter.address);
      await positionRouter.setDelayValues(0, 300, 500);
      await positionRouter.setPositionKeeper(positionKeeper.address, true);

      await usdc.mint(user0.address, toWei(10000, 6));
      await usdc.connect(user0).approve(router.address, toWei(10000, 6));

      await usdc.mint(vault.address, toWei(10000, 6));
      await vault.buyUSDG(usdc.address, user1.address);
      await timelock.setContractHandler(positionRouter.address, true);
      await timelock.setShouldToggleIsLeverageEnabled(true);

      await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));
      await shortsTracker.setIsGlobalShortDataReady(true);
    });

    it("executeIncreasePosition", async () => {
      const executionFee = toWei(1, 17);
      const params: [
        string[],
        string,
        BigNumberish,
        BigNumberish,
        BigNumberish,
        boolean,
        BigNumberish,
        BigNumberish,
        string,
        string,
      ] = [
        [usdc.address], // _path
        avax.address, // _indexToken
        toWei(500, 6), // _amountIn
        0, // _minOut
        toUsd(1000), // _sizeDelta
        false, // _isLong
        toUsd(300), // _acceptablePrice
        executionFee, // executionFee
        constants.HashZero,
        constants.AddressZero,
      ];

      await positionRouter.connect(user0).createIncreasePosition(...params, { value: executionFee });
      let key = await positionRouter.getRequestKey(user0.address, 1);
      await positionRouter.connect(positionKeeper).executeIncreasePosition(key, user1.address);

      expect(await vault.globalShortSizes(avax.address), "size 0").to.be.equal(toUsd(1000));
      expect(await shortsTracker.globalShortAveragePrices(avax.address), "avg price 0").to.be.equal(
        toUsd(300),
      );

      await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(330));
      await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(330));
      await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(330));

      let [hasProfit, delta] = await shortsTracker.getGlobalShortDelta(avax.address);
      expect(hasProfit, "has profit 0").to.be.false;
      expect(delta, "delta 0").to.be.equal(toUsd(100));

      const aumBefore = await xlxManager.getAum(true);

      await positionRouter.connect(user0).createIncreasePosition(...params, { value: executionFee });
      key = await positionRouter.getRequestKey(user0.address, 2);
      await positionRouter.connect(positionKeeper).executeIncreasePosition(key, user1.address);

      expect(await vault.globalShortSizes(avax.address), "size 1").to.be.equal(toUsd(2000));
      expect(await shortsTracker.globalShortAveragePrices(avax.address), "avg price 1").to.be.equal(
        "314285714285714285714285714285714",
      );

      [hasProfit, delta] = await shortsTracker.getGlobalShortDelta(avax.address);
      expect(hasProfit, "has profit 1").to.be.false;
      expect(delta, "delta 1").to.be.closeTo(toUsd(100), 100);

      const aumAfter = await xlxManager.getAum(true);
      expect(aumAfter).to.be.closeTo(aumBefore, 100);
    });

    it("executeDecreasePosition", async () => {
      const executionFee = toWei(1, 17);
      const increaseParams: [
        string[],
        string,
        BigNumberish,
        BigNumberish,
        BigNumberish,
        boolean,
        BigNumberish,
        BigNumberish,
        string,
        string,
      ] = [
        [usdc.address], // _path
        avax.address, // _indexToken
        toWei(500, 6), // _amountIn
        0, // _minOut
        toUsd(1000), // _sizeDelta
        false, // _isLong
        toUsd(300), // _acceptablePrice
        executionFee, // executionFee
        constants.HashZero,
        constants.AddressZero,
      ];

      await positionRouter.connect(user0).createIncreasePosition(...increaseParams, { value: executionFee });
      let key = await positionRouter.getRequestKey(user0.address, 1);
      await positionRouter.connect(positionKeeper).executeIncreasePosition(key, user1.address);

      const decreaseParams: [
        string[],
        string,
        BigNumberish,
        BigNumberish,
        boolean,
        string,
        BigNumberish,
        BigNumberish,
        BigNumberish,
        boolean,
        string,
      ] = [
        [usdc.address], // _collateralToken
        avax.address, // _indexToken
        0, // _collateralDelta
        toUsd(100), // _sizeDelta
        false, // _isLong
        user0.address, // _receiver
        toUsd(1000), // _acceptablePrice
        0, // _minOut
        executionFee,
        false,
        constants.AddressZero,
      ];

      await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(330));
      await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(330));
      await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(330));

      expect(await vault.globalShortSizes(avax.address), "size 0").to.be.equal(toUsd(1000));
      expect(await shortsTracker.globalShortAveragePrices(avax.address), "avg price 0").to.be.equal(
        toUsd(300),
      );

      let [hasProfit, delta] = await shortsTracker.getGlobalShortDelta(avax.address);
      expect(hasProfit, "has profit 0").to.be.false;
      expect(delta, "delta 0").to.be.equal(toUsd(100));

      let aumBefore = await xlxManager.getAum(true);

      await positionRouter.connect(user0).createDecreasePosition(...decreaseParams, { value: executionFee });
      key = await positionRouter.getRequestKey(user0.address, 1);
      await positionRouter.connect(positionKeeper).executeDecreasePosition(key, user1.address);

      expect(await vault.globalShortSizes(avax.address), "size 1").to.be.equal(toUsd(900));
      expect(await shortsTracker.globalShortAveragePrices(avax.address), "avg price 1").to.be.equal(
        toUsd(300),
      );

      [hasProfit, delta] = await shortsTracker.getGlobalShortDelta(avax.address);
      expect(hasProfit, "has profit 1").to.be.false;
      expect(delta, "delta 1").to.be.equal(toUsd(90));

      expect(await xlxManager.getAum(true), "aum 0").to.be.closeTo(aumBefore, 100);

      await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));
      await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));
      await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));

      aumBefore = await xlxManager.getAum(true);

      await positionRouter.connect(user0).createDecreasePosition(...decreaseParams, { value: executionFee });
      key = await positionRouter.getRequestKey(user0.address, 2);
      await positionRouter.connect(positionKeeper).executeDecreasePosition(key, user1.address);

      expect(await vault.globalShortSizes(avax.address), "size 2").to.be.equal(toUsd(800));
      expect(await shortsTracker.globalShortAveragePrices(avax.address), "avg price 2").to.be.equal(
        toUsd(300),
      );

      [hasProfit, delta] = await shortsTracker.getGlobalShortDelta(avax.address);
      expect(hasProfit, "has profit 2").to.be.false;
      expect(delta, "delta 2").to.be.equal(toUsd(0));

      expect(await xlxManager.getAum(true), "aum 1").to.be.closeTo(aumBefore, 100);
    });
  });
});
