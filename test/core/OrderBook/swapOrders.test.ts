import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  OrderBook__factory,
  OrderBook,
  Router__factory,
  VaultPriceFeed__factory,
  Token,
  Vault__factory,
  Router,
  VaultPriceFeed,
  Vault,
  USDG__factory,
  USDG,
  PriceFeed,
} from "../../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { getTxFees, reportGasUsed, Ship, toChainlinkPrice, toUsd, toWei } from "../../../utils";
import {
  AVAX_PRICE,
  BASIS_POINTS_DIVISOR,
  BTC_PRICE,
  defaultExecutionFee,
  defaultTriggerRatio,
  getTriggerRatio,
  PRICE_PRECISION,
  validateOrderFields,
} from "./shared";
import { BigNumber, BigNumberish, constants } from "ethers";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let orderbook: OrderBook;
let router: Router;
let vault: Vault;
let vaultPriceFeed: VaultPriceFeed;
let usdg: USDG;
let usdc: Token;
let usdce: Token;
let btc: Token;
let btcPriceFeed: PriceFeed;
let avax: Token;
let avaxPriceFeed: PriceFeed;
let tokenDecimals: any;

let deployer: SignerWithAddress;
let user0: SignerWithAddress;
let user1: SignerWithAddress;
let user2: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture(["orderbook", "tokens", "vaultPriceFeed", "vault", "router"]);

  return {
    ship,
    accounts,
    users,
  };
});

async function getCreatedSwapOrder(address: string, orderIndex = 0) {
  const order = await orderbook.swapOrders(address, orderIndex);
  return order;
}

function getSwapFees(token: string, amount: BigNumber) {
  // ideally to get all this from Vault in runtime
  //
  let feesPoints;
  if ([usdc.address, usdce.address, usdg.address].includes(token)) {
    feesPoints = 4;
  } else {
    feesPoints = 30;
  }
  return amount.mul(feesPoints).div(BASIS_POINTS_DIVISOR);
}

async function getMinOut(triggerRatio: BigNumberish, path: string[], amountIn: BigNumber) {
  const tokenAPrecision = toWei(1, tokenDecimals[path[0]]);
  const tokenBPrecision = toWei(1, tokenDecimals[path[path.length - 1]]);

  const minOut = amountIn.mul(PRICE_PRECISION).div(triggerRatio).mul(tokenBPrecision).div(tokenAPrecision);
  const swapFees = getSwapFees(path[path.length - 1], minOut);
  return minOut.sub(swapFees);
}

describe("OrderBook, swap orders", function () {
  beforeEach(async function () {
    const { accounts, users } = await setup();

    deployer = accounts.deployer;
    user0 = users[0];
    user1 = users[1];
    user2 = users[2];

    orderbook = await ship.connect(OrderBook__factory);
    router = await ship.connect(Router__factory);
    vault = await ship.connect(Vault__factory);
    vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
    usdg = await ship.connect(USDG__factory);
    btc = (await ship.connect("btc")) as Token;
    btcPriceFeed = (await ship.connect("btcPriceFeed")) as PriceFeed;
    usdc = (await ship.connect("usdc")) as Token;
    usdce = (await ship.connect("usdce")) as Token;
    avax = (await ship.connect("avax")) as Token;
    avaxPriceFeed = (await ship.connect("avaxPriceFeed")) as PriceFeed;

    await orderbook.setMinExecutionFee(500000);
    await orderbook.setMinPurchaseTokenAmountUsd(toWei(5, 30));
    await router.addPlugin(orderbook.address);
    await router.connect(user0).approvePlugin(orderbook.address);

    await vaultPriceFeed.setPriceSampleSpace(1);
    await vaultPriceFeed.setIsSecondaryPriceEnabled(false);

    await btc.mint(user0.address, toWei(1000, 8));
    await btc.connect(user0).approve(router.address, toWei(100, 8));

    await usdc.mint(user0.address, toWei(10000000, 6));
    await usdc.connect(user0).approve(router.address, toWei(1000000, 6));

    await avax.mint(user0.address, toWei(10000000, 18));
    await avax.connect(user0).approve(router.address, toWei(1000000, 18));

    await usdc.mint(user0.address, toWei(20000000, 6));
    await usdc.connect(user0).transfer(vault.address, toWei(2000000, 6));
    await vault.directPoolDeposit(usdc.address);

    await btc.mint(user0.address, toWei(1000, 8));
    await btc.connect(user0).transfer(vault.address, toWei(100, 8));
    await vault.directPoolDeposit(btc.address);

    await avax.mint(user0.address, toWei(50000, 18));
    await avax.connect(user0).transfer(vault.address, toWei(10000, 18));
    await vault.directPoolDeposit(avax.address);

    // it's impossible to just mint usdg (?)
    await vault.setManager(router.address, true);
    await vault.setManager(orderbook.address, true);

    await router
      .connect(user0)
      .swap([usdc.address, usdg.address], toWei(10000, 6), toWei(9900, 18), user0.address);
    await usdg.connect(user0).approve(router.address, toWei(9900, 18));

    await btc.mint(user0.address, toWei(1000, 8));
    await btc.connect(user0).transfer(vault.address, toWei(100, 8));
    await vault.directPoolDeposit(btc.address);

    await avax.mint(user0.address, toWei(100000, 18));
    await avax.connect(user0).approve(router.address, toWei(50000, 18));

    await avax.connect(user0).transfer(vault.address, toWei(10000, 18));
    await vault.directPoolDeposit(avax.address);
    // probably I'm doing something wrong? contract doesn't have enough funds
    // when I need to withdraw weth (which I have in balances)
    await avax.deposit({ value: toWei(500, 18) });

    tokenDecimals = {
      [avax.address]: 18,
      [usdc.address]: 6,
      [usdg.address]: 18,
      [btc.address]: 8,
    };
  });

  /*
    checklist:
    [x] create order, path.length not in (2, 3) => revert
    [x] create order, path[0] == path[-1] => revert
    [x] executionFee less than minimum =< revert
    [x] if path[0] == weth -> transfer fee + amountIn
    [x] transferred token == amountIn
    [x] and check total transfer, otherwise revert
    [x] if path[0] != weth -> transfer fee and transfer token separately
    [x] and check total transfer, otherwise => revert
    [x] order retreivable
    [x] two orders retreivable
    [x] cancel order deletes order
    [x] and returns amountIn as token + fees as AVAX if path[0] != weth
    [x] otherwise returns fees + amountIn as AVAX
    [x] execute order – revert if doest not exist
    [x] if trigger below and minOut insufficient -> revert
    [x] if trigger above and priceRatio is incorrect -> revert
    [x] if priceRatio correct but minOut insufficient -> revert
    [x] if coniditions are met executor receives fee
    [x] user receives AVAX if path[-1] == weth
    [x] or token otherwise
    [x] order is deleted after execution
    [x] user can update minOut, triggerRatio and triggerAboveThreshold
    [x] if order doesn't exist => revert
    */

  it("createSwapOrder, bad input", async () => {
    await expect(
      orderbook
        .connect(user0)
        .createSwapOrder([btc.address], toWei(1000, 6), 0, 1, true, defaultExecutionFee, false, true, {
          value: defaultExecutionFee,
        }),
      "1",
    ).to.be.revertedWith("OrderBook: invalid _path.length");

    await expect(
      orderbook
        .connect(user0)
        .createSwapOrder(
          [btc.address, btc.address, usdc.address, usdc.address],
          toWei(1000, 6),
          0,
          1,
          true,
          defaultExecutionFee,
          true,
          true,
          { value: defaultExecutionFee },
        ),
      "2",
    ).to.be.revertedWith("OrderBook: invalid _path.length");

    await expect(
      orderbook
        .connect(user0)
        .createSwapOrder(
          [btc.address, avax.address],
          toWei(1000, 6),
          0,
          1,
          true,
          defaultExecutionFee,
          true,
          true,
          { value: defaultExecutionFee },
        ),
    ).to.be.revertedWith("OrderBook: only weth could be wrapped");

    await expect(
      orderbook
        .connect(user0)
        .createSwapOrder(
          [btc.address, btc.address],
          toWei(1000, 6),
          0,
          1,
          true,
          defaultExecutionFee,
          false,
          true,
          { value: defaultExecutionFee },
        ),
      "3",
    ).to.be.revertedWith("OrderBook: invalid _path");

    await expect(
      orderbook
        .connect(user0)
        .createSwapOrder([usdc.address, btc.address], toWei(1000, 6), 0, 1, true, 100, false, true, {
          value: 100,
        }),
      "4",
    ).to.be.revertedWith("OrderBook: insufficient execution fee");

    await expect(
      orderbook
        .connect(user0)
        .createSwapOrder(
          [usdc.address, btc.address],
          toWei(1000, 6),
          0,
          1,
          true,
          defaultExecutionFee,
          false,
          true,
          {
            value: 100,
          },
        ),
      "5",
    ).to.be.revertedWith("OrderBook: incorrect execution fee transferred");
  });

  it("createSwapOrder, USDC -> BTC", async () => {
    const triggerRatio = toUsd(1).mul(PRICE_PRECISION).div(toUsd(58000));
    const userusdcBalanceBefore = await usdc.balanceOf(user0.address);
    const tx = await orderbook
      .connect(user0)
      .createSwapOrder(
        [usdc.address, btc.address],
        toWei(1000, 6),
        0,
        triggerRatio,
        false,
        defaultExecutionFee,
        false,
        true,
        { value: defaultExecutionFee },
      );
    reportGasUsed(tx, "createSwapOrder");
    const userusdcBalanceAfter = await usdc.balanceOf(user0.address);
    expect(userusdcBalanceAfter).to.be.equal(userusdcBalanceBefore.sub(toWei(1000, 6)));

    const usdcBalance = await usdc.balanceOf(orderbook.address);
    expect(usdcBalance).to.be.equal(toWei(1000, 6));
    const avaxBalance = await avax.balanceOf(orderbook.address);
    expect(avaxBalance).to.be.equal(defaultExecutionFee);

    const order = await getCreatedSwapOrder(user0.address);

    validateOrderFields(order, {
      account: user0.address,
      triggerRatio,
      triggerAboveThreshold: false,
      minOut: 0,
      amountIn: toWei(1000, 6),
      executionFee: defaultExecutionFee,
    });
  });

  it("createSwapOrder, WAVAX -> USDC", async () => {
    const triggerRatio = getTriggerRatio(toUsd(550), toUsd(1));

    await expect(
      orderbook
        .connect(user0)
        .createSwapOrder(
          [avax.address, usdc.address],
          toWei(10, 6),
          0,
          triggerRatio,
          false,
          defaultExecutionFee,
          false,
          true,
          { value: defaultExecutionFee.sub(1) },
        ),
    ).to.be.revertedWith("OrderBook: incorrect execution fee transferred");

    await expect(
      orderbook
        .connect(user0)
        .createSwapOrder(
          [avax.address, usdc.address],
          toWei(10, 18),
          0,
          triggerRatio,
          false,
          defaultExecutionFee,
          false,
          true,
          { value: defaultExecutionFee.add(1) },
        ),
    ).to.be.revertedWith("OrderBook: incorrect execution fee transferred");

    const tx = await orderbook
      .connect(user0)
      .createSwapOrder(
        [avax.address, usdc.address],
        toWei(10, 18),
        0,
        triggerRatio,
        false,
        defaultExecutionFee,
        false,
        true,
        { value: defaultExecutionFee },
      );
    reportGasUsed(tx, "createSwapOrder");
    const avaxBalance = await avax.balanceOf(orderbook.address);
    expect(avaxBalance).to.be.equal(defaultExecutionFee.add(toWei(10, 18)));

    const order = await getCreatedSwapOrder(user0.address);

    validateOrderFields(order, {
      account: user0.address,
      triggerRatio,
      triggerAboveThreshold: false,
      minOut: 0,
      executionFee: defaultExecutionFee,
      amountIn: toWei(10, 18),
    });
  });

  it("createSwapOrder, AVAX -> USDC", async () => {
    const triggerRatio = getTriggerRatio(toUsd(550), toUsd(1));
    const amountIn = toWei(10, 18);
    const value = defaultExecutionFee.add(amountIn);

    await expect(
      orderbook
        .connect(user0)
        .createSwapOrder(
          [avax.address, usdc.address],
          amountIn,
          0,
          triggerRatio,
          false,
          defaultExecutionFee,
          true,
          false,
          { value: value.sub(1) },
        ),
    ).to.be.revertedWith("OrderBook: incorrect value transferred");

    await expect(
      orderbook
        .connect(user0)
        .createSwapOrder(
          [avax.address, usdc.address],
          amountIn,
          0,
          triggerRatio,
          false,
          defaultExecutionFee,
          true,
          false,
          { value: value.add(1) },
        ),
    ).to.be.revertedWith("OrderBook: incorrect value transferred");

    const tx = await orderbook
      .connect(user0)
      .createSwapOrder(
        [avax.address, usdc.address],
        amountIn,
        0,
        triggerRatio,
        false,
        defaultExecutionFee,
        true,
        false,
        { value: value },
      );
    reportGasUsed(tx, "createSwapOrder");
    const avaxBalance = await avax.balanceOf(orderbook.address);
    expect(avaxBalance).to.be.equal(value);

    const order = await getCreatedSwapOrder(user0.address);

    validateOrderFields(order, {
      account: user0.address,
      triggerRatio,
      triggerAboveThreshold: false,
      minOut: 0,
      executionFee: defaultExecutionFee,
      amountIn,
    });
  });

  it("createSwapOrder, USDC -> WAVAX, shouldUnwrap = false", async () => {
    const triggerRatio = getTriggerRatio(toUsd(1), toUsd(310));
    const amountIn = toWei(100, 6);

    const tx = await orderbook
      .connect(user0)
      .createSwapOrder(
        [usdc.address, avax.address],
        amountIn,
        0,
        triggerRatio,
        false,
        defaultExecutionFee,
        false,
        false,
        { value: defaultExecutionFee },
      );
    reportGasUsed(tx, "createSwapOrder");

    const order = await getCreatedSwapOrder(user0.address);

    validateOrderFields(order, {
      account: user0.address,
      triggerRatio,
      triggerAboveThreshold: false,
      minOut: 0,
      executionFee: defaultExecutionFee,
      shouldUnwrap: false,
      amountIn,
    });
  });

  it("createSwapOrder, two orders", async () => {
    const triggerRatio1 = getTriggerRatio(toUsd(58000), toUsd(1));
    const tx1 = await orderbook
      .connect(user0)
      .createSwapOrder(
        [usdc.address, btc.address],
        toWei(1000, 6),
        0,
        triggerRatio1,
        true,
        defaultExecutionFee,
        false,
        true,
        { value: defaultExecutionFee },
      );
    reportGasUsed(tx1, "createSwapOrder");

    const triggerRatio2 = getTriggerRatio(toUsd(59000), toUsd(1));
    const tx2 = await orderbook
      .connect(user0)
      .createSwapOrder(
        [usdc.address, btc.address],
        toWei(1000, 6),
        0,
        triggerRatio2,
        true,
        defaultExecutionFee,
        false,
        true,
        { value: defaultExecutionFee },
      );
    reportGasUsed(tx2, "createSwapOrder");

    const order1 = await getCreatedSwapOrder(user0.address, 0);
    const order2 = await getCreatedSwapOrder(user0.address, 1);

    expect(order1.account).to.be.equal(user0.address);
    expect(order1.triggerRatio).to.be.equal(triggerRatio1);

    expect(order2.account).to.be.equal(user0.address);
    expect(order2.triggerRatio).to.be.equal(triggerRatio2);
  });

  it("cancelSwapOrder, tokenA != AVAX", async () => {
    const triggerRatio = toUsd(58000).mul(PRICE_PRECISION).div(toUsd(1));
    await orderbook
      .connect(user0)
      .createSwapOrder(
        [usdc.address, btc.address],
        toWei(1000, 6),
        0,
        triggerRatio,
        false,
        defaultExecutionFee,
        false,
        true,
        { value: defaultExecutionFee },
      );

    const balanceBefore = await user0.getBalance();
    const usdcBalanceBefore = await usdc.balanceOf(user0.address);

    const tx = await orderbook.connect(user0).cancelSwapOrder(0);
    reportGasUsed(tx, "canceSwapOrder");
    const txFees = await getTxFees(tx);

    const balanceAfter = await user0.getBalance();
    const usdcBalanceAfter = await usdc.balanceOf(user0.address);
    const order = await getCreatedSwapOrder(user0.address);

    expect(balanceAfter, "balanceAfter").to.be.equal(balanceBefore.add(defaultExecutionFee).sub(txFees));
    expect(usdcBalanceAfter, "usdcBalanceAfter").to.be.eq(usdcBalanceBefore.add(toWei(1000, 6)));

    expect(order.account, "account").to.be.equal(constants.AddressZero);
  });

  it("cancelSwapOrder, tokenA == AVAX", async () => {
    const triggerRatio = toUsd(1).mul(PRICE_PRECISION).div(toUsd(550));
    const amountIn = toWei(10, 18);
    const value = defaultExecutionFee.add(amountIn);
    await orderbook
      .connect(user0)
      .createSwapOrder(
        [avax.address, usdc.address],
        amountIn,
        0,
        triggerRatio,
        false,
        defaultExecutionFee,
        true,
        true,
        { value: value },
      );

    const balanceBefore = await user0.getBalance();

    const tx = await orderbook.connect(user0).cancelSwapOrder(0);
    reportGasUsed(tx, "canceSwapOrder");
    const txFees = await getTxFees(tx);

    const balanceAfter = await user0.getBalance();
    const order = await getCreatedSwapOrder(user0.address);

    expect(balanceAfter, "balanceAfter").to.be.equal(balanceBefore.add(value).sub(txFees));

    expect(order.account, "account").to.be.equal(constants.AddressZero);
  });

  it("updateSwapOrder", async () => {
    const triggerRatio = toUsd(58000).mul(PRICE_PRECISION).div(toUsd(1));
    await orderbook
      .connect(user0)
      .createSwapOrder(
        [usdc.address, btc.address],
        toWei(1000, 6),
        0,
        triggerRatio,
        true,
        defaultExecutionFee,
        false,
        true,
        { value: defaultExecutionFee },
      );

    const orderBefore = await getCreatedSwapOrder(user0.address);

    validateOrderFields(orderBefore, {
      triggerRatio,
      triggerAboveThreshold: true,
      minOut: 0,
    });

    const newTriggerRatio = toUsd(58000).mul(PRICE_PRECISION).div(toUsd(1));
    const newTriggerAboveThreshold = false;
    const newMinOut = toWei(1, 8).div(1000);

    await expect(
      orderbook.connect(user1).updateSwapOrder(0, newMinOut, triggerRatio, newTriggerAboveThreshold),
    ).to.be.revertedWith("OrderBook: non-existent order");

    await expect(
      orderbook.connect(user0).updateSwapOrder(1, newMinOut, triggerRatio, newTriggerAboveThreshold),
    ).to.be.revertedWith("OrderBook: non-existent order");

    const tx = await orderbook
      .connect(user0)
      .updateSwapOrder(0, newMinOut, triggerRatio, newTriggerAboveThreshold);
    reportGasUsed(tx, "updateSwapOrder");

    const orderAfter = await getCreatedSwapOrder(user0.address);
    validateOrderFields(orderAfter, {
      triggerRatio: triggerRatio,
      triggerAboveThreshold: newTriggerAboveThreshold,
      minOut: newMinOut,
    });
  });

  it("executeSwapOrder, triggerAboveThreshold == false", async () => {
    // in this case contract OrderBook will ignore triggerPrice prop
    // and will try to swap using passed minOut
    // minOut will ensure swap will occur with suitable price

    const amountIn = toWei(1, 8);
    const value = defaultExecutionFee;
    const path = [btc.address, avax.address];
    const minOut = await getMinOut(getTriggerRatio(toUsd(BTC_PRICE), toUsd(AVAX_PRICE - 50)), path, amountIn);

    await orderbook
      .connect(user0)
      .createSwapOrder(path, amountIn, minOut, defaultTriggerRatio, false, defaultExecutionFee, false, true, {
        value: value,
      });

    await expect(
      orderbook.executeSwapOrder(user0.address, 2, user1.address),
      "non-existent order",
    ).to.be.revertedWith("OrderBook: non-existent order");

    avaxPriceFeed.setLatestAnswer(toChainlinkPrice(AVAX_PRICE - 30));
    await expect(
      orderbook.executeSwapOrder(user0.address, 0, user1.address),
      "insufficient amountOut",
    ).to.be.revertedWith("OrderBook: insufficient amountOut");

    avaxPriceFeed.setLatestAnswer(toChainlinkPrice(AVAX_PRICE - 70));

    const executor = user1;
    const executorBalanceBefore = await executor.getBalance();
    const userBalanceBefore = await user0.getBalance();

    const tx = await orderbook.executeSwapOrder(user0.address, 0, executor.address);
    reportGasUsed(tx, "executeSwapOrder");

    const executorBalanceAfter = await executor.getBalance();
    expect(executorBalanceAfter, "executorBalanceAfter").to.be.equal(
      executorBalanceBefore.add(defaultExecutionFee),
    );

    const userBalanceAfter = await user0.getBalance();
    expect(userBalanceAfter.gt(userBalanceBefore.add(minOut)), "userBalanceAfter").to.be.true;

    const order = await getCreatedSwapOrder(user0.address, 0);
    expect(order.account).to.be.equal(constants.AddressZero);
  });

  it("executeSwapOrder, triggerAboveThreshold == false, USDC -> WAVAX, shouldUnwrap = false", async () => {
    const amountIn = toWei(100, 6);
    const value = defaultExecutionFee;
    const path = [usdc.address, avax.address];
    const minOut = await getMinOut(getTriggerRatio(toUsd(1), toUsd(AVAX_PRICE + 50)), path, amountIn);

    await orderbook
      .connect(user0)
      .createSwapOrder(
        path,
        amountIn,
        minOut,
        defaultTriggerRatio,
        false,
        defaultExecutionFee,
        false,
        false,
        { value: value },
      );

    const executor = user1;
    const executorBalanceBefore = await executor.getBalance();
    const userWavaxBalanceBefore = await avax.balanceOf(user0.address);

    const tx = await orderbook.executeSwapOrder(user0.address, 0, executor.address);
    reportGasUsed(tx, "executeSwapOrder");

    const executorBalanceAfter = await executor.getBalance();
    expect(executorBalanceAfter, "executorBalanceAfter").to.be.equal(
      executorBalanceBefore.add(defaultExecutionFee),
    );

    const userWavaxBalanceAfter = await avax.balanceOf(user0.address);
    expect(userWavaxBalanceAfter.gt(userWavaxBalanceBefore.add(minOut)), "userWavaxBalanceAfter").to.be.true;

    const order = await getCreatedSwapOrder(user0.address, 0);
    expect(order.account).to.be.equal(constants.AddressZero);
  });

  it("executeSwapOrder, triggerAboveThreshold == true", async () => {
    const triggerRatio = getTriggerRatio(toUsd(AVAX_PRICE), toUsd(62000));
    const amountIn = toWei(10, 18);
    const path = [avax.address, btc.address];
    const value = defaultExecutionFee.add(amountIn);

    // minOut is not mandatory for such orders but with minOut it's possible to limit max price
    // e.g. user would not be happy if he sets order "buy if BTC > $65000" and order executes with $75000
    const minOut = await getMinOut(getTriggerRatio(toUsd(AVAX_PRICE), toUsd(63000)), path, amountIn);

    await orderbook
      .connect(user0)
      .createSwapOrder(path, amountIn, minOut, triggerRatio, true, defaultExecutionFee, true, true, {
        value: value,
      });

    const executor = user1;

    await expect(orderbook.executeSwapOrder(user0.address, 2, executor.address)).to.be.revertedWith(
      "OrderBook: non-existent order",
    );

    btcPriceFeed.setLatestAnswer(toChainlinkPrice(60500));
    await expect(orderbook.executeSwapOrder(user0.address, 0, executor.address)).to.be.revertedWith(
      "OrderBook: invalid price for execution",
    );

    btcPriceFeed.setLatestAnswer(toChainlinkPrice(62500));

    const executorBalanceBefore = await executor.getBalance();
    const userBtcBalanceBefore = await btc.balanceOf(user0.address);

    const tx = await orderbook.executeSwapOrder(user0.address, 0, executor.address);
    reportGasUsed(tx, "executeSwapOrder");

    const executorBalanceAfter = await user1.getBalance();
    expect(executorBalanceAfter, "executorBalanceAfter").to.be.equal(
      executorBalanceBefore.add(defaultExecutionFee),
    );

    const userBtcBalanceAfter = await btc.balanceOf(user0.address);
    expect(userBtcBalanceAfter.gt(userBtcBalanceBefore.add(minOut)), "userBtcBalanceAfter").to.be.true;

    const order = await getCreatedSwapOrder(user0.address, 0);
    expect(order.account).to.be.equal(constants.AddressZero);
  });

  it("executeSwapOrder, triggerAboveThreshold == true, AVAX -> USDC -> BTC", async () => {
    const triggerRatio = getTriggerRatio(toUsd(AVAX_PRICE), toUsd(62000));
    const amountIn = toWei(10, 18);
    const path = [avax.address, usdc.address, btc.address];
    const value = defaultExecutionFee.add(amountIn);

    // minOut is not mandatory for such orders but with minOut it's possible to limit max price
    // e.g. user would not be happy if he sets order "buy if BTC > $65000" and order executes with $75000
    const minOut = await getMinOut(getTriggerRatio(toUsd(AVAX_PRICE), toUsd(63000)), path, amountIn);

    await orderbook
      .connect(user0)
      .createSwapOrder(path, amountIn, minOut, triggerRatio, true, defaultExecutionFee, true, true, {
        value: value,
      });

    const executor = user1;

    await expect(orderbook.executeSwapOrder(user0.address, 2, executor.address)).to.be.revertedWith(
      "OrderBook: non-existent order",
    );

    btcPriceFeed.setLatestAnswer(toChainlinkPrice(60500));
    await expect(orderbook.executeSwapOrder(user0.address, 0, executor.address)).to.be.revertedWith(
      "OrderBook: invalid price for execution",
    );

    btcPriceFeed.setLatestAnswer(toChainlinkPrice(62500));

    const executorBalanceBefore = await executor.getBalance();
    const userBtcBalanceBefore = await btc.balanceOf(user0.address);

    const tx = await orderbook.executeSwapOrder(user0.address, 0, executor.address);
    reportGasUsed(tx, "executeSwapOrder");

    const executorBalanceAfter = await user1.getBalance();
    expect(executorBalanceAfter, "executorBalanceAfter").to.be.equal(
      executorBalanceBefore.add(defaultExecutionFee),
    );

    const userBtcBalanceAfter = await btc.balanceOf(user0.address);
    expect(userBtcBalanceAfter.gt(userBtcBalanceBefore.add(minOut)), "userBtcBalanceAfter").to.be.true;

    const order = await getCreatedSwapOrder(user0.address, 0);
    expect(order.account).to.be.equal(constants.AddressZero);
  });

  it("executeSwapOrder, triggerAboveThreshold == true, USDG -> BTC", async () => {
    const triggerRatio = getTriggerRatio(toUsd(1), toUsd(62000));
    const amountIn = toWei(1000, 18);
    const path = [usdg.address, btc.address];
    const value = defaultExecutionFee;

    // minOut is not mandatory for such orders but with minOut it's possible to limit max price
    // e.g. user would not be happy if he sets order "buy if BTC > $65000" and order executes with $75000
    const minOut = await getMinOut(getTriggerRatio(toUsd(1), toUsd(63000)), path, amountIn);

    await orderbook
      .connect(user0)
      .createSwapOrder(path, amountIn, minOut, triggerRatio, true, defaultExecutionFee, false, true, {
        value: value,
      });
    const executor = user1;

    await expect(orderbook.executeSwapOrder(user0.address, 2, executor.address)).to.be.revertedWith(
      "OrderBook: non-existent order",
    );

    btcPriceFeed.setLatestAnswer(toChainlinkPrice(60500));
    await expect(orderbook.executeSwapOrder(user0.address, 0, executor.address)).to.be.revertedWith(
      "OrderBook: invalid price for execution",
    );

    btcPriceFeed.setLatestAnswer(toChainlinkPrice(70000));
    await expect(orderbook.executeSwapOrder(user0.address, 0, executor.address)).to.be.revertedWith(
      "OrderBook: insufficient amountOut",
    );

    btcPriceFeed.setLatestAnswer(toChainlinkPrice(62500));

    const executorBalanceBefore = await executor.getBalance();
    const userBtcBalanceBefore = await btc.balanceOf(user0.address);

    const tx = await orderbook.executeSwapOrder(user0.address, 0, executor.address);
    reportGasUsed(tx, "executeSwapOrder");

    const executorBalanceAfter = await user1.getBalance();
    expect(executorBalanceAfter, "executorBalanceAfter").to.be.equal(
      executorBalanceBefore.add(defaultExecutionFee),
    );

    const userBtcBalanceAfter = await btc.balanceOf(user0.address);
    expect(userBtcBalanceAfter.gt(userBtcBalanceBefore.add(minOut)), "userBtcBalanceAfter").to.be.true;

    const order = await getCreatedSwapOrder(user0.address, 0);
    expect(order.account).to.be.equal(constants.AddressZero);
  });

  it("executeSwapOrder, triggerAboveThreshold == true, USDG -> USDC -> BTC", async () => {
    const triggerRatio = getTriggerRatio(toUsd(1), toUsd(62000));
    const amountIn = toWei(1000, 18);
    const path = [usdg.address, usdc.address, btc.address];
    const value = defaultExecutionFee;

    // minOut is not mandatory for such orders but with minOut it's possible to limit max price
    // e.g. user would not be happy if he sets order "buy if BTC > $65000" and order executes with $75000
    const minOut = await getMinOut(getTriggerRatio(toUsd(1), toUsd(63000)), path, amountIn);

    await orderbook
      .connect(user0)
      .createSwapOrder(path, amountIn, minOut, triggerRatio, true, defaultExecutionFee, false, true, {
        value: value,
      });

    const executor = user1;

    await expect(orderbook.executeSwapOrder(user0.address, 2, executor.address)).to.be.revertedWith(
      "OrderBook: non-existent order",
    );

    btcPriceFeed.setLatestAnswer(toChainlinkPrice(60500));
    await expect(orderbook.executeSwapOrder(user0.address, 0, executor.address)).to.be.revertedWith(
      "OrderBook: invalid price for execution",
    );

    btcPriceFeed.setLatestAnswer(toChainlinkPrice(70000));
    await expect(orderbook.executeSwapOrder(user0.address, 0, executor.address)).to.be.revertedWith(
      "OrderBook: insufficient amountOut",
    );

    btcPriceFeed.setLatestAnswer(toChainlinkPrice(62500));

    const executorBalanceBefore = await executor.getBalance();
    const userBtcBalanceBefore = await btc.balanceOf(user0.address);

    const tx = await orderbook.executeSwapOrder(user0.address, 0, executor.address);
    reportGasUsed(tx, "executeSwapOrder");

    const executorBalanceAfter = await user1.getBalance();
    expect(executorBalanceAfter, "executorBalanceAfter").to.be.equal(
      executorBalanceBefore.add(defaultExecutionFee),
    );

    const userBtcBalanceAfter = await btc.balanceOf(user0.address);
    expect(userBtcBalanceAfter.gt(userBtcBalanceBefore.add(minOut)), "userBtcBalanceAfter").to.be.true;

    const order = await getCreatedSwapOrder(user0.address, 0);
    expect(order.account).to.be.equal(constants.AddressZero);
  });

  it("executeSwapOrder, triggerAboveThreshold == true, USDG -> AVAX -> BTC", async () => {
    const triggerRatio = getTriggerRatio(toUsd(1), toUsd(62000));
    const amountIn = toWei(1000, 18);
    const path = [usdg.address, avax.address, btc.address];
    const value = defaultExecutionFee;

    // minOut is not mandatory for such orders but with minOut it's possible to limit max price
    // e.g. user would not be happy if he sets order "buy if BTC > $65000" and order executes with $75000
    const minOut = await getMinOut(getTriggerRatio(toUsd(1), toUsd(63000)), path, amountIn);

    await orderbook
      .connect(user0)
      .createSwapOrder(path, amountIn, minOut, triggerRatio, true, defaultExecutionFee, false, true, {
        value: value,
      });

    const executor = user1;

    await expect(orderbook.executeSwapOrder(user0.address, 2, executor.address)).to.be.revertedWith(
      "OrderBook: non-existent order",
    );

    btcPriceFeed.setLatestAnswer(toChainlinkPrice(60500));
    await expect(orderbook.executeSwapOrder(user0.address, 0, executor.address)).to.be.revertedWith(
      "OrderBook: invalid price for execution",
    );

    btcPriceFeed.setLatestAnswer(toChainlinkPrice(70000));
    await expect(orderbook.executeSwapOrder(user0.address, 0, executor.address)).to.be.revertedWith(
      "OrderBook: insufficient amountOut",
    );

    btcPriceFeed.setLatestAnswer(toChainlinkPrice(62500));

    const executorBalanceBefore = await executor.getBalance();
    const userBtcBalanceBefore = await btc.balanceOf(user0.address);

    const tx = await orderbook.executeSwapOrder(user0.address, 0, executor.address);
    reportGasUsed(tx, "executeSwapOrder");

    const executorBalanceAfter = await user1.getBalance();
    expect(executorBalanceAfter, "executorBalanceAfter").to.be.equal(
      executorBalanceBefore.add(defaultExecutionFee),
    );

    const userBtcBalanceAfter = await btc.balanceOf(user0.address);
    expect(userBtcBalanceAfter.gt(userBtcBalanceBefore.add(minOut)), "userBtcBalanceAfter").to.be.true;

    const order = await getCreatedSwapOrder(user0.address, 0);
    expect(order.account).to.be.equal(constants.AddressZero);
  });

  it("executeSwapOrder, triggerAboveThreshold == true, BTC -> USDG", async () => {
    const triggerRatio = getTriggerRatio(toUsd(62000), toUsd(1));
    const amountIn = toWei(1, 6); // 0.01 BTC
    const path = [btc.address, usdg.address];
    const value = defaultExecutionFee;

    // minOut is not mandatory for such orders but with minOut it's possible to limit max price
    // e.g. user would not be happy if he sets order "buy if BTC > $65000" and order executes with $75000
    const minOut = await getMinOut(getTriggerRatio(toUsd(60000), toUsd(1)), path, amountIn);

    await orderbook
      .connect(user0)
      .createSwapOrder(path, amountIn, minOut, triggerRatio, true, defaultExecutionFee, false, true, {
        value: value,
      });

    const executor = user1;

    await expect(orderbook.executeSwapOrder(user0.address, 2, executor.address)).to.be.revertedWith(
      "OrderBook: non-existent order",
    );

    btcPriceFeed.setLatestAnswer(toChainlinkPrice(63000));
    await expect(orderbook.executeSwapOrder(user0.address, 0, executor.address)).to.be.revertedWith(
      "OrderBook: invalid price for execution",
    );

    btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));
    await expect(orderbook.executeSwapOrder(user0.address, 0, executor.address)).to.be.revertedWith(
      "OrderBook: insufficient amountOut",
    );

    btcPriceFeed.setLatestAnswer(toChainlinkPrice(61000));

    const executorBalanceBefore = await executor.getBalance();
    const userUsdgBalanceBefore = await usdg.balanceOf(user0.address);

    const tx = await orderbook.executeSwapOrder(user0.address, 0, executor.address);
    reportGasUsed(tx, "executeSwapOrder");

    const executorBalanceAfter = await user1.getBalance();
    expect(executorBalanceAfter, "executorBalanceAfter").to.be.equal(
      executorBalanceBefore.add(defaultExecutionFee),
    );

    const userUsdgBalanceAfter = await usdg.balanceOf(user0.address);
    expect(userUsdgBalanceAfter.gt(userUsdgBalanceBefore.add(minOut)), "userUsdgBalanceAfter").to.be.true;

    const order = await getCreatedSwapOrder(user0.address, 0);
    expect(order.account).to.be.equal(constants.AddressZero);
  });

  it("complex scenario", async () => {
    const triggerRatio1 = toUsd(BTC_PRICE + 2000)
      .mul(PRICE_PRECISION)
      .div(toUsd(1));
    const order1Index = 0;
    // buy BTC with USDC when BTC price goes up
    await orderbook
      .connect(user0)
      .createSwapOrder(
        [usdc.address, btc.address],
        toWei(1000, 6),
        0,
        triggerRatio1,
        true,
        defaultExecutionFee,
        false,
        true,
        { value: defaultExecutionFee },
      );

    // buy BTC with AVAX when BTC price goes up
    const triggerRatio2 = toUsd(BTC_PRICE - 5000)
      .mul(PRICE_PRECISION)
      .div(toUsd(AVAX_PRICE));
    const order2Index = 1;
    const amountIn = toWei(5, 18);
    const value = defaultExecutionFee.add(amountIn);
    const minOut = await getMinOut(triggerRatio2, [avax.address, btc.address], amountIn);
    await orderbook
      .connect(user0)
      .createSwapOrder(
        [avax.address, btc.address],
        amountIn,
        minOut,
        triggerRatio2,
        false,
        defaultExecutionFee,
        true,
        true,
        { value: value },
      );

    // buy BTC with AVAX when BTC price goes up
    const triggerRatio3 = toUsd(BTC_PRICE - 5000)
      .mul(PRICE_PRECISION)
      .div(toUsd(AVAX_PRICE));
    const order3Index = 2;
    await orderbook
      .connect(user0)
      .createSwapOrder(
        [usdc.address, btc.address],
        toWei(1000, 6),
        0,
        triggerRatio3,
        false,
        defaultExecutionFee,
        false,
        true,
        { value: defaultExecutionFee },
      );

    // try to execute order 1
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(BTC_PRICE + 1500));
    await expect(
      orderbook.executeSwapOrder(user0.address, order1Index, user1.address),
      "order1 revert",
    ).to.be.revertedWith("OrderBook: invalid price for execution");

    // update order 1
    const newTriggerRatio1 = toUsd(BTC_PRICE + 1000)
      .mul(PRICE_PRECISION)
      .div(toUsd(1));
    await orderbook.connect(user0).updateSwapOrder(order1Index, 0, newTriggerRatio1, true);
    let order1 = await getCreatedSwapOrder(user0.address, order1Index);
    expect(order1.triggerRatio, "order1 triggerRatio").to.be.equal(newTriggerRatio1);

    //  execute order 1
    await orderbook.executeSwapOrder(user0.address, order1Index, user1.address);
    order1 = await getCreatedSwapOrder(user0.address, order1Index);
    expect(order1.account, "order1 account").to.be.equal(constants.AddressZero);

    // cancel order 3
    const btcBalanceBefore = await btc.balanceOf(user0.address);
    await orderbook.connect(user0).cancelSwapOrder(order3Index);
    const order3 = await getCreatedSwapOrder(user0.address, order3Index);
    expect(order3.account, "order3 account").to.be.equal(constants.AddressZero);

    const btcBalanceAfter = await btc.balanceOf(user0.address);
    expect(btcBalanceAfter.gt(btcBalanceBefore.add(0)), "btcBalanceBefore");

    // try to execute order 2
    await expect(
      orderbook.executeSwapOrder(user0.address, order2Index, user1.address),
      "order2 revert",
    ).to.be.revertedWith("OrderBook: insufficient amountOut");

    // execute order 2
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(AVAX_PRICE + 100)); // BTC price decreased relative to AVAX
    await orderbook.executeSwapOrder(user0.address, order2Index, user1.address);
    const order2 = await getCreatedSwapOrder(user0.address, order2Index);
    expect(order2.account, "order2 account").to.be.equal(constants.AddressZero);
  });
});
