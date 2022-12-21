import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  Token,
  VaultPriceFeed,
  VaultPriceFeed__factory,
  Router__factory,
  PriceFeed,
  Vault__factory,
  PriceFeedTimelock__factory,
  Timelock__factory,
  FastPriceFeed__factory,
  Vault,
  Router,
  PriceFeedTimelock,
  Timelock,
  FastPriceFeed,
  RewardDistributor__factory,
  XDX__factory,
  TokenManager,
  TokenManager__factory,
} from "../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { advanceTimeAndBlock, Ship, toChainlinkPrice, toUsd, toWei } from "../../utils";
import { constants, utils } from "ethers";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let vault: Vault;
let router: Router;
let vaultPriceFeed: VaultPriceFeed;
let priceFeedTimelock: PriceFeedTimelock;
let timelock: Timelock;
let fastPriceFeed: FastPriceFeed;
let tokenManager: TokenManager;

let usdc: Token;
let btc: Token;
let btcPriceFeed: PriceFeed;
let avax: Token;
let avaxPriceFeed: PriceFeed;

let deployer: SignerWithAddress;
let signer1: SignerWithAddress;
let signer2: SignerWithAddress;
let user0: SignerWithAddress;
let user1: SignerWithAddress;
let user2: SignerWithAddress;
let user3: SignerWithAddress;
let mintReceiver: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture([
    "vault",
    "router",
    "vaultPriceFeed",
    "tokens",
    "priceFeedTimelock",
    "timelock",
    "fastPriceFeed",
  ]);

  return {
    ship,
    accounts,
    users,
  };
});

describe("FastPriceTimelock", () => {
  beforeEach(async () => {
    const { accounts, users } = await setup();

    deployer = accounts.deployer;
    signer1 = accounts.signer1;
    signer2 = accounts.signer2;
    user0 = users[0];
    user1 = users[1];
    user2 = users[2];
    user3 = users[3];
    mintReceiver = users[4];

    usdc = (await ship.connect("usdc")) as Token;
    btc = (await ship.connect("btc")) as Token;
    btcPriceFeed = (await ship.connect("btcPriceFeed")) as PriceFeed;
    avax = (await ship.connect("avax")) as Token;
    avaxPriceFeed = (await ship.connect("avaxPriceFeed")) as PriceFeed;

    vault = await ship.connect(Vault__factory);
    router = await ship.connect(Router__factory);
    vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
    tokenManager = await ship.connect(TokenManager__factory);

    await vault.setPriceFeed(user3.address);

    priceFeedTimelock = await ship.connect(PriceFeedTimelock__factory);
    timelock = await ship.connect(Timelock__factory);

    fastPriceFeed = await ship.connect(FastPriceFeed__factory);

    await vaultPriceFeed.setIsSecondaryPriceEnabled(false);
    await vault.setGov(timelock.address);
    await fastPriceFeed.setGov(priceFeedTimelock.address);
    await vaultPriceFeed.setGov(priceFeedTimelock.address);
    await router.setGov(timelock.address);

    await timelock.setBuffer(5 * 24 * 60 * 60);
    await priceFeedTimelock.setBuffer(5 * 24 * 60 * 60);
  });

  it("inits", async () => {
    expect(await priceFeedTimelock.admin()).eq(deployer.address);
    expect(await priceFeedTimelock.buffer()).eq(5 * 24 * 60 * 60);
    expect(await priceFeedTimelock.tokenManager()).eq(tokenManager.address);

    await expect(
      ship.deploy(PriceFeedTimelock__factory, {
        aliasName: "DeployTest",
        args: [
          deployer.address, // admin
          5 * 24 * 60 * 60 + 1, // buffer
          tokenManager.address, // tokenManager
        ],
      }),
    ).to.be.revertedWith("Timelock: invalid _buffer");
  });

  it("setAdmin", async () => {
    await expect(priceFeedTimelock.setAdmin(user1.address)).to.be.revertedWith("Timelock: forbidden");

    expect(await priceFeedTimelock.admin()).eq(deployer.address);
    await tokenManager.connect(signer1).signalSetAdmin(priceFeedTimelock.address, user1.address);
    await tokenManager.connect(signer2).signSetAdmin(priceFeedTimelock.address, user1.address, 1);
    await tokenManager.connect(signer1).setAdmin(priceFeedTimelock.address, user1.address, 1);
    expect(await priceFeedTimelock.admin()).eq(user1.address);
  });

  it("setExternalAdmin", async () => {
    const distributor = (
      await ship.deploy(RewardDistributor__factory, {
        aliasName: "TestDistributor",
        args: [user1.address, user2.address],
      })
    ).contract;
    await distributor.setGov(priceFeedTimelock.address);
    await expect(
      priceFeedTimelock.connect(user0).setExternalAdmin(distributor.address, user3.address),
    ).to.be.revertedWith("Timelock: forbidden");

    expect(await distributor.admin()).eq(deployer.address);
    await priceFeedTimelock.connect(deployer).setExternalAdmin(distributor.address, user3.address);
    expect(await distributor.admin()).eq(user3.address);

    await expect(
      priceFeedTimelock.connect(deployer).setExternalAdmin(priceFeedTimelock.address, user3.address),
    ).to.be.revertedWith("Timelock: invalid _target");
  });

  it("setContractHandler", async () => {
    await expect(priceFeedTimelock.connect(user0).setContractHandler(user1.address, true)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    expect(await priceFeedTimelock.isHandler(user1.address)).eq(false);
    await priceFeedTimelock.connect(deployer).setContractHandler(user1.address, true);
    expect(await priceFeedTimelock.isHandler(user1.address)).eq(true);
  });

  it("setKeeper", async () => {
    await expect(priceFeedTimelock.connect(user0).setKeeper(user1.address, true)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    expect(await priceFeedTimelock.isKeeper(user1.address)).eq(false);
    await priceFeedTimelock.connect(deployer).setKeeper(user1.address, true);
    expect(await priceFeedTimelock.isKeeper(user1.address)).eq(true);
  });

  it("setBuffer", async () => {
    const timelock0 = (
      await ship.deploy(Timelock__factory, {
        aliasName: "DeployTest",
        args: [
          user1.address, // _admin
          3 * 24 * 60 * 60, // _buffer
          tokenManager.address, // _tokenManager
          mintReceiver.address, // _mintReceiver
          user0.address, // _xlxManager
          user1.address, // _rewardRouter
          1000, // _maxTokenSupply
          10, // marginFeeBasisPoints
          100, // maxMarginFeeBasisPoints
        ],
      })
    ).contract;
    await expect(timelock0.connect(user0).setBuffer(3 * 24 * 60 * 60 - 10)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    await expect(timelock0.connect(user1).setBuffer(5 * 24 * 60 * 60 + 10)).to.be.revertedWith(
      "Timelock: invalid _buffer",
    );

    await expect(timelock0.connect(user1).setBuffer(3 * 24 * 60 * 60 - 10)).to.be.revertedWith(
      "Timelock: buffer cannot be decreased",
    );

    expect(await timelock0.buffer()).eq(3 * 24 * 60 * 60);
    await timelock0.connect(user1).setBuffer(3 * 24 * 60 * 60 + 10);
    expect(await timelock0.buffer()).eq(3 * 24 * 60 * 60 + 10);
  });

  it("setIsAmmEnabled", async () => {
    await expect(
      priceFeedTimelock.connect(user0).setIsAmmEnabled(vaultPriceFeed.address, true),
    ).to.be.revertedWith("Timelock: forbidden");

    expect(await vaultPriceFeed.isAmmEnabled()).eq(false);
    await priceFeedTimelock.connect(deployer).setIsAmmEnabled(vaultPriceFeed.address, true);
    expect(await vaultPriceFeed.isAmmEnabled()).eq(true);
  });

  it("setMaxStrictPriceDeviation", async () => {
    await expect(
      priceFeedTimelock.connect(user0).setMaxStrictPriceDeviation(vaultPriceFeed.address, 100),
    ).to.be.revertedWith("Timelock: forbidden");

    expect(await vaultPriceFeed.maxStrictPriceDeviation()).eq(toWei(1, 28));
    await priceFeedTimelock.connect(deployer).setMaxStrictPriceDeviation(vaultPriceFeed.address, 100);
    expect(await vaultPriceFeed.maxStrictPriceDeviation()).eq(100);
  });

  it("setPriceSampleSpace", async () => {
    await expect(
      priceFeedTimelock.connect(user0).setPriceSampleSpace(vaultPriceFeed.address, 0),
    ).to.be.revertedWith("Timelock: forbidden");

    expect(await vaultPriceFeed.priceSampleSpace()).eq(3);
    await priceFeedTimelock.connect(deployer).setPriceSampleSpace(vaultPriceFeed.address, 1);
    expect(await vaultPriceFeed.priceSampleSpace()).eq(1);
  });

  it("setVaultPriceFeed", async () => {
    await expect(
      priceFeedTimelock.connect(user0).setVaultPriceFeed(fastPriceFeed.address, vaultPriceFeed.address),
    ).to.be.revertedWith("Timelock: forbidden");

    expect(await fastPriceFeed.vaultPriceFeed()).eq(vaultPriceFeed.address);
    await priceFeedTimelock.connect(deployer).setVaultPriceFeed(fastPriceFeed.address, constants.AddressZero);
    expect(await fastPriceFeed.vaultPriceFeed()).eq(constants.AddressZero);
  });

  it("setPriceDuration", async () => {
    await expect(
      priceFeedTimelock.connect(user0).setPriceDuration(fastPriceFeed.address, 1000),
    ).to.be.revertedWith("Timelock: forbidden");

    expect(await fastPriceFeed.priceDuration()).eq(300);
    await priceFeedTimelock.connect(deployer).setPriceDuration(fastPriceFeed.address, 1000);
    expect(await fastPriceFeed.priceDuration()).eq(1000);
  });

  it("setMaxPriceUpdateDelay", async () => {
    await expect(
      priceFeedTimelock.connect(user0).setMaxPriceUpdateDelay(fastPriceFeed.address, 30 * 60),
    ).to.be.revertedWith("Timelock: forbidden");

    expect(await fastPriceFeed.maxPriceUpdateDelay()).eq(60 * 60);
    await priceFeedTimelock.connect(deployer).setMaxPriceUpdateDelay(fastPriceFeed.address, 30 * 60);
    expect(await fastPriceFeed.maxPriceUpdateDelay()).eq(30 * 60);
  });

  it("setSpreadBasisPointsIfInactive", async () => {
    await expect(
      priceFeedTimelock.connect(user0).setSpreadBasisPointsIfInactive(fastPriceFeed.address, 30),
    ).to.be.revertedWith("Timelock: forbidden");

    expect(await fastPriceFeed.spreadBasisPointsIfInactive()).eq(50);
    await priceFeedTimelock.connect(deployer).setSpreadBasisPointsIfInactive(fastPriceFeed.address, 30);
    expect(await fastPriceFeed.spreadBasisPointsIfInactive()).eq(30);
  });

  it("setSpreadBasisPointsIfChainError", async () => {
    await expect(
      priceFeedTimelock.connect(user0).setSpreadBasisPointsIfChainError(fastPriceFeed.address, 500),
    ).to.be.revertedWith("Timelock: forbidden");

    expect(await fastPriceFeed.spreadBasisPointsIfChainError()).eq(500);
    await priceFeedTimelock.connect(deployer).setSpreadBasisPointsIfChainError(fastPriceFeed.address, 50);
    expect(await fastPriceFeed.spreadBasisPointsIfChainError()).eq(50);
  });

  it("transferIn", async () => {
    await avax.mint(user1.address, 1000);
    await expect(
      priceFeedTimelock.connect(user0).transferIn(user1.address, avax.address, 1000),
    ).to.be.revertedWith("Timelock: forbidden");

    await expect(
      priceFeedTimelock.connect(deployer).transferIn(user1.address, avax.address, 1000),
    ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");

    await avax.connect(user1).approve(priceFeedTimelock.address, 1000);

    expect(await avax.balanceOf(user1.address)).eq(1000);
    expect(await avax.balanceOf(priceFeedTimelock.address)).eq(0);
    await priceFeedTimelock.connect(deployer).transferIn(user1.address, avax.address, 1000);
    expect(await avax.balanceOf(user1.address)).eq(0);
    expect(await avax.balanceOf(priceFeedTimelock.address)).eq(1000);
  });

  it("approve", async () => {
    await priceFeedTimelock.setContractHandler(user0.address, true);
    await expect(
      priceFeedTimelock.connect(user0).approve(usdc.address, user1.address, toWei(100, 6)),
    ).to.be.revertedWith("Timelock: forbidden");

    await expect(
      priceFeedTimelock.connect(deployer).approve(usdc.address, user1.address, toWei(100, 6)),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      priceFeedTimelock.connect(user0).signalApprove(usdc.address, user1.address, toWei(100, 6)),
    ).to.be.revertedWith("Timelock: forbidden");

    await priceFeedTimelock.connect(deployer).signalApprove(usdc.address, user1.address, toWei(100, 6));

    await expect(
      priceFeedTimelock.connect(deployer).approve(usdc.address, user1.address, toWei(100, 6)),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(4 * 24 * 60 * 60);

    await expect(
      priceFeedTimelock.connect(deployer).approve(usdc.address, user1.address, toWei(100, 6)),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(1 * 24 * 60 * 60 + 10);

    await expect(
      priceFeedTimelock.connect(deployer).approve(avax.address, user1.address, toWei(100, 6)),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      priceFeedTimelock.connect(deployer).approve(usdc.address, user2.address, toWei(100, 6)),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      priceFeedTimelock.connect(deployer).approve(usdc.address, user1.address, toWei(101, 6)),
    ).to.be.revertedWith("Timelock: action not signalled");

    await usdc.mint(priceFeedTimelock.address, toWei(150, 6));

    expect(await usdc.balanceOf(priceFeedTimelock.address)).eq(toWei(150, 6));
    expect(await usdc.balanceOf(user1.address)).eq(0);

    await expect(
      usdc.connect(user1).transferFrom(priceFeedTimelock.address, user1.address, toWei(100, 6)),
    ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");

    await priceFeedTimelock.connect(deployer).approve(usdc.address, user1.address, toWei(100, 6));
    await expect(
      usdc.connect(user2).transferFrom(priceFeedTimelock.address, user2.address, toWei(100, 6)),
    ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
    await usdc.connect(user1).transferFrom(priceFeedTimelock.address, user1.address, toWei(100, 6));

    expect(await usdc.balanceOf(priceFeedTimelock.address)).eq(toWei(50, 6));
    expect(await usdc.balanceOf(user1.address)).eq(toWei(100, 6));

    await expect(
      usdc.connect(user1).transferFrom(priceFeedTimelock.address, user1.address, toWei(1, 6)),
    ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");

    await expect(
      priceFeedTimelock.connect(deployer).approve(usdc.address, user1.address, toWei(100, 6)),
    ).to.be.revertedWith("Timelock: action not signalled");

    await priceFeedTimelock.connect(deployer).signalApprove(usdc.address, user1.address, toWei(100, 6));

    await expect(
      priceFeedTimelock.connect(deployer).approve(usdc.address, user1.address, toWei(100, 6)),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    const action0 = utils.solidityKeccak256(
      ["string", "address", "address", "uint256"],
      ["approve", avax.address, user1.address, toWei(100, 6)],
    );
    const action1 = utils.solidityKeccak256(
      ["string", "address", "address", "uint256"],
      ["approve", usdc.address, user1.address, toWei(100, 6)],
    );

    await expect(priceFeedTimelock.connect(user0).cancelAction(action0)).to.be.revertedWith(
      "Timelock: forbidden",
    );

    await expect(priceFeedTimelock.connect(deployer).cancelAction(action0)).to.be.revertedWith(
      "Timelock: invalid _action",
    );

    await priceFeedTimelock.connect(deployer).cancelAction(action1);

    await expect(
      priceFeedTimelock.connect(deployer).approve(usdc.address, user1.address, toWei(100, 6)),
    ).to.be.revertedWith("Timelock: action not signalled");
  });

  it("setGov", async () => {
    await priceFeedTimelock.setContractHandler(user0.address, true);

    await expect(
      priceFeedTimelock.connect(user0).setGov(fastPriceFeed.address, user1.address),
    ).to.be.revertedWith("Timelock: forbidden");

    await expect(
      priceFeedTimelock.connect(deployer).setGov(fastPriceFeed.address, user1.address),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      priceFeedTimelock.connect(user0).signalSetGov(fastPriceFeed.address, user1.address),
    ).to.be.revertedWith("Timelock: forbidden");

    await priceFeedTimelock.connect(deployer).signalSetGov(fastPriceFeed.address, user1.address);

    await expect(
      priceFeedTimelock.connect(deployer).setGov(fastPriceFeed.address, user1.address),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(4 * 24 * 60 * 60);

    await expect(
      priceFeedTimelock.connect(deployer).setGov(fastPriceFeed.address, user1.address),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(1 * 24 * 60 * 60 + 10);

    await expect(priceFeedTimelock.connect(deployer).setGov(user2.address, user1.address)).to.be.revertedWith(
      "Timelock: action not signalled",
    );

    await expect(
      priceFeedTimelock.connect(deployer).setGov(fastPriceFeed.address, user2.address),
    ).to.be.revertedWith("Timelock: action not signalled");

    expect(await fastPriceFeed.gov()).eq(priceFeedTimelock.address);
    await priceFeedTimelock.connect(deployer).setGov(fastPriceFeed.address, user1.address);
    expect(await fastPriceFeed.gov()).eq(user1.address);

    await priceFeedTimelock.connect(deployer).signalSetGov(fastPriceFeed.address, user2.address);

    await expect(
      priceFeedTimelock.connect(deployer).setGov(fastPriceFeed.address, user2.address),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    const action0 = utils.solidityKeccak256(
      ["string", "address", "address"],
      ["setGov", user1.address, user2.address],
    );
    const action1 = utils.solidityKeccak256(
      ["string", "address", "address"],
      ["setGov", fastPriceFeed.address, user2.address],
    );

    await expect(priceFeedTimelock.connect(deployer).cancelAction(action0)).to.be.revertedWith(
      "Timelock: invalid _action",
    );

    await priceFeedTimelock.connect(deployer).cancelAction(action1);

    await expect(
      priceFeedTimelock.connect(deployer).setGov(fastPriceFeed.address, user2.address),
    ).to.be.revertedWith("Timelock: action not signalled");
  });

  it("withdrawToken", async () => {
    await priceFeedTimelock.setContractHandler(user0.address, true);

    const xdx = await ship.connect(XDX__factory);
    await xdx.setGov(priceFeedTimelock.address);

    await expect(
      priceFeedTimelock.connect(user0).withdrawToken(xdx.address, avax.address, user0.address, 100),
    ).to.be.revertedWith("Timelock: forbidden");

    await expect(
      priceFeedTimelock.connect(deployer).withdrawToken(xdx.address, avax.address, user0.address, 100),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      priceFeedTimelock.connect(user0).signalWithdrawToken(xdx.address, avax.address, user0.address, 100),
    ).to.be.revertedWith("Timelock: forbidden");

    await priceFeedTimelock
      .connect(deployer)
      .signalWithdrawToken(xdx.address, avax.address, user0.address, 100);

    await expect(
      priceFeedTimelock.connect(deployer).withdrawToken(xdx.address, avax.address, user0.address, 100),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(4 * 24 * 60 * 60);

    await expect(
      priceFeedTimelock.connect(deployer).withdrawToken(xdx.address, avax.address, user0.address, 100),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(1 * 24 * 60 * 60 + 10);

    await expect(
      priceFeedTimelock.connect(deployer).withdrawToken(usdc.address, avax.address, user0.address, 100),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      priceFeedTimelock.connect(deployer).withdrawToken(xdx.address, usdc.address, user0.address, 100),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      priceFeedTimelock.connect(deployer).withdrawToken(xdx.address, avax.address, user1.address, 100),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      priceFeedTimelock.connect(deployer).withdrawToken(xdx.address, avax.address, user0.address, 101),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      priceFeedTimelock.connect(deployer).withdrawToken(xdx.address, avax.address, user0.address, 100),
    ).to.be.revertedWith("ERC20: transfer amount exceeds balance");

    await avax.mint(xdx.address, 100);
    expect(await avax.balanceOf(user0.address)).eq(0);
    await priceFeedTimelock.connect(deployer).withdrawToken(xdx.address, avax.address, user0.address, 100);
    expect(await avax.balanceOf(user0.address)).eq(100);
  });

  it("setPriceFeedWatcher", async () => {
    await priceFeedTimelock.setContractHandler(user0.address, true);

    await expect(
      priceFeedTimelock.connect(user0).setPriceFeedWatcher(fastPriceFeed.address, user1.address, true),
    ).to.be.revertedWith("Timelock: forbidden");

    await expect(
      priceFeedTimelock.connect(deployer).setPriceFeedWatcher(fastPriceFeed.address, user1.address, true),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      priceFeedTimelock.connect(user0).signalSetPriceFeedWatcher(fastPriceFeed.address, user1.address, true),
    ).to.be.revertedWith("Timelock: forbidden");

    await priceFeedTimelock
      .connect(deployer)
      .signalSetPriceFeedWatcher(fastPriceFeed.address, user1.address, true);

    await expect(
      priceFeedTimelock.connect(deployer).setPriceFeedWatcher(fastPriceFeed.address, user1.address, true),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(4 * 24 * 60 * 60);

    await expect(
      priceFeedTimelock.connect(deployer).setPriceFeedWatcher(fastPriceFeed.address, user1.address, true),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(1 * 24 * 60 * 60 + 10);

    await expect(
      priceFeedTimelock.connect(deployer).setPriceFeedWatcher(user2.address, user1.address, true),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      priceFeedTimelock.connect(deployer).setPriceFeedWatcher(fastPriceFeed.address, user2.address, true),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      priceFeedTimelock.connect(deployer).setPriceFeedWatcher(fastPriceFeed.address, user1.address, false),
    ).to.be.revertedWith("Timelock: action not signalled");

    expect(await fastPriceFeed.isSigner(user1.address)).eq(false);
    await priceFeedTimelock.connect(deployer).setPriceFeedWatcher(fastPriceFeed.address, user1.address, true);
    expect(await fastPriceFeed.isSigner(user1.address)).eq(true);
  });

  it("setPriceFeedUpdater", async () => {
    await priceFeedTimelock.setContractHandler(user0.address, true);

    await expect(
      priceFeedTimelock.connect(user0).setPriceFeedUpdater(fastPriceFeed.address, user1.address, true),
    ).to.be.revertedWith("Timelock: forbidden");

    await expect(
      priceFeedTimelock.connect(deployer).setPriceFeedUpdater(fastPriceFeed.address, user1.address, true),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      priceFeedTimelock.connect(user0).signalSetPriceFeedUpdater(fastPriceFeed.address, user1.address, true),
    ).to.be.revertedWith("Timelock: forbidden");

    await priceFeedTimelock
      .connect(deployer)
      .signalSetPriceFeedUpdater(fastPriceFeed.address, user1.address, true);

    await expect(
      priceFeedTimelock.connect(deployer).setPriceFeedUpdater(fastPriceFeed.address, user1.address, true),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(4 * 24 * 60 * 60);

    await expect(
      priceFeedTimelock.connect(deployer).setPriceFeedUpdater(fastPriceFeed.address, user1.address, true),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(1 * 24 * 60 * 60 + 10);

    await expect(
      priceFeedTimelock.connect(deployer).setPriceFeedUpdater(user2.address, user1.address, true),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      priceFeedTimelock.connect(deployer).setPriceFeedUpdater(fastPriceFeed.address, user2.address, true),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      priceFeedTimelock.connect(deployer).setPriceFeedUpdater(fastPriceFeed.address, user1.address, false),
    ).to.be.revertedWith("Timelock: action not signalled");

    expect(await fastPriceFeed.isUpdater(user1.address)).eq(false);
    await priceFeedTimelock.connect(deployer).setPriceFeedUpdater(fastPriceFeed.address, user1.address, true);
    expect(await fastPriceFeed.isUpdater(user1.address)).eq(true);
  });

  it("priceFeedSetTokenConfig", async () => {
    await priceFeedTimelock.setContractHandler(user0.address, true);

    await timelock.connect(deployer).signalSetPriceFeed(vault.address, vaultPriceFeed.address);
    await advanceTimeAndBlock(5 * 24 * 60 * 60 + 10);
    await timelock.connect(deployer).setPriceFeed(vault.address, vaultPriceFeed.address);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(70000));

    await expect(
      priceFeedTimelock.connect(user0).priceFeedSetTokenConfig(
        vaultPriceFeed.address,
        btc.address, // _token
        btcPriceFeed.address, // _priceFeed
        8, // _priceDecimals
        true, // _isStrictStable
      ),
    ).to.be.revertedWith("Timelock: forbidden");

    await expect(
      priceFeedTimelock.connect(deployer).priceFeedSetTokenConfig(
        vaultPriceFeed.address,
        btc.address, // _token
        btcPriceFeed.address, // _priceFeed
        8, // _priceDecimals
        true, // _isStrictStable
      ),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      priceFeedTimelock.connect(user0).signalPriceFeedSetTokenConfig(
        vaultPriceFeed.address,
        btc.address, // _token
        btcPriceFeed.address, // _priceFeed
        8, // _priceDecimals
        true, // _isStrictStable
      ),
    ).to.be.revertedWith("Timelock: forbidden");

    await priceFeedTimelock.connect(deployer).signalPriceFeedSetTokenConfig(
      vaultPriceFeed.address,
      btc.address, // _token
      btcPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      true, // _isStrictStable
    );

    await expect(
      priceFeedTimelock.connect(deployer).priceFeedSetTokenConfig(
        vaultPriceFeed.address,
        btc.address, // _token
        btcPriceFeed.address, // _priceFeed
        8, // _priceDecimals
        true, // _isStrictStable
      ),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(4 * 24 * 60 * 60);

    await expect(
      priceFeedTimelock.connect(deployer).priceFeedSetTokenConfig(
        vaultPriceFeed.address,
        btc.address, // _token
        btcPriceFeed.address, // _priceFeed
        8, // _priceDecimals
        true, // _isStrictStable
      ),
    ).to.be.revertedWith("Timelock: action time not yet passed");

    await advanceTimeAndBlock(1 * 24 * 60 * 60 + 10);

    await expect(
      priceFeedTimelock.connect(deployer).priceFeedSetTokenConfig(
        user0.address,
        btc.address, // _token
        btcPriceFeed.address, // _priceFeed
        8, // _priceDecimals
        true, // _isStrictStable
      ),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      priceFeedTimelock.connect(deployer).priceFeedSetTokenConfig(
        vaultPriceFeed.address,
        avax.address, // _token
        btcPriceFeed.address, // _priceFeed
        8, // _priceDecimals
        true, // _isStrictStable
      ),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      priceFeedTimelock.connect(deployer).priceFeedSetTokenConfig(
        vaultPriceFeed.address,
        btc.address, // _token
        avaxPriceFeed.address, // _priceFeed
        8, // _priceDecimals
        true, // _isStrictStable
      ),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      priceFeedTimelock.connect(deployer).priceFeedSetTokenConfig(
        vaultPriceFeed.address,
        btc.address, // _token
        btcPriceFeed.address, // _priceFeed
        9, // _priceDecimals
        true, // _isStrictStable
      ),
    ).to.be.revertedWith("Timelock: action not signalled");

    await expect(
      priceFeedTimelock.connect(deployer).priceFeedSetTokenConfig(
        vaultPriceFeed.address,
        btc.address, // _token
        btcPriceFeed.address, // _priceFeed
        8, // _priceDecimals
        false, // _isStrictStable
      ),
    ).to.be.revertedWith("Timelock: action not signalled");

    expect(await vaultPriceFeed.priceFeeds(btc.address)).eq(btcPriceFeed.address);
    expect(await vaultPriceFeed.priceDecimals(btc.address)).eq(8);
    expect(await vaultPriceFeed.strictStableTokens(btc.address)).eq(false);
    expect(await vaultPriceFeed.getPrice(btc.address, true, false, false)).eq(toUsd(70000));

    await priceFeedTimelock.connect(deployer).signalPriceFeedSetTokenConfig(
      vaultPriceFeed.address,
      btc.address, // _token
      avaxPriceFeed.address, // _priceFeed
      18, // _priceDecimals
      true, // _isStrictStable
    );
    await advanceTimeAndBlock(5 * 24 * 60 * 60 + 10);
    await priceFeedTimelock.connect(deployer).priceFeedSetTokenConfig(
      vaultPriceFeed.address,
      btc.address, // _token
      avaxPriceFeed.address, // _priceFeed
      18, // _priceDecimals
      true, // _isStrictStable
    );

    expect(await vaultPriceFeed.priceFeeds(btc.address)).eq(avaxPriceFeed.address);
    expect(await vaultPriceFeed.priceDecimals(btc.address)).eq(18);
    expect(await vaultPriceFeed.strictStableTokens(btc.address)).eq(true);
    expect(await vaultPriceFeed.getPrice(btc.address, true, false, false)).eq(toUsd(1));
  });
});
