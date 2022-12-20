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
} from "../../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Ship, toUsd, toWei } from "../../../utils";
import { defaultExecutionFee, defaultSizeDelta, defaultTriggerPrice, PRICE_PRECISION } from "./shared";
import { constants } from "ethers";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let orderbook: OrderBook;
let usdg: USDG;
let usdc: Token;
let btc: Token;

let alice: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture(["orderbook", "tokens", "vaultPriceFeed"]);

  return {
    ship,
    accounts,
    users,
  };
});

describe("OrderBook, cancelMultiple", function () {
  beforeEach(async function () {
    const { accounts } = await setup();

    alice = accounts.alice;

    orderbook = await ship.connect(OrderBook__factory);
    btc = (await ship.connect("btc")) as Token;
    usdc = (await ship.connect("usdc")) as Token;
    usdg = await ship.connect(USDG__factory);

    const router = await ship.connect(Router__factory);
    const vault = await ship.connect(Vault__factory);
    const vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
    const avax = (await ship.connect("avax")) as Token;

    await orderbook.setMinExecutionFee(500000);
    await orderbook.setMinPurchaseTokenAmountUsd(toWei(5, 30));
    await router.addPlugin(orderbook.address);
    await router.connect(alice).approvePlugin(orderbook.address);

    await vaultPriceFeed.setPriceSampleSpace(1);
    await vaultPriceFeed.setIsSecondaryPriceEnabled(false);

    await btc.mint(alice.address, toWei(1000, 8));
    await btc.connect(alice).approve(router.address, toWei(100, 8));

    await usdc.mint(alice.address, toWei(10000000, 6));
    await usdc.connect(alice).approve(router.address, toWei(1000000, 6));

    await avax.mint(alice.address, toWei(10000000, 18));
    await avax.connect(alice).approve(router.address, toWei(1000000, 18));

    await usdc.mint(alice.address, toWei(20000000, 6));
    await usdc.connect(alice).transfer(vault.address, toWei(2000000, 6));
    await vault.directPoolDeposit(usdc.address);

    await btc.mint(alice.address, toWei(1000, 8));
    await btc.connect(alice).transfer(vault.address, toWei(100, 8));
    await vault.directPoolDeposit(btc.address);

    await avax.mint(alice.address, toWei(50000, 18));
    await avax.connect(alice).transfer(vault.address, toWei(10000, 18));
    await vault.directPoolDeposit(avax.address);
  });

  it("cancelMultiple", async () => {
    const triggerRatio = toUsd(1).mul(PRICE_PRECISION).div(toUsd(58000));

    await orderbook
      .connect(alice)
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
    let swapOrder = await orderbook.swapOrders(alice.address, 0);
    expect(swapOrder.account).to.be.equal(alice.address);

    await orderbook.connect(alice).createIncreaseOrder(
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
    let increaseOrder = await orderbook.increaseOrders(alice.address, 0);
    expect(increaseOrder.account).to.be.equal(alice.address);

    await orderbook
      .connect(alice)
      .createDecreaseOrder(
        btc.address,
        defaultSizeDelta,
        btc.address,
        toUsd(60000),
        true,
        defaultTriggerPrice,
        true,
        {
          value: defaultExecutionFee,
        },
      );
    await orderbook
      .connect(alice)
      .createDecreaseOrder(
        btc.address,
        defaultSizeDelta,
        btc.address,
        toUsd(60000),
        true,
        defaultTriggerPrice,
        true,
        {
          value: defaultExecutionFee,
        },
      );
    let decreaseOrder = await orderbook.decreaseOrders(alice.address, 1);
    expect(decreaseOrder.account).to.be.equal(alice.address);

    await orderbook.connect(alice).cancelMultiple([0], [], []); // delete swap order
    swapOrder = await orderbook.swapOrders(alice.address, 0);
    expect(swapOrder.account).to.be.equal(constants.AddressZero);
    increaseOrder = await orderbook.increaseOrders(alice.address, 0);
    expect(increaseOrder.account).to.be.equal(alice.address);
    decreaseOrder = await orderbook.decreaseOrders(alice.address, 1);
    expect(decreaseOrder.account).to.be.equal(alice.address);

    await orderbook.connect(alice).cancelMultiple([], [0], [1]); // delete increase and decrease
    swapOrder = await orderbook.swapOrders(alice.address, 0);
    expect(swapOrder.account).to.be.equal(constants.AddressZero);
    increaseOrder = await orderbook.increaseOrders(alice.address, 0);
    expect(increaseOrder.account).to.be.equal(constants.AddressZero);
    decreaseOrder = await orderbook.decreaseOrders(alice.address, 1);
    expect(decreaseOrder.account).to.be.equal(constants.AddressZero);
    decreaseOrder = await orderbook.decreaseOrders(alice.address, 0);
    expect(decreaseOrder.account).to.be.equal(alice.address);

    await expect(orderbook.connect(alice).cancelMultiple([0], [], [])).to.be.revertedWith(
      "OrderBook: non-existent order",
    );
  });
});
