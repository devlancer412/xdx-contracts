import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  OrderBook__factory,
  OrderBook,
  Router__factory,
  Token,
  Vault__factory,
  USDG,
  USDG__factory,
  Router,
  Vault,
} from "../../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Ship, toWei } from "../../../utils";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let orderBook: OrderBook;
let router: Router;
let vault: Vault;
let usdg: USDG;
let avax: Token;

let deployer: SignerWithAddress;
let alice: SignerWithAddress;
let bob: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture(["orderbook", "vault", "router", "usdg", "tokens"]);

  return {
    ship,
    accounts,
    users,
  };
});

describe("OrderBook", function () {
  beforeEach(async function () {
    const { accounts } = await setup();

    deployer = accounts.deployer;
    alice = accounts.alice;
    bob = accounts.bob;

    orderBook = await ship.connect(OrderBook__factory);
    router = await ship.connect(Router__factory);
    vault = await ship.connect(Vault__factory);
    usdg = await ship.connect(USDG__factory);
    avax = (await ship.connect("avax")) as Token;
  });

  it("setGov", async () => {
    await expect(orderBook.connect(alice).setGov(bob.address)).to.be.revertedWith("OrderBook: forbidden");

    expect(await orderBook.gov()).eq(deployer.address);

    await orderBook.setGov(alice.address);
    expect(await orderBook.gov()).eq(alice.address);

    await orderBook.connect(alice).setGov(bob.address);
    expect(await orderBook.gov()).eq(bob.address);
  });

  it("set*", async () => {
    await expect(orderBook.connect(bob).setMinExecutionFee(600000)).to.be.revertedWith(
      "OrderBook: forbidden",
    );
    orderBook.setMinExecutionFee(600000);

    await expect(orderBook.connect(bob).setMinPurchaseTokenAmountUsd(1)).to.be.revertedWith(
      "OrderBook: forbidden",
    );
    orderBook.setMinPurchaseTokenAmountUsd(1);
  });

  it("initialize, already initialized", async () => {
    await expect(
      orderBook.connect(bob).initialize(
        router.address,
        vault.address,
        avax.address,
        usdg.address,
        1,
        toWei(5, 30), // minPurchseTokenAmountUsd
      ),
    ).to.be.revertedWith("OrderBook: forbidden");

    await expect(
      orderBook.initialize(
        router.address,
        vault.address,
        avax.address,
        usdg.address,
        1,
        toWei(5, 30), // minPurchseTokenAmountUsd
      ),
    ).to.be.revertedWith("OrderBook: already initialized");
  });
});
