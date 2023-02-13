import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Token, Vault, Vault__factory, ShortsTracker, ShortsTracker__factory } from "../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Ship } from "../../utils";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let shortsTracker: ShortsTracker;
let vault: Vault;
let eth: Token;
let btc: Token;

let deployer: SignerWithAddress;
let user0: SignerWithAddress;
let user1: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture(["vault", "shortsTracker"]);

  return {
    ship,
    accounts,
    users,
  };
});

describe("ShortsTracker", function () {
  beforeEach(async function () {
    const { accounts, users } = await setup();

    deployer = accounts.deployer;
    user0 = users[0];
    user1 = users[1];

    vault = await ship.connect(Vault__factory);
    shortsTracker = await ship.connect(ShortsTracker__factory);
    eth = (await ship.connect("eth")) as Token;
    btc = (await ship.connect("btc")) as Token;
    await shortsTracker.setHandler(user0.address, true);
  });

  it("inits", async function () {
    expect(await shortsTracker.gov()).to.eq(deployer.address);
    expect(await shortsTracker.vault()).to.eq(vault.address);
  });

  it("setIsGlobalShortDataReady", async function () {
    expect(await shortsTracker.isGlobalShortDataReady()).to.be.false;

    await expect(shortsTracker.connect(user1).setIsGlobalShortDataReady(true)).to.be.revertedWith(
      "Governable: forbidden",
    );

    await shortsTracker.setIsGlobalShortDataReady(true);
    expect(await shortsTracker.isGlobalShortDataReady()).to.be.true;

    await shortsTracker.setIsGlobalShortDataReady(false);
    expect(await shortsTracker.isGlobalShortDataReady()).to.be.false;
  });

  it("setInitData", async function () {
    await expect(shortsTracker.connect(user1).setInitData([], [])).to.be.revertedWith(
      "Governable: forbidden",
    );

    expect(await shortsTracker.globalShortAveragePrices(eth.address)).to.eq(0);
    expect(await shortsTracker.globalShortAveragePrices(btc.address)).to.eq(0);

    shortsTracker.setInitData([eth.address, btc.address], [100, 200]);

    expect(await shortsTracker.globalShortAveragePrices(eth.address)).to.eq(100);
    expect(await shortsTracker.globalShortAveragePrices(btc.address)).to.eq(200);
  });
});
