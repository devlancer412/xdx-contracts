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
});
