import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  Timelock,
  Timelock__factory,
  Token,
  TokenManager,
  TokenManager__factory,
  XDX,
  XdxTimelock,
  XdxTimelock__factory,
  XDX__factory,
} from "../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { advanceTimeAndBlock, Ship, toWei } from "../../utils";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let tokenManager: TokenManager;
let xdx: XDX;
let eth: Token;
let timelock: Timelock;
let xdxTimelock: XdxTimelock;

let alice: SignerWithAddress;
let bob: SignerWithAddress;
let deployer: SignerWithAddress;
let signer1: SignerWithAddress;
let signer2: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture(["tokens", "xdx", "tokenManager", "timelock", "xdxTimelock"]);

  return {
    ship,
    accounts,
    users,
  };
});

describe("TokenManager", () => {
  beforeEach(async () => {
    const { accounts } = await setup();

    alice = accounts.alice;
    bob = accounts.bob;
    deployer = accounts.deployer;
    signer1 = accounts.signer1;
    signer2 = accounts.signer2;

    tokenManager = await ship.connect(TokenManager__factory);
    xdx = await ship.connect(XDX__factory);
    eth = (await ship.connect("eth")) as Token;
    timelock = await ship.connect(Timelock__factory);
    xdxTimelock = await ship.connect(XdxTimelock__factory);
  });

  it("inits", async () => {
    await expect(tokenManager.initialize([signer1.address, alice.address, bob.address])).to.be.revertedWith(
      "TokenManager: already initialized",
    );

    expect(await tokenManager.signers(0)).eq(signer1.address);
    expect(await tokenManager.signers(1)).eq(signer2.address);
    expect(await tokenManager.signersLength()).eq(2);

    expect(await tokenManager.isSigner(deployer.address)).eq(false);
    expect(await tokenManager.isSigner(signer1.address)).eq(true);
    expect(await tokenManager.isSigner(deployer.address)).eq(false);
    expect(await tokenManager.isSigner(bob.address)).eq(false);
  });

  it("signalApprove", async () => {
    await expect(
      tokenManager.connect(alice).signalApprove(eth.address, bob.address, toWei(5, 18)),
    ).to.be.revertedWith("TokenManager: forbidden");

    await tokenManager.connect(deployer).signalApprove(eth.address, bob.address, toWei(5, 18));
  });

  it("signApprove", async () => {
    await expect(
      tokenManager.connect(alice).signApprove(eth.address, bob.address, toWei(5, 18), 1),
    ).to.be.revertedWith("TokenManager: forbidden");

    await expect(
      tokenManager.connect(signer1).signApprove(eth.address, bob.address, toWei(5, 18), 1),
    ).to.be.revertedWith("TokenManager: action not signalled");

    await tokenManager.connect(deployer).signalApprove(eth.address, bob.address, toWei(5, 18));

    await expect(
      tokenManager.connect(alice).signApprove(eth.address, bob.address, toWei(5, 18), 1),
    ).to.be.revertedWith("TokenManager: forbidden");

    await tokenManager.connect(signer1).signApprove(eth.address, bob.address, toWei(5, 18), 1);

    await expect(
      tokenManager.connect(signer1).signApprove(eth.address, bob.address, toWei(5, 18), 1),
    ).to.be.revertedWith("TokenManager: already signed");

    await tokenManager.connect(signer2).signApprove(eth.address, bob.address, toWei(5, 18), 1);
  });

  it("approve", async () => {
    await eth.mint(tokenManager.address, toWei(5, 18));

    await expect(
      tokenManager.connect(alice).approve(eth.address, bob.address, toWei(5, 18), 1),
    ).to.be.revertedWith("TokenManager: forbidden");

    await expect(
      tokenManager.connect(deployer).approve(eth.address, bob.address, toWei(5, 18), 1),
    ).to.be.revertedWith("TokenManager: action not signalled");

    await tokenManager.connect(deployer).signalApprove(eth.address, bob.address, toWei(5, 18));

    await expect(
      tokenManager.connect(deployer).approve(xdx.address, bob.address, toWei(5, 18), 1),
    ).to.be.revertedWith("TokenManager: action not signalled");

    await expect(
      tokenManager.connect(deployer).approve(eth.address, alice.address, toWei(5, 18), 1),
    ).to.be.revertedWith("TokenManager: action not signalled");

    await expect(
      tokenManager.connect(deployer).approve(eth.address, bob.address, toWei(6, 18), 1),
    ).to.be.revertedWith("TokenManager: action not signalled");

    await expect(
      tokenManager.connect(deployer).approve(eth.address, bob.address, toWei(5, 18), 1),
    ).to.be.revertedWith("TokenManager: action not authorized");

    await tokenManager.connect(signer1).signApprove(eth.address, bob.address, toWei(5, 18), 1);

    await expect(
      tokenManager.connect(deployer).approve(eth.address, bob.address, toWei(5, 18), 1),
    ).to.be.revertedWith("TokenManager: insufficient authorization");

    await tokenManager.connect(signer2).signApprove(eth.address, bob.address, toWei(5, 18), 1);

    await expect(
      eth.connect(bob).transferFrom(tokenManager.address, bob.address, toWei(4, 18)),
    ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");

    await tokenManager.connect(deployer).approve(eth.address, bob.address, toWei(5, 18), 1);

    await expect(
      eth.connect(bob).transferFrom(tokenManager.address, bob.address, toWei(6, 18)),
    ).to.be.revertedWith("ERC20: transfer amount exceeds balance");

    expect(await eth.balanceOf(bob.address)).eq(0);
    await eth.connect(bob).transferFrom(tokenManager.address, bob.address, toWei(5, 18));
    expect(await eth.balanceOf(bob.address)).eq(toWei(5, 18));
  });

  it("signalSetAdmin", async () => {
    await expect(
      tokenManager.connect(alice).signalSetAdmin(timelock.address, bob.address),
    ).to.be.revertedWith("TokenManager: forbidden");

    await expect(
      tokenManager.connect(deployer).signalSetAdmin(timelock.address, bob.address),
    ).to.be.revertedWith("TokenManager: forbidden");

    await tokenManager.connect(signer1).signalSetAdmin(timelock.address, bob.address);
  });

  it("signSetAdmin", async () => {
    await expect(
      tokenManager.connect(alice).signSetAdmin(timelock.address, bob.address, 1),
    ).to.be.revertedWith("TokenManager: forbidden");

    await expect(
      tokenManager.connect(deployer).signSetAdmin(timelock.address, bob.address, 1),
    ).to.be.revertedWith("TokenManager: forbidden");

    await expect(
      tokenManager.connect(signer1).signSetAdmin(timelock.address, bob.address, 1),
    ).to.be.revertedWith("TokenManager: action not signalled");

    await tokenManager.connect(signer1).signalSetAdmin(timelock.address, bob.address);

    await expect(
      tokenManager.connect(alice).signSetAdmin(timelock.address, bob.address, 1),
    ).to.be.revertedWith("TokenManager: forbidden");

    await expect(
      tokenManager.connect(signer1).signSetAdmin(timelock.address, bob.address, 1),
    ).to.be.revertedWith("TokenManager: already signed");

    await tokenManager.connect(signer2).signSetAdmin(timelock.address, bob.address, 1);

    await expect(
      tokenManager.connect(signer2).signSetAdmin(timelock.address, bob.address, 1),
    ).to.be.revertedWith("TokenManager: already signed");
  });

  it("setAdmin", async () => {
    await expect(tokenManager.connect(alice).setAdmin(timelock.address, bob.address, 1)).to.be.revertedWith(
      "TokenManager: forbidden",
    );

    await expect(
      tokenManager.connect(deployer).setAdmin(timelock.address, bob.address, 1),
    ).to.be.revertedWith("TokenManager: forbidden");

    await expect(tokenManager.connect(signer1).setAdmin(timelock.address, bob.address, 1)).to.be.revertedWith(
      "TokenManager: action not signalled",
    );

    await tokenManager.connect(signer1).signalSetAdmin(timelock.address, bob.address);

    await expect(tokenManager.connect(signer1).setAdmin(alice.address, bob.address, 1)).to.be.revertedWith(
      "TokenManager: action not signalled",
    );

    await expect(
      tokenManager.connect(signer1).setAdmin(timelock.address, alice.address, 1),
    ).to.be.revertedWith("TokenManager: action not signalled");

    await expect(tokenManager.connect(signer1).setAdmin(timelock.address, bob.address, 2)).to.be.revertedWith(
      "TokenManager: action not signalled",
    );

    await expect(tokenManager.connect(signer1).setAdmin(timelock.address, bob.address, 1)).to.be.revertedWith(
      "TokenManager: insufficient authorization",
    );

    await tokenManager.connect(signer2).signSetAdmin(timelock.address, bob.address, 1);

    expect(await timelock.admin()).eq(deployer.address);
    await tokenManager.connect(signer2).setAdmin(timelock.address, bob.address, 1);
    expect(await timelock.admin()).eq(bob.address);
  });

  it("signalSetGov", async () => {
    await expect(
      tokenManager.connect(alice).signalSetGov(timelock.address, xdx.address, bob.address),
    ).to.be.revertedWith("TokenManager: forbidden");

    await tokenManager.connect(deployer).signalSetGov(timelock.address, xdx.address, bob.address);
  });

  it("signSetGov", async () => {
    await expect(
      tokenManager.connect(alice).signSetGov(timelock.address, xdx.address, bob.address, 1),
    ).to.be.revertedWith("TokenManager: forbidden");

    await expect(
      tokenManager.connect(signer2).signSetGov(timelock.address, xdx.address, bob.address, 1),
    ).to.be.revertedWith("TokenManager: action not signalled");

    await tokenManager.connect(deployer).signalSetGov(timelock.address, xdx.address, bob.address);

    await expect(
      tokenManager.connect(alice).signSetGov(timelock.address, xdx.address, bob.address, 1),
    ).to.be.revertedWith("TokenManager: forbidden");

    await tokenManager.connect(signer2).signSetGov(timelock.address, xdx.address, bob.address, 1);

    await expect(
      tokenManager.connect(signer2).signSetGov(timelock.address, xdx.address, bob.address, 1),
    ).to.be.revertedWith("TokenManager: already signed");

    await tokenManager.connect(signer1).signSetGov(timelock.address, xdx.address, bob.address, 1);
  });

  it("setGov", async () => {
    await xdx.setGov(xdxTimelock.address);

    await expect(
      tokenManager.connect(alice).setGov(xdxTimelock.address, xdx.address, bob.address, 1),
    ).to.be.revertedWith("TokenManager: forbidden");

    await expect(
      tokenManager.connect(deployer).setGov(xdxTimelock.address, xdx.address, bob.address, 1),
    ).to.be.revertedWith("TokenManager: action not signalled");

    await tokenManager.connect(deployer).signalSetGov(xdxTimelock.address, xdx.address, bob.address);

    await expect(
      tokenManager.connect(deployer).setGov(signer2.address, xdx.address, bob.address, 1),
    ).to.be.revertedWith("TokenManager: action not signalled");

    await expect(
      tokenManager.connect(deployer).setGov(xdxTimelock.address, alice.address, bob.address, 1),
    ).to.be.revertedWith("TokenManager: action not signalled");

    await expect(
      tokenManager.connect(deployer).setGov(xdxTimelock.address, xdx.address, signer2.address, 1),
    ).to.be.revertedWith("TokenManager: action not signalled");

    await expect(
      tokenManager.connect(deployer).setGov(xdxTimelock.address, xdx.address, bob.address, 1 + 1),
    ).to.be.revertedWith("TokenManager: action not signalled");

    await expect(
      tokenManager.connect(deployer).setGov(xdxTimelock.address, xdx.address, bob.address, 1),
    ).to.be.revertedWith("TokenManager: action not authorized");

    await tokenManager.connect(signer1).signSetGov(xdxTimelock.address, xdx.address, bob.address, 1);

    await expect(
      tokenManager.connect(deployer).setGov(xdxTimelock.address, xdx.address, bob.address, 1),
    ).to.be.revertedWith("TokenManager: insufficient authorization");

    await expect(xdxTimelock.connect(alice).signalSetGov(xdx.address, bob.address)).to.be.revertedWith(
      "XdxTimelock: forbidden",
    );

    await tokenManager.connect(signer2).signSetGov(xdxTimelock.address, xdx.address, bob.address, 1);

    await expect(xdxTimelock.connect(deployer).setGov(xdx.address, bob.address)).to.be.revertedWith(
      "XdxTimelock: action not signalled",
    );

    await tokenManager.connect(deployer).setGov(xdxTimelock.address, xdx.address, bob.address, 1);

    await expect(xdxTimelock.connect(deployer).setGov(xdx.address, bob.address)).to.be.revertedWith(
      "XdxTimelock: action time not yet passed",
    );

    await advanceTimeAndBlock(6 * 24 * 60 * 60 + 10);

    await expect(xdxTimelock.connect(deployer).setGov(xdx.address, bob.address)).to.be.revertedWith(
      "XdxTimelock: action time not yet passed",
    );

    await advanceTimeAndBlock(1 * 24 * 60 * 60 + 10);

    expect(await xdx.gov()).eq(xdxTimelock.address);
    await xdxTimelock.connect(deployer).setGov(xdx.address, bob.address);
    expect(await xdx.gov()).eq(bob.address);
  });
});
