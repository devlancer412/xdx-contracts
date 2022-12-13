import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { PeggedPalladium, PeggedPalladium__factory } from "../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Ship } from "../utils";
import { parseEther } from "ethers/lib/utils";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let token: PeggedPalladium;
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

describe("Pegged Palladium test", () => {
  before(async () => {
    const scaffold = await setup();

    alice = scaffold.accounts.alice;
    bob = scaffold.accounts.bob;
    deployer = scaffold.accounts.deployer;
    signer = scaffold.accounts.signer;

    token = await scaffold.ship.connect(PeggedPalladium__factory);
  });

  describe("Ownership test", () => {
    it("Normal user can't mint token", async () => {
      await expect(token.connect(alice).mint(10)).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Owner can mint token", async () => {
      const tx = await token.connect(deployer).mint(1000);
      tx.wait();
      expect(await token.balanceOf(deployer.address)).to.eq(1000);
    });

    it("Can't transfer token to non-whitelist member", async () => {
      await expect(token.connect(deployer).transfer(alice.address, 10)).to.be.revertedWith(
        "PPALD: Receiver is not whitelist",
      );
    });

    it("Can transfer to whitelist member", async () => {
      const tx = await token.connect(deployer).setWhiteList(alice.address, true);
      await tx.wait();

      const tx1 = await token.connect(deployer).transfer(alice.address, 10);
      await tx1.wait();
      expect(await token.balanceOf(alice.address)).to.eq(10);

      const tx2 = await token.connect(deployer).setWhiteList(alice.address, false);
      await tx2.wait();
    });

    it("Normal user can't burn token", async () => {
      await expect(token.connect(alice).burn(10)).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Owner can burn token", async () => {
      const tx = await token.connect(deployer).burn(10);
      tx.wait();
      expect(await token.balanceOf(deployer.address)).to.eq(980);
    });

    it("Normal user can't set whitelist", async () => {
      await expect(token.connect(alice).setWhiteList(alice.address, true)).to.be.revertedWith(
        "Ownable: caller is not the owner",
      );
    });
  });
});
