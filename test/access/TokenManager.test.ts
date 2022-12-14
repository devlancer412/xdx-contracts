import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { TokenManager, TokenManager__factory } from "../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Ship } from "../../utils";
import { parseEther } from "ethers/lib/utils";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let tokenManager: TokenManager;

let alice: SignerWithAddress;
let bob: SignerWithAddress;
let signer: SignerWithAddress;
let deployer: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture(["token"]);

  return {
    ship,
    accounts,
    users,
  };
});

describe("TokenManager", () => {
  before(async () => {
    const scaffold = await setup();

    alice = scaffold.accounts.alice;
    bob = scaffold.accounts.bob;
    deployer = scaffold.accounts.deployer;
    signer = scaffold.accounts.signer;

    tokenManager = await scaffold.ship.connect(TokenManager__factory);
  });
});
