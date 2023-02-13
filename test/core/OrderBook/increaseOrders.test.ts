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
  PriceFeed,
} from "../../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { getTxFees, reportGasUsed, Ship, toChainlinkPrice, toUsd, toWei } from "../../../utils";
import {
  AVAX_PRICE,
  BTC_PRICE,
  defaultExecutionFee,
  defaultSizeDelta,
  defaultTriggerPrice,
  positionWrapper,
  validateOrderFields,
} from "./shared";
import { BigNumber, constants } from "ethers";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let orderbook: OrderBook;
let router: Router;
let vault: Vault;
let vaultPriceFeed: VaultPriceFeed;
let usdc: Token;
let btc: Token;
let btcPriceFeed: PriceFeed;
let avax: Token;

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

async function getCreatedIncreaseOrder(address: string, orderIndex = 0) {
  const order = await orderbook.increaseOrders(address, orderIndex);
  return order;
}

describe("OrderBook, increase position orders", function () {
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
    btc = (await ship.connect("btc")) as Token;
    btcPriceFeed = (await ship.connect("btcPriceFeed")) as PriceFeed;
    usdc = (await ship.connect("usdc")) as Token;
    avax = (await ship.connect("avax")) as Token;

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
  });

  /*
    checklist:
    create order
    - [x] revert if fee too low
    - [x] revert if fee != transferred AVAX (if not WETH)
    - [x] revert if fee + amountIn  != transferred AVAX (if WETH)
    - [x] transfer execution fee
    - [x] transfer token to OrderBook (if transfer token != WETH)
    - [x] transfer execution fee + amount with AVAX (if WETH)
    - [x] swap tokens if path.length > 1
    - [x] revert if path.length > 3
    - [x] revert if transferred collateral usd is too low
    - [x] create order with provided fields
    cancel order
    - [x] revert if order doesn't exist
    - [x] delete order
    - [x] transfer AVAX if WETH
    - [x] transfer AVAX and token if not WETH
    update
    - [x] revert if does not exist
    - [x] update all fields provided
    execute
    - [x] revert if does not exist
    - [x] revert if price invalid
        - [x] currentPrice < triggerPrice && triggerAboveThreshold is true
        - [x] currentPrice > triggerPrice && triggerAboveThreshold is false
    - [x] delete order
    - [x] open position
        - [x] position.collateral == order.collateral
        - [x] position.size == order.sizeDelta (if new)
        - [x] position.size == order.sizeDelta + positionBefore.size (if not new)
    - [x] pay fees to executor
    */

  it("createIncreaseOrder, bad input", async () => {
    const lowExecutionFee = 100;
    let counter = 0;
    await expect(
      orderbook.connect(user0).createIncreaseOrder(
        [btc.address],
        toWei(1, 8),
        btc.address,
        0,
        defaultSizeDelta,
        btc.address, // _collateralToken
        true,
        defaultTriggerPrice,
        true,
        lowExecutionFee,
        false,
        { value: lowExecutionFee },
      ),
      (counter++).toString(),
    ).to.be.revertedWith("OrderBook: insufficient execution fee");

    const goodExecutionFee = toWei(1, 8);
    await expect(
      orderbook.connect(user0).createIncreaseOrder(
        [btc.address],
        toWei(1, 8),
        btc.address,
        0,
        defaultSizeDelta,
        btc.address, // _collateralToken
        true,
        defaultTriggerPrice,
        true,
        goodExecutionFee,
        false,
        { value: goodExecutionFee.sub(1) },
      ),
      (counter++).toString(),
    ).to.be.revertedWith("OrderBook: incorrect execution fee transferred");

    await expect(
      orderbook.connect(user0).createIncreaseOrder(
        [btc.address],
        toWei(1, 8),
        btc.address,
        0,
        defaultSizeDelta,
        btc.address, // _collateralToken
        true,
        defaultTriggerPrice,
        true,
        goodExecutionFee,
        false,
        { value: goodExecutionFee.sub(1) },
      ),
      (counter++).toString(),
    ).to.be.revertedWith("OrderBook: incorrect execution fee transferred");

    await expect(
      orderbook.connect(user0).createIncreaseOrder(
        [avax.address],
        toWei(1, 8),
        avax.address,
        0,
        defaultSizeDelta,
        avax.address, // _collateralToken
        true,
        defaultTriggerPrice,
        true,
        goodExecutionFee,
        true,
        { value: toWei(10, 8).add(goodExecutionFee).sub(1) },
      ),
      (counter++).toString(),
    ).to.be.revertedWith("OrderBook: incorrect value transferred");

    await expect(
      orderbook.connect(user0).createIncreaseOrder(
        [btc.address],
        toWei(1, 8),
        btc.address,
        0,
        defaultSizeDelta,
        btc.address, // _collateralToken
        true,
        defaultTriggerPrice,
        true,
        goodExecutionFee,
        true,
        { value: toWei(10, 8).add(goodExecutionFee) },
      ),
      (counter++).toString(),
    ).to.be.revertedWith("OrderBook: only weth could be wrapped");

    await expect(
      orderbook.connect(user0).createIncreaseOrder(
        [avax.address],
        toWei(10, 8),
        avax.address,
        0,
        defaultSizeDelta,
        avax.address, // _collateralToken
        true,
        defaultTriggerPrice,
        true,
        goodExecutionFee,
        false,
        { value: toWei(10, 8).add(goodExecutionFee) },
      ),
      (counter++).toString(),
    ).to.be.revertedWith("OrderBook: incorrect execution fee transferred");

    await expect(
      orderbook.connect(user0).createIncreaseOrder(
        [usdc.address],
        toWei(4, 6),
        usdc.address,
        0,
        defaultSizeDelta,
        usdc.address, // _collateralToken
        true,
        defaultTriggerPrice,
        true,
        defaultExecutionFee,
        false,
        { value: defaultExecutionFee },
      ),
      (counter++).toString(),
    ).to.be.revertedWith("OrderBook: insufficient collateral");

    await expect(
      orderbook.connect(user0).createIncreaseOrder(
        [usdc.address, btc.address, avax.address, btc.address],
        toWei(4, 6),
        btc.address,
        0,
        defaultSizeDelta,
        btc.address, // _collateralToken
        true,
        defaultTriggerPrice,
        true,
        defaultExecutionFee,
        false,
        { value: defaultExecutionFee },
      ),
      (counter++).toString(),
    ).to.be.revertedWith("OrderBook: invalid _path.length");
  });

  it("createIncreaseOrder, two orders", async () => {
    const sizeDelta1 = toUsd(40000);
    await orderbook.connect(user0).createIncreaseOrder(
      [btc.address],
      toWei(1, 8).div(10),
      btc.address,
      0,
      sizeDelta1,
      btc.address, // _collateralToken
      true,
      defaultTriggerPrice,
      true,
      defaultExecutionFee,
      false,
      { value: defaultExecutionFee },
    );

    const sizeDelta2 = toUsd(50000);
    orderbook.connect(user0).createIncreaseOrder(
      [btc.address],
      toWei(1, 8).div(10),
      btc.address,
      0,
      sizeDelta2,
      btc.address, // _collateralToken
      true,
      defaultTriggerPrice,
      true,
      defaultExecutionFee,
      false,
      { value: defaultExecutionFee },
    );

    const order1 = await getCreatedIncreaseOrder(user0.address, 0);
    const order2 = await getCreatedIncreaseOrder(user0.address, 1);

    expect(order1.sizeDelta).to.be.equal(sizeDelta1);
    expect(order2.sizeDelta).to.be.equal(sizeDelta2);
  });

  it("createIncreaseOrder, pay WETH", async () => {
    const avaxBalanceBefore = await avax.balanceOf(orderbook.address);
    const amountIn = toWei(30, 18);
    const value = defaultExecutionFee;
    const tx = await orderbook.connect(user0).createIncreaseOrder(
      [avax.address],
      amountIn,
      avax.address,
      0,
      defaultSizeDelta,
      avax.address, // _collateralToken
      true,
      defaultTriggerPrice,
      true,
      defaultExecutionFee,
      false,
      { value: value },
    );

    reportGasUsed(tx, "createIncreaseOrder gas used");

    const order = await getCreatedIncreaseOrder(user0.address);
    const avaxBalanceAfter = await avax.balanceOf(orderbook.address);

    const avaxBalanceDiff = avaxBalanceAfter.sub(avaxBalanceBefore);
    expect(avaxBalanceDiff, "AVAX balance").to.be.equal(amountIn.add(defaultExecutionFee));

    validateOrderFields(order, {
      account: user0.address,
      purchaseToken: avax.address,
      purchaseTokenAmount: amountIn,
      indexToken: avax.address,
      sizeDelta: defaultSizeDelta,
      isLong: true,
      triggerPrice: defaultTriggerPrice,
      triggerAboveThreshold: true,
      executionFee: defaultExecutionFee,
    });
  });

  it("createIncreaseOrder, pay AVAX", async () => {
    const avaxBalanceBefore = await avax.balanceOf(orderbook.address);
    const amountIn = toWei(30, 18);
    const value = defaultExecutionFee.add(amountIn);
    const tx = await orderbook.connect(user0).createIncreaseOrder(
      [avax.address],
      amountIn,
      btc.address,
      0,
      defaultSizeDelta,
      avax.address, // _collateralToken
      true,
      defaultTriggerPrice,
      true,
      defaultExecutionFee,
      true,
      { value: value },
    );

    reportGasUsed(tx, "createIncreaseOrder gas used");

    const order = await getCreatedIncreaseOrder(user0.address);
    const avaxBalanceAfter = await avax.balanceOf(orderbook.address);

    const avaxBalanceDiff = avaxBalanceAfter.sub(avaxBalanceBefore);
    expect(avaxBalanceDiff, "AVAX balance").to.be.equal(amountIn.add(defaultExecutionFee));

    validateOrderFields(order, {
      account: user0.address,
      purchaseToken: avax.address,
      purchaseTokenAmount: amountIn,
      indexToken: btc.address,
      sizeDelta: defaultSizeDelta,
      isLong: true,
      triggerPrice: defaultTriggerPrice,
      triggerAboveThreshold: true,
      executionFee: defaultExecutionFee,
    });
  });

  it("createIncreaseOrder, long A, transfer and purchase A", async () => {
    const btcBalanceBefore = await btc.balanceOf(orderbook.address);
    const tx = await orderbook.connect(user0).createIncreaseOrder(
      [btc.address],
      toWei(1, 8),
      btc.address,
      0,
      defaultSizeDelta,
      btc.address, // _collateralToken
      true,
      defaultTriggerPrice,
      true,
      defaultExecutionFee,
      false,
      { value: defaultExecutionFee },
    );
    reportGasUsed(tx, "createIncreaseOrder gas used");

    const order = await getCreatedIncreaseOrder(user0.address);
    const btcBalanceAfter = await btc.balanceOf(orderbook.address);

    expect(await avax.balanceOf(orderbook.address), "AVAX balance").to.be.equal(defaultExecutionFee);
    expect(btcBalanceAfter.sub(btcBalanceBefore), "BTC balance").to.be.equal(toWei(1, 8));

    validateOrderFields(order, {
      account: user0.address,
      purchaseToken: btc.address,
      purchaseTokenAmount: toWei(1, 8),
      indexToken: btc.address,
      sizeDelta: defaultSizeDelta,
      isLong: true,
      triggerPrice: defaultTriggerPrice,
      triggerAboveThreshold: true,
      executionFee: defaultExecutionFee,
    });
  });

  it("createIncreaseOrder, long A, transfer A, purchase B", async () => {
    const usdcBalanceBefore = await usdc.balanceOf(orderbook.address);
    const tx = await orderbook.connect(user0).createIncreaseOrder(
      [btc.address, usdc.address],
      toWei(1, 8),
      btc.address,
      0,
      defaultSizeDelta,
      usdc.address, // _collateralToken
      true,
      defaultTriggerPrice,
      true,
      defaultExecutionFee,
      false,
      { value: defaultExecutionFee },
    );
    reportGasUsed(tx, "createIncreaseOrder gas used");
    const usdcBalanceAfter = await usdc.balanceOf(orderbook.address);
    const order = await getCreatedIncreaseOrder(user0.address);

    expect(await avax.balanceOf(orderbook.address), "AVAX balance").to.be.equal(defaultExecutionFee);
    expect(usdcBalanceAfter, "usdcBalanceAfter").to.be.equal(usdcBalanceBefore.add("59880000000"));

    validateOrderFields(order, {
      account: user0.address,
      purchaseToken: usdc.address,
      indexToken: btc.address,
      sizeDelta: defaultSizeDelta,
      isLong: true,
      triggerPrice: defaultTriggerPrice,
      triggerAboveThreshold: true,
      executionFee: defaultExecutionFee,
      purchaseTokenAmount: "59880000000",
    });
  });

  it("createIncreaseOrder, short A, transfer B, purchase B", async () => {
    const usdcBalanceBefore = await usdc.balanceOf(orderbook.address);
    const amountIn = toWei(30000, 6);
    const tx = await orderbook.connect(user0).createIncreaseOrder(
      [usdc.address],
      amountIn,
      btc.address,
      0,
      defaultSizeDelta,
      btc.address, // _collateralToken
      false,
      defaultTriggerPrice,
      true,
      defaultExecutionFee,
      false,
      { value: defaultExecutionFee },
    );
    reportGasUsed(tx, "createIncreaseOrder gas used");
    const usdcBalanceAfter = await usdc.balanceOf(orderbook.address);

    const order = await getCreatedIncreaseOrder(user0.address);
    expect(await avax.balanceOf(orderbook.address)).to.be.equal(defaultExecutionFee);
    expect(usdcBalanceAfter.sub(usdcBalanceBefore), "usdcBalanceAfter").to.be.equal(amountIn);

    validateOrderFields(order, {
      account: user0.address,
      purchaseToken: usdc.address,
      indexToken: btc.address,
      sizeDelta: defaultSizeDelta,
      isLong: false,
      triggerPrice: defaultTriggerPrice,
      triggerAboveThreshold: true,
      executionFee: defaultExecutionFee,
    });
  });

  it("createIncreaseOrder, short A, transfer A, purchase B", async () => {
    const usdcBalanceBefore = await usdc.balanceOf(orderbook.address);
    const tx = await orderbook.connect(user0).createIncreaseOrder(
      [btc.address, usdc.address],
      toWei(1, 8),
      btc.address,
      0,
      defaultSizeDelta,
      btc.address, // _collateralToken
      false,
      defaultTriggerPrice,
      true,
      defaultExecutionFee,
      false,
      { value: defaultExecutionFee },
    );
    reportGasUsed(tx, "createIncreaseOrder gas used");
    const usdcBalanceAfter = await usdc.balanceOf(orderbook.address);

    const order = await getCreatedIncreaseOrder(user0.address);

    expect(await avax.balanceOf(orderbook.address)).to.be.equal(defaultExecutionFee);
    expect(usdcBalanceAfter).to.be.equal(usdcBalanceBefore.add("59880000000"));

    validateOrderFields(order, {
      account: user0.address,
      purchaseToken: usdc.address,
      indexToken: btc.address,
      sizeDelta: defaultSizeDelta,
      isLong: false,
      triggerPrice: defaultTriggerPrice,
      triggerAboveThreshold: true,
      executionFee: defaultExecutionFee,
    });
    expect(order.purchaseTokenAmount).to.be.equal("59880000000");
  });

  it("updateIncreaseOrder", async () => {
    orderbook.connect(user0).createIncreaseOrder(
      [btc.address],
      toWei(1, 8),
      btc.address,
      0,
      defaultSizeDelta,
      btc.address, // _collateralToken
      true,
      defaultTriggerPrice,
      true,
      defaultExecutionFee,
      false,
      { value: defaultExecutionFee },
    );

    const newSizeDelta = defaultSizeDelta.add(100);
    const newTriggerPrice = defaultTriggerPrice.add(100);
    const newTriggerAboveThreshold = false;

    await expect(
      orderbook
        .connect(user1)
        .updateIncreaseOrder(0, newSizeDelta, newTriggerPrice, newTriggerAboveThreshold),
    ).to.be.revertedWith("OrderBook: non-existent order");

    const tx = await orderbook
      .connect(user0)
      .updateIncreaseOrder(0, newSizeDelta, newTriggerPrice, newTriggerAboveThreshold);
    reportGasUsed(tx, "updateIncreaseOrder gas used");

    const order = await getCreatedIncreaseOrder(user0.address);

    validateOrderFields(order, {
      sizeDelta: newSizeDelta,
      triggerPrice: newTriggerPrice,
      triggerAboveThreshold: newTriggerAboveThreshold,
    });
  });

  it("cancelOrder", async () => {
    const avaxBalanceBefore = await user0.getBalance();
    const tokenBalanceBefore = await btc.balanceOf(user0.address);
    const tx = await orderbook.connect(user0).createIncreaseOrder(
      [btc.address],
      toWei(1, 8),
      btc.address,
      0,
      defaultSizeDelta,
      btc.address, // _collateralToken
      true,
      defaultTriggerPrice,
      true,
      defaultExecutionFee,
      false,
      { value: defaultExecutionFee },
    );
    let txFees = await getTxFees(tx);

    await expect(orderbook.connect(user1).cancelIncreaseOrder(0)).to.be.revertedWith(
      "OrderBook: non-existent order",
    );

    const tx2 = await orderbook.connect(user0).cancelIncreaseOrder(0);
    reportGasUsed(tx2, "cancelIncreaseOrder gas used");

    txFees = txFees.add(await getTxFees(tx2));
    const avaxBalanceAfter = await user0.getBalance();
    expect(avaxBalanceAfter, "avaxBalanceAfter").to.be.equal(avaxBalanceBefore.sub(txFees));

    const tokenBalanceAfter = await btc.balanceOf(user0.address);
    expect(tokenBalanceAfter, "tokenBalanceAfter").to.be.equal(tokenBalanceBefore);

    const order = await getCreatedIncreaseOrder(user0.address);
    expect(order.account).to.be.equal(constants.AddressZero);
  });

  it("cancelOrder, pay AVAX", async () => {
    const balanceBefore = await user0.getBalance();
    const avaxBalanceBefore = await avax.balanceOf(orderbook.address);
    const amountIn = toWei(30, 18);
    const value = defaultExecutionFee.add(amountIn);
    const tx = await orderbook.connect(user0).createIncreaseOrder(
      [avax.address],
      amountIn,
      btc.address,
      0,
      defaultSizeDelta,
      btc.address, // _collateralToken
      true,
      defaultTriggerPrice,
      true,
      defaultExecutionFee,
      true,
      { value: value },
    );
    let txFees = await getTxFees(tx);

    await expect(orderbook.connect(user1).cancelIncreaseOrder(0)).to.be.revertedWith(
      "OrderBook: non-existent order",
    );

    const tx2 = await orderbook.connect(user0).cancelIncreaseOrder(0);
    reportGasUsed(tx2, "cancelIncreaseOrder gas used");
    txFees = txFees.add(await getTxFees(tx2));

    const balanceAfter = await user0.getBalance();
    expect(balanceAfter, "balanceAfter").to.be.equal(balanceBefore.sub(txFees));

    const order = await getCreatedIncreaseOrder(user0.address);
    expect(order.account).to.be.equal(constants.AddressZero);
  });

  it("executeOrder, non-existent order", async () => {
    await expect(orderbook.executeIncreaseOrder(user2.address, 0, user1.address)).to.be.revertedWith(
      "OrderBook: non-existent order",
    );
  });

  it("executeOrder, current price is invalid", async () => {
    let triggerPrice, isLong, triggerAboveThreshold, newBtcPrice;
    let orderIndex = 0;

    // increase long should use max price
    // increase short should use min price
    for (const [triggerPrice, isLong, collateralToken, triggerAboveThreshold, newBtcPrice, setPriceTwice] of [
      [toWei(BTC_PRICE - 1000, 30), true, btc.address, false, BTC_PRICE - 1050, true],
      [toWei(BTC_PRICE + 1000, 30), true, btc.address, true, BTC_PRICE + 1050, false],
      [toWei(BTC_PRICE - 1000, 30), false, usdc.address, false, BTC_PRICE - 1050, false],
      [toWei(BTC_PRICE + 1000, 30), false, usdc.address, true, BTC_PRICE + 1050, true],
    ]) {
      await vaultPriceFeed.setPriceSampleSpace(2);

      // "reset" BTC price
      await btcPriceFeed.setLatestAnswer(toChainlinkPrice(BTC_PRICE));
      await btcPriceFeed.setLatestAnswer(toChainlinkPrice(BTC_PRICE));

      await orderbook.connect(user0).createIncreaseOrder(
        [btc.address],
        toWei(1, 8),
        btc.address,
        0,
        defaultSizeDelta,
        collateralToken as string, // _collateralToken
        isLong as boolean,
        triggerPrice as BigNumber,
        triggerAboveThreshold as boolean,
        defaultExecutionFee,
        false,
        { value: defaultExecutionFee },
      );
      const order = await orderbook.increaseOrders(user0.address, orderIndex);
      await expect(
        orderbook.executeIncreaseOrder(order.account, orderIndex, user1.address),
      ).to.be.revertedWith("OrderBook: invalid price for execution");

      if (setPriceTwice) {
        // in this case on first price order is still non-executable because of current price
        btcPriceFeed.setLatestAnswer(toChainlinkPrice(newBtcPrice as number));
        await expect(
          orderbook.executeIncreaseOrder(order.account, orderIndex, user1.address),
        ).to.be.revertedWith("OrderBook: invalid price for execution");
      }

      // now both min and max prices satisfies requirement
      btcPriceFeed.setLatestAnswer(toChainlinkPrice(newBtcPrice as number));
      await orderbook.executeIncreaseOrder(order.account, orderIndex, user1.address);

      orderIndex++;
    }
  });

  it("executeOrder, long, purchase token same as collateral", async () => {
    await orderbook.connect(user0).createIncreaseOrder(
      [btc.address],
      toWei(1, 8),
      btc.address,
      0,
      defaultSizeDelta,
      btc.address, // _collateralToken
      true,
      defaultTriggerPrice,
      true,
      defaultExecutionFee,
      false,
      { value: defaultExecutionFee },
    );

    const order = await orderbook.increaseOrders(user0.address, 0);

    const executorBalanceBefore = await user1.getBalance();
    const tx = await orderbook.executeIncreaseOrder(user0.address, 0, user1.address);
    reportGasUsed(tx, "executeIncreaseOrder gas used");

    const executorBalanceAfter = await user1.getBalance();
    expect(executorBalanceAfter).to.be.equal(executorBalanceBefore.add(defaultExecutionFee));

    const position = positionWrapper(await vault.getPosition(user0.address, btc.address, btc.address, true));
    expect(position.collateral).to.be.equal("59900000000000000000000000000000000");
    expect(position.size).to.be.equal(order.sizeDelta);

    const orderAfter = await orderbook.increaseOrders(user0.address, 0);
    expect(orderAfter.account).to.be.equal(constants.AddressZero);
  });

  it("executOrder, 2 orders with the same position", async () => {
    await orderbook.connect(user0).createIncreaseOrder(
      [btc.address],
      toWei(1, 8),
      btc.address,
      0,
      defaultSizeDelta,
      btc.address, // _collateralToken
      true,
      defaultTriggerPrice,
      true,
      defaultExecutionFee,
      false,
      { value: defaultExecutionFee },
    );

    await orderbook.executeIncreaseOrder(user0.address, 0, user1.address);
    let position = positionWrapper(await vault.getPosition(user0.address, btc.address, btc.address, true));
    expect(position.collateral).to.be.equal("59900000000000000000000000000000000");
    expect(position.size).to.be.equal(defaultSizeDelta);

    await orderbook.connect(user0).createIncreaseOrder(
      [btc.address],
      toWei(1, 8),
      btc.address,
      0,
      defaultSizeDelta,
      btc.address, // _collateralToken
      true,
      defaultTriggerPrice,
      true,
      defaultExecutionFee,
      false,
      { value: defaultExecutionFee },
    );

    await orderbook.executeIncreaseOrder(user0.address, 1, user1.address);
    position = positionWrapper(await vault.getPosition(user0.address, btc.address, btc.address, true));
    expect(position.collateral).to.be.equal("119800000000000000000000000000000000");
    expect(position.size).to.be.equal(defaultSizeDelta.mul(2));
  });

  it("executeOrder, long, swap purchase token to collateral", async () => {
    await orderbook.connect(user0).createIncreaseOrder(
      [usdc.address],
      toWei(50000, 6),
      btc.address,
      0,
      defaultSizeDelta,
      btc.address, // _collateralToken
      true,
      defaultTriggerPrice,
      true,
      defaultExecutionFee,
      false,
      { value: defaultExecutionFee },
    );

    const executorBalanceBefore = await user1.getBalance();
    const order = await orderbook.increaseOrders(user0.address, 0);
    const tx = await orderbook.executeIncreaseOrder(user0.address, 0, user1.address);
    reportGasUsed(tx, "executeIncreaseOrder gas used");

    const executorBalanceAfter = await user1.getBalance();
    expect(executorBalanceAfter).to.be.equal(executorBalanceBefore.add(defaultExecutionFee));

    const position = positionWrapper(await vault.getPosition(user0.address, btc.address, btc.address, true));
    expect(position.size, "size").to.be.equal(order.sizeDelta);
    expect(position.collateral, "collateral").to.be.equal("49799979800000000000000000000000000");

    const orderAfter = await orderbook.increaseOrders(user0.address, 0);
    expect(orderAfter.account).to.be.equal(constants.AddressZero);
  });

  it("executeOrder, short, purchase token same as collateral", async () => {
    usdc.mint(user0.address, toWei(50000, 18));
    await orderbook.connect(user0).createIncreaseOrder(
      [usdc.address],
      toWei(50000, 6),
      btc.address,
      0,
      defaultSizeDelta,
      usdc.address, // _collateralToken
      false,
      toWei(BTC_PRICE - 100, 30),
      true,
      defaultExecutionFee,
      false,
      { value: defaultExecutionFee },
    );

    const executorBalanceBefore = await user1.getBalance();

    const order = await orderbook.increaseOrders(user0.address, 0);
    const tx = await orderbook.executeIncreaseOrder(user0.address, 0, user1.address);
    reportGasUsed(tx, "executeIncreaseOrder gas used");

    const executorBalanceAfter = await user1.getBalance();
    expect(executorBalanceAfter).to.be.equal(executorBalanceBefore.add(defaultExecutionFee));

    const position = positionWrapper(
      await vault.getPosition(user0.address, usdc.address, btc.address, false),
    );
    expect(position.collateral).to.be.equal("49900000000000000000000000000000000");
    expect(position.size, "position.size").to.be.equal(order.sizeDelta);

    const orderAfter = await orderbook.increaseOrders(user0.address, 0);
    expect(orderAfter.account).to.be.equal(constants.AddressZero);
  });

  it("executeOrder, short, swap purchase token to collateral", async () => {
    await orderbook.connect(user0).createIncreaseOrder(
      [btc.address],
      toWei(1, 8),
      btc.address,
      0,
      defaultSizeDelta,
      usdc.address, // _collateralToken
      false,
      toWei(BTC_PRICE - 100, 30),
      true,
      defaultExecutionFee,
      false,
      { value: defaultExecutionFee },
    );

    const executorBalanceBefore = await user1.getBalance();

    const order = await orderbook.increaseOrders(user0.address, 0);
    const tx = await orderbook.executeIncreaseOrder(user0.address, 0, user1.address);
    reportGasUsed(tx, "executeIncreaseOrder gas used");

    const position = positionWrapper(
      await vault.getPosition(user0.address, usdc.address, btc.address, false),
    );
    expect(position.collateral).to.be.equal("59780000000000000000000000000000000");
    expect(position.size, "position.size").to.be.equal(order.sizeDelta);

    const executorBalanceAfter = await user1.getBalance();
    expect(executorBalanceAfter).to.be.equal(executorBalanceBefore.add(defaultExecutionFee));

    const orderAfter = await orderbook.increaseOrders(user0.address, 0);
    expect(orderAfter.account).to.be.equal(constants.AddressZero);
  });

  it("executeOrder, short, pay AVAX, no swap", async () => {
    const amountIn = toWei(50, 18);
    const value = defaultExecutionFee.add(amountIn);
    await orderbook.connect(user0).createIncreaseOrder(
      [avax.address],
      amountIn,
      avax.address,
      0,
      defaultSizeDelta,
      usdc.address, // _collateralToken
      false,
      toWei(AVAX_PRICE - 10, 30),
      true,
      defaultExecutionFee,
      true,
      { value: value },
    );
    const order = await orderbook.increaseOrders(user0.address, 0);
    const tx = await orderbook.executeIncreaseOrder(user0.address, 0, user1.address);
    reportGasUsed(tx, "executeIncreaseOrder gas used");

    const position = positionWrapper(
      await vault.getPosition(user0.address, usdc.address, avax.address, false),
    );
    expect(position.collateral).to.be.equal("14870000000000000000000000000000000");
    expect(position.size, "position.size").to.be.equal(order.sizeDelta);

    const orderAfter = await orderbook.increaseOrders(user0.address, 0);
    expect(orderAfter.account).to.be.equal(constants.AddressZero);
  });

  it("createIncreaseOrder, bad path", async () => {
    await expect(
      orderbook.connect(user0).createIncreaseOrder(
        [btc.address, btc.address],
        toWei(1, 8),
        btc.address,
        0,
        defaultSizeDelta,
        btc.address, // _collateralToken
        true,
        defaultTriggerPrice,
        true,
        defaultExecutionFee,
        false,
        { value: defaultExecutionFee },
      ),
    ).to.be.revertedWith("OrderBook: invalid _path");
  });
});
