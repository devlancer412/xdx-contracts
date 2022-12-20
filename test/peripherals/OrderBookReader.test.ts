import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  Token,
  VaultPriceFeed,
  VaultPriceFeed__factory,
  OrderBook,
  OrderBook__factory,
  OrderBookReader,
  OrderBookReader__factory,
  Router__factory,
} from "../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Ship, toUsd, toWei } from "../../utils";
import { BigNumberish } from "ethers";
import { defaultExecutionFee } from "../core/OrderBook/shared";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let orderBookReader: OrderBookReader;
let vaultPriceFeed: VaultPriceFeed;
let orderbook: OrderBook;
let usdc: Token;
let btc: Token;
let avax: Token;

let alice: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture(["vaultPriceFeed", "orderbook", "tokens", "orderBookReader"]);

  return {
    ship,
    accounts,
    users,
  };
});

describe("OrderBookReader", () => {
  beforeEach(async () => {
    const { accounts } = await setup();

    alice = accounts.alice;

    vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
    usdc = (await ship.connect("usdc")) as Token;
    btc = (await ship.connect("btc")) as Token;
    avax = (await ship.connect("avax")) as Token;
    orderbook = await ship.connect(OrderBook__factory);
    orderBookReader = await ship.connect(OrderBookReader__factory);

    const router = await ship.connect(Router__factory);

    await router.addPlugin(orderbook.address);
    await router.connect(alice).approvePlugin(orderbook.address);

    await orderbook.setMinExecutionFee(defaultExecutionFee);

    await vaultPriceFeed.setIsSecondaryPriceEnabled(false);

    await usdc.mint(alice.address, toWei(10000000, 18));
    await usdc.connect(alice).approve(router.address, toWei(1000000, 18));

    await btc.mint(alice.address, toWei(100, 8));
    await btc.connect(alice).approve(router.address, toWei(100, 8));
  });

  function createSwapOrder(toToken = usdc.address) {
    return orderbook
      .connect(alice)
      .createSwapOrder(
        [usdc.address, toToken],
        toWei(1000, 18),
        toWei(990, 18),
        toWei(1, 30),
        true,
        defaultExecutionFee,
        false,
        true,
        { value: defaultExecutionFee },
      );
  }

  function createIncreaseOrder(sizeDelta: BigNumberish) {
    return orderbook.connect(alice).createIncreaseOrder(
      [btc.address],
      toWei(1, 8),
      btc.address,
      0,
      sizeDelta,
      btc.address, // collateralToken
      true, // isLong
      toUsd(53000), // triggerPrice
      false, // triggerAboveThreshold
      defaultExecutionFee,
      false, // shouldWrap
      { value: defaultExecutionFee },
    );
  }

  function createDecreaseOrder(sizeDelta = toUsd(100000)) {
    return orderbook.connect(alice).createDecreaseOrder(
      btc.address, // indexToken
      sizeDelta, // sizeDelta
      btc.address, // collateralToken
      toUsd(35000), // collateralDelta
      true, // isLong
      toUsd(53000), // triggerPrice
      true, // triggetAboveThreshold
      { value: defaultExecutionFee },
    );
  }

  function unflattenOrders([uintProps, addressProps]: any[], uintLength: any, addressLength: number) {
    const count = uintProps.length / uintLength;

    const ret = [];
    for (let i = 0; i < count; i++) {
      const order = addressProps
        .slice(addressLength * i, addressLength * (i + 1))
        .concat(uintProps.slice(uintLength * i, uintLength * (i + 1)));
      ret.push(order);
    }
    return ret;
  }

  it("getIncreaseOrders", async () => {
    await createIncreaseOrder(toUsd(100000));
    await createIncreaseOrder(toUsd(200000));

    const [order1, order2] = unflattenOrders(
      await orderBookReader.getIncreaseOrders(orderbook.address, alice.address, [0, 1]),
      5,
      3,
    );

    expect(order1[2]).to.be.equal(btc.address);
    expect(order1[4]).to.be.equal(toUsd(100000));

    expect(order2[2]).to.be.equal(btc.address);
    expect(order2[4]).to.be.equal(toUsd(200000));
  });

  it("getDecreaseOrders", async () => {
    await createDecreaseOrder(toUsd(100000));
    await createDecreaseOrder(toUsd(200000));

    const [order1, order2] = unflattenOrders(
      await orderBookReader.getDecreaseOrders(orderbook.address, alice.address, [0, 1]),
      5,
      2,
    );

    expect(order1[1]).to.be.equal(btc.address);
    expect(order1[3]).to.be.equal(toUsd(100000));

    expect(order2[1]).to.be.equal(btc.address);
    expect(order2[3]).to.be.equal(toUsd(200000));
  });

  it("getSwapOrders", async () => {
    await createSwapOrder(avax.address);
    await createSwapOrder(btc.address);

    const [order1, order2] = unflattenOrders(
      await orderBookReader.getSwapOrders(orderbook.address, alice.address, [0, 1]),
      4,
      3,
    );

    expect(order1[0]).to.be.equal(usdc.address);
    expect(order1[1]).to.be.equal(avax.address);

    expect(order2[0]).to.be.equal(usdc.address);
    expect(order2[1]).to.be.equal(btc.address);
  });
});
