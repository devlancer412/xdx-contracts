import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  VaultPriceFeed__factory,
  Token,
  Vault__factory,
  Vault,
  VaultPriceFeed,
  PriceFeed,
  XlxManager,
  XlxManager__factory,
} from "../../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Ship, toChainlinkPrice, toUsd } from "../../../utils";
import { validateVaultBalance } from "./shared";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let vault: Vault;
let vaultPriceFeed: VaultPriceFeed;
let btc: Token;
let btcPriceFeed: PriceFeed;
let avax: Token;
let avaxPriceFeed: PriceFeed;

let xlxManager: XlxManager;

let alice: SignerWithAddress;
let bob: SignerWithAddress;
let user: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture(["vault", "vaultPriceFeed", "usdg", "tokens", "xlxManager"]);

  return {
    ship,
    accounts,
    users,
  };
});

describe("Vault.directPoolDeposit", function () {
  beforeEach(async function () {
    const { accounts, users } = await setup();

    alice = accounts.alice;
    bob = accounts.bob;
    user = users[0];

    vault = await ship.connect(Vault__factory);
    vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
    xlxManager = await ship.connect(XlxManager__factory);

    btc = (await ship.connect("btc")) as Token;
    btcPriceFeed = (await ship.connect("btcPriceFeed")) as PriceFeed;
    avax = (await ship.connect("avax")) as Token;
    avaxPriceFeed = (await ship.connect("avaxPriceFeed")) as PriceFeed;

    await vault.setFees(
      50, // _taxBasisPoints
      20, // _stableTaxBasisPoints
      30, // _mintBurnFeeBasisPoints
      30, // _swapFeeBasisPoints
      4, // _stableSwapFeeBasisPoints
      10, // _marginFeeBasisPoints
      toUsd(5), // _liquidationFeeUsd
      60 * 60, // _minProfitTime
      false, // _hasDynamicFees
    );
    await vault.setFundingRate(60 * 60, 600, 600);

    await xlxManager.setCooldownDuration(24 * 60 * 60);
    await xlxManager.setShortsTrackerAveragePriceWeight(10000);
    await xlxManager.setInPrivateMode(false);
    await vaultPriceFeed.setIsSecondaryPriceEnabled(false);

    // await vault.setInManagerMode(false);
  });

  it("directPoolDeposit", async () => {
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));

    await expect(vault.connect(alice).directPoolDeposit(avax.address)).to.be.revertedWith(
      "Vault: invalid tokenAmount",
    );

    await avax.mint(alice.address, 1000);
    await avax.connect(alice).transfer(vault.address, 1000);

    expect(await vault.poolAmounts(avax.address)).eq(0);
    await vault.connect(alice).directPoolDeposit(avax.address);
    expect(await vault.poolAmounts(avax.address)).eq(1000);

    await validateVaultBalance(vault, avax);
  });
});
