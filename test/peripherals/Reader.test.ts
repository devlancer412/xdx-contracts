import { Token, Vault__factory, Vault, Reader, Reader__factory } from "../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Ship, toWei } from "../../utils";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let vault: Vault;
let reader: Reader;

let usdc: Token;
let btc: Token;
let avax: Token;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture(["vault", "vaultPriceFeed", "reader", "tokens"]);

  return {
    ship,
    accounts,
    users,
  };
});

describe("Reader", () => {
  beforeEach(async () => {
    await setup();

    usdc = (await ship.connect("usdc")) as Token;
    btc = (await ship.connect("btc")) as Token;
    avax = (await ship.connect("avax")) as Token;

    vault = await ship.connect(Vault__factory);
    reader = await ship.connect(Reader__factory);
  });

  it("getVaultTokenInfo", async () => {
    const results = await reader.getVaultTokenInfo(vault.address, avax.address, toWei(1, 30), [
      btc.address,
      usdc.address,
    ]);
    expect(results.length).eq(20);
  });
});
