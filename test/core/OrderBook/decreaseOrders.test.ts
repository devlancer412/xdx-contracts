import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  OrderBook__factory,
  OrderBook,
  Router__factory,
  VaultPriceFeed__factory,
  Token,
  Vault__factory,
  USDG,
  USDG__factory,
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
  BTC_PRICE,
  defaultCollateralDelta,
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
let user3: SignerWithAddress;

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

async function getCreatedDecreaseOrder(address: string, orderIndex = 0) {
  const order = await orderbook.decreaseOrders(address, orderIndex);
  return order;
}

describe("OrderBook, decrease position orders", function () {
  beforeEach(async function () {
    const { accounts, users } = await setup();

    deployer = accounts.deployer;
    user0 = users[0];
    user1 = users[1];
    user2 = users[2];
    user3 = users[3];

    orderbook = await ship.connect(OrderBook__factory);
    router = await ship.connect(Router__factory);
    vault = await ship.connect(Vault__factory);
    vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
    btc = (await ship.connect("btc")) as Token;
    btcPriceFeed = (await ship.connect("btcPriceFeed")) as PriceFeed;
    usdc = (await ship.connect("usdc")) as Token;
    avax = (await ship.connect("avax")) as Token;

    const usdg = await ship.connect(USDG__factory);

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
    [x] create order, low execution fee => revert
    [x] create order, transferred ETH != execution fee => revert
    [x] create order, order is retrievable
    [x] executionFee transferred to OrderBook
    [x] cancel order, delete order
    [x] and user got back execution fee
    [x] if cancelling order doesnt not exist => revert
    [x] update order, all fields are new
    [x] if user doesn't have such order => revert
    [x] two orders retreivable
    [x] execute order, if doesnt exist => revert
    [x] if price is not valid => revert
    [x] delete order
    [x] position was decreased
    [x] if collateral is weth => transfer AVAX funds
    [x] otherwise transfer token
    [x] and transfer executionFee
    [x] partial decrease
  */

  it("Create decrase order, bad fee", async () => {
    await expect(
      orderbook
        .connect(user0)
        .createDecreaseOrder(
          btc.address,
          defaultSizeDelta,
          btc.address,
          toUsd(BTC_PRICE),
          true,
          defaultTriggerPrice,
          true,
          {
            value: 100,
          },
        ),
    ).to.be.revertedWith("OrderBook: insufficient execution fee");
  });

  it("Create decrease order, long", async () => {
    const tx = await orderbook
      .connect(user0)
      .createDecreaseOrder(
        btc.address,
        defaultSizeDelta,
        btc.address,
        defaultCollateralDelta,
        true,
        defaultTriggerPrice,
        true,
        {
          value: defaultExecutionFee,
        },
      );
    reportGasUsed(tx, "createDecraseOrder gas used");
    const order = await getCreatedDecreaseOrder(user0.address);

    expect(await avax.balanceOf(orderbook.address), "AVAX balance").to.be.equal(defaultExecutionFee);

    validateOrderFields(order, {
      account: user0.address,
      indexToken: btc.address,
      sizeDelta: defaultSizeDelta,
      collateralToken: btc.address,
      collateralDelta: defaultCollateralDelta,
      isLong: true,
      triggerPrice: defaultTriggerPrice,
      triggerAboveThreshold: true,
      executionFee: defaultExecutionFee,
    });
  });

  it("updateDecreaseOrder", async () => {
    const tx = await orderbook
      .connect(user0)
      .createDecreaseOrder(
        btc.address,
        defaultSizeDelta,
        btc.address,
        defaultCollateralDelta,
        true,
        defaultTriggerPrice,
        true,
        {
          value: defaultExecutionFee,
        },
      );

    const newSizeDelta = defaultSizeDelta.add(100);
    const newTriggerPrice = defaultTriggerPrice.add(100);
    const newTriggerAboveThreshold = false;
    const newCollateralDelta = defaultCollateralDelta.add(100);

    await expect(
      orderbook
        .connect(user1)
        .updateDecreaseOrder(0, newCollateralDelta, newSizeDelta, newTriggerPrice, newTriggerAboveThreshold),
    ).to.be.revertedWith("OrderBook: non-existent order");

    const tx2 = await orderbook
      .connect(user0)
      .updateDecreaseOrder(0, newCollateralDelta, newSizeDelta, newTriggerPrice, newTriggerAboveThreshold);
    reportGasUsed(tx2, "updateDecreaseOrder gas used");

    const order = await getCreatedDecreaseOrder(user0.address);

    validateOrderFields(order, {
      sizeDelta: newSizeDelta,
      collateralDelta: newCollateralDelta,
      triggerPrice: newTriggerPrice,
      triggerAboveThreshold: newTriggerAboveThreshold,
    });
  });

  it("Create decrease order, short", async () => {
    const tx = await orderbook
      .connect(user0)
      .createDecreaseOrder(
        btc.address,
        defaultSizeDelta,
        btc.address,
        defaultCollateralDelta,
        false,
        defaultTriggerPrice,
        true,
        {
          value: defaultExecutionFee,
        },
      );
    reportGasUsed(tx, "createDecreaseOrder gas used");
    const order = await getCreatedDecreaseOrder(user0.address);
    const btcBalanceAfter = await btc.balanceOf(orderbook.address);

    expect(await avax.balanceOf(orderbook.address), "AVAX balance").to.be.equal(defaultExecutionFee);

    validateOrderFields(order, {
      account: user0.address,
      indexToken: btc.address,
      sizeDelta: defaultSizeDelta,
      collateralToken: btc.address,
      collateralDelta: defaultCollateralDelta,
      isLong: false,
      triggerPrice: defaultTriggerPrice,
      triggerAboveThreshold: true,
      executionFee: defaultExecutionFee,
    });
  });

  it("Create two orders", async () => {
    await orderbook
      .connect(user0)
      .createDecreaseOrder(
        btc.address,
        toUsd(1),
        btc.address,
        defaultCollateralDelta,
        true,
        defaultTriggerPrice,
        true,
        {
          value: defaultExecutionFee,
        },
      );
    await orderbook
      .connect(user0)
      .createDecreaseOrder(
        btc.address,
        toUsd(2),
        btc.address,
        defaultCollateralDelta,
        true,
        defaultTriggerPrice,
        true,
        {
          value: defaultExecutionFee,
        },
      );

    const order1 = await getCreatedDecreaseOrder(user0.address, 0);
    const order2 = await getCreatedDecreaseOrder(user0.address, 1);

    expect(order1.sizeDelta).to.be.equal(toUsd(1));
    expect(order2.sizeDelta).to.be.equal(toUsd(2));
  });

  it("Execute decrease order, invalid price", async () => {
    await vaultPriceFeed.setPriceSampleSpace(2);
    let triggerPrice, isLong, triggerAboveThreshold, newBtcPrice;
    let orderIndex = 0;

    // decrease long should use min price
    // decrease short should use max price
    for (const [triggerPrice, isLong, triggerAboveThreshold, newBtcPrice, setPriceTwice] of [
      [toWei(BTC_PRICE - 1000, 30), true, false, BTC_PRICE - 1050, false],
      [toWei(BTC_PRICE + 1000, 30), true, true, BTC_PRICE + 1050, true],
      [toWei(BTC_PRICE - 1000, 30), false, false, BTC_PRICE - 1050, true],
      [toWei(BTC_PRICE + 1000, 30), false, true, BTC_PRICE + 1050, false],
    ]) {
      // "reset" BTC price
      await btcPriceFeed.setLatestAnswer(toChainlinkPrice(BTC_PRICE));
      await btcPriceFeed.setLatestAnswer(toChainlinkPrice(BTC_PRICE));

      await orderbook
        .connect(user0)
        .createDecreaseOrder(
          btc.address,
          defaultSizeDelta,
          btc.address,
          defaultCollateralDelta,
          isLong as boolean,
          triggerPrice as BigNumber,
          triggerAboveThreshold as boolean,
          {
            value: defaultExecutionFee,
          },
        );

      const order = await orderbook.decreaseOrders(user0.address, orderIndex);
      await expect(
        orderbook.executeDecreaseOrder(order.account, orderIndex, user1.address),
        "1",
      ).to.be.revertedWith("OrderBook: invalid price for execution");

      if (setPriceTwice) {
        // on first price update all limit orders are still invalid
        btcPriceFeed.setLatestAnswer(toChainlinkPrice(newBtcPrice as number));
        await expect(
          orderbook.executeDecreaseOrder(order.account, orderIndex, user1.address),
          "2",
        ).to.be.revertedWith("OrderBook: invalid price for execution");
      }

      // now both min and max prices satisfies requirement
      btcPriceFeed.setLatestAnswer(toChainlinkPrice(newBtcPrice as number));
      await expect(
        orderbook.executeDecreaseOrder(order.account, orderIndex, user1.address),
        "3",
      ).to.not.be.revertedWith("OrderBook: invalid price for execution");
      // so we are sure we passed price validations inside OrderBook

      orderIndex++;
    }
  });

  it("Execute decrease order, non-existent", async () => {
    await orderbook
      .connect(user0)
      .createDecreaseOrder(
        btc.address,
        defaultSizeDelta,
        btc.address,
        defaultCollateralDelta,
        true,
        toUsd(BTC_PRICE - 1000),
        false,
        {
          value: defaultExecutionFee,
        },
      );

    await expect(orderbook.executeDecreaseOrder(user0.address, 1, user1.address)).to.be.revertedWith(
      "OrderBook: non-existent order",
    );
  });

  it("Execute decrease order, long", async () => {
    await btc.connect(user0).transfer(vault.address, toWei(10000, 8).div(BTC_PRICE));
    await vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(20000), true);

    const btcBalanceBefore = await btc.balanceOf(user0.address);
    let position = positionWrapper(await vault.getPosition(user0.address, btc.address, btc.address, true));

    await orderbook
      .connect(user0)
      .createDecreaseOrder(
        btc.address,
        position.size,
        btc.address,
        position.collateral,
        true,
        toUsd(BTC_PRICE + 5000),
        true,
        {
          value: defaultExecutionFee,
        },
      );

    const order = await orderbook.decreaseOrders(user0.address, 0);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(BTC_PRICE + 5050));

    const executorBalanceBefore = await user1.getBalance();
    const tx = await orderbook.executeDecreaseOrder(user0.address, 0, user1.address);
    reportGasUsed(tx, "executeDecreaseOrder gas used");

    const executorBalanceAfter = await user1.getBalance();
    expect(executorBalanceAfter).to.be.equal(executorBalanceBefore.add(defaultExecutionFee));

    const btcBalanceAfter = await btc.balanceOf(user0.address);
    expect(btcBalanceAfter.sub(btcBalanceBefore)).to.be.equal("17899051");

    position = positionWrapper(await vault.getPosition(user0.address, btc.address, btc.address, true));

    expect(position.size).to.be.equal(0);
    expect(position.collateral).to.be.equal(0);

    const orderAfter = await orderbook.increaseOrders(user0.address, 0);
    expect(orderAfter.account).to.be.equal(constants.AddressZero);
  });

  it("Execute decrease order, short, BTC", async () => {
    await usdc.connect(user0).transfer(vault.address, toWei(10000, 6));
    await vault
      .connect(user0)
      .increasePosition(user0.address, usdc.address, btc.address, toUsd(20000), false);

    let position = positionWrapper(await vault.getPosition(user0.address, usdc.address, btc.address, false));
    const usdcBalanceBefore = await usdc.balanceOf(user0.address);

    await orderbook
      .connect(user0)
      .createDecreaseOrder(
        btc.address,
        position.size,
        usdc.address,
        position.collateral,
        false,
        toUsd(BTC_PRICE - 1000),
        false,
        {
          value: defaultExecutionFee,
        },
      );
    const executor = user1;

    const order = await orderbook.decreaseOrders(user0.address, 0);
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(BTC_PRICE - 1500));

    const executorBalanceBefore = await executor.getBalance();

    const tx = await orderbook.executeDecreaseOrder(user0.address, 0, executor.address);
    reportGasUsed(tx, "executeDecreaseOrder gas used");

    const executorBalanceAfter = await executor.getBalance();
    expect(executorBalanceAfter).to.be.equal(executorBalanceBefore.add(defaultExecutionFee));

    const usdcBalanceAfter = await usdc.balanceOf(user0.address);
    expect(usdcBalanceAfter.sub(usdcBalanceBefore)).to.be.equal("10460000000");

    position = positionWrapper(await vault.getPosition(user0.address, btc.address, btc.address, true));

    expect(position.size).to.be.equal(0);
    expect(position.collateral).to.be.equal(0);

    const orderAfter = await orderbook.increaseOrders(user0.address, 0);
    expect(orderAfter.account).to.be.equal(constants.AddressZero);
  });

  it("Execute decrease order, long, AVAX", async () => {
    await router
      .connect(user0)
      .increasePositionETH([avax.address], avax.address, 0, toUsd(3000), true, toUsd(301), {
        value: toWei(5, 18),
      });

    let position = positionWrapper(await vault.getPosition(user0.address, avax.address, avax.address, true));

    const userTx = await orderbook
      .connect(user0)
      .createDecreaseOrder(
        avax.address,
        position.size.div(2),
        avax.address,
        position.collateral.div(2),
        true,
        toUsd(BTC_PRICE - 1000),
        false,
        {
          value: defaultExecutionFee,
        },
      );

    reportGasUsed(userTx, "createSwapOrder");
    const userTxFee = await getTxFees(userTx);
    const order = await orderbook.decreaseOrders(user0.address, 0);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(BTC_PRICE - 1500));

    const executor = user1;

    const balanceBefore = await user0.getBalance();
    const executorBalanceBefore = await executor.getBalance();
    const tx = await orderbook.executeDecreaseOrder(user0.address, 0, executor.address);
    reportGasUsed(tx, "executeDecreaseOrder gas used");

    const executorBalanceAfter = await executor.getBalance();
    expect(executorBalanceAfter).to.be.equal(executorBalanceBefore.add(defaultExecutionFee));

    const balanceAfter = await user0.getBalance();
    const amountOut = "2490000000000000000";
    expect(balanceAfter, "balanceAfter").to.be.equal(balanceBefore.add(amountOut));

    position = positionWrapper(await vault.getPosition(user0.address, avax.address, avax.address, true));

    expect(position.size, "position.size").to.be.equal("1500000000000000000000000000000000");
    expect(position.collateral, "position.collateral").to.be.equal("748500000000000000000000000000000");

    const orderAfter = await orderbook.increaseOrders(user0.address, 0);
    expect(orderAfter.account).to.be.equal(constants.AddressZero);
  });

  it("Cancel decrease order", async () => {
    let tx = await orderbook
      .connect(user0)
      .createDecreaseOrder(
        btc.address,
        defaultSizeDelta,
        btc.address,
        defaultCollateralDelta,
        true,
        defaultTriggerPrice,
        true,
        {
          value: defaultExecutionFee,
        },
      );
    let order = await getCreatedDecreaseOrder(user0.address);
    expect(order.account).to.not.be.equal(constants.AddressZero);

    await expect(orderbook.connect(user0).cancelDecreaseOrder(1)).to.be.revertedWith(
      "OrderBook: non-existent order",
    );

    const balanceBefore = await user0.getBalance();
    tx = await orderbook.connect(user0).cancelDecreaseOrder(0);
    reportGasUsed(tx, "cancelDecreaseOrder gas used");

    order = await getCreatedDecreaseOrder(user0.address);
    expect(order.account).to.be.equal(constants.AddressZero);

    const txFees = await getTxFees(tx);
    const balanceAfter = await user0.getBalance();
    expect(balanceAfter).to.be.equal(balanceBefore.add(defaultExecutionFee).sub(txFees));
  });
});
