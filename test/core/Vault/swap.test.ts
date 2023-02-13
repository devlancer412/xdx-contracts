import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  VaultPriceFeed__factory,
  Token,
  Vault__factory,
  USDG,
  USDG__factory,
  Vault,
  VaultPriceFeed,
  PriceFeed,
  XlxManager,
  XlxManager__factory,
} from "../../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { reportGasUsed, Ship, toChainlinkPrice, toUsd, toWei } from "../../../utils";
import { BigNumberish } from "ethers";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let vault: Vault;
let vaultPriceFeed: VaultPriceFeed;
let usdg: USDG;
let btc: Token;
let btcPriceFeed: PriceFeed;
let eth: Token;
let ethPriceFeed: PriceFeed;
let avax: Token;
let avaxPriceFeed: PriceFeed;

let xlxManager: XlxManager;

let deployer: SignerWithAddress;
let user0: SignerWithAddress;
let user1: SignerWithAddress;
let user2: SignerWithAddress;
let user3: SignerWithAddress;

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

describe("Vault.swap", function () {
  beforeEach(async function () {
    const { accounts, users } = await setup();

    deployer = accounts.deployer;
    user0 = users[0];
    user1 = users[1];
    user2 = users[2];
    user3 = users[3];

    vault = await ship.connect(Vault__factory);
    vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
    usdg = await ship.connect(USDG__factory);
    xlxManager = await ship.connect(XlxManager__factory);

    btc = (await ship.connect("btc")) as Token;
    btcPriceFeed = (await ship.connect("btcPriceFeed")) as PriceFeed;
    eth = (await ship.connect("eth")) as Token;
    ethPriceFeed = (await ship.connect("ethPriceFeed")) as PriceFeed;
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
    await vault.setManager(deployer.address, true);
    await vault.setFundingRate(60 * 60, 600, 600);

    await xlxManager.setCooldownDuration(24 * 60 * 60);
    await xlxManager.setShortsTrackerAveragePriceWeight(10000);
    await xlxManager.setInPrivateMode(false);
    await vaultPriceFeed.setIsSecondaryPriceEnabled(false);

    await vault.setManager(user0.address, true);
  });

  it("swap", async () => {
    await vault.setIsSwapEnabled(false);

    await expect(vault.connect(user1).swap(avax.address, btc.address, user2.address)).to.be.revertedWith(
      "Vault: swaps not enabled",
    );

    await vault.setIsSwapEnabled(true);

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));

    await expect(vault.connect(user1).swap(avax.address, avax.address, user2.address)).to.be.revertedWith(
      "Vault: invalid tokens",
    );

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));

    await avax.mint(user0.address, toWei(200, 18));
    await btc.mint(user0.address, toWei(1, 8));

    expect(await xlxManager.getAumInUsdg(false)).eq(0);

    await avax.connect(user0).transfer(vault.address, toWei(200, 18));
    await vault.connect(user0).buyUSDG(avax.address, user0.address);

    expect(await xlxManager.getAumInUsdg(false)).eq(toWei(59820, 18)); // 60,000 * 99.7%

    await btc.connect(user0).transfer(vault.address, toWei(1, 8));
    await vault.connect(user0).buyUSDG(btc.address, user0.address);

    expect(await xlxManager.getAumInUsdg(false)).eq(toWei(119640, 18)); // 59,820 + (60,000 * 99.7%)

    expect(await usdg.balanceOf(user0.address)).eq(toWei(120000, 18).sub(toWei(360, 18))); // 120,000 * 0.3% => 360

    expect(await vault.feeReserves(avax.address)).eq("600000000000000000"); // 200 * 0.3% => 0.6
    expect(await vault.usdgAmounts(avax.address)).eq(toWei(200 * 300, 18).sub(toWei(180, 18))); // 60,000 * 0.3% => 180
    expect(await vault.poolAmounts(avax.address)).eq(toWei(200, 18).sub("600000000000000000"));

    expect(await vault.feeReserves(btc.address)).eq("300000"); // 1 * 0.3% => 0.003
    expect(await vault.usdgAmounts(btc.address)).eq(toWei(200 * 300, 18).sub(toWei(180, 18)));
    expect(await vault.poolAmounts(btc.address)).eq(toWei(1, 8).sub("300000"));

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(400));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(600));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(500));

    expect(await xlxManager.getAumInUsdg(false)).eq(toWei(139580, 18)); // 59,820 / 300 * 400 + 59820

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(90000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(100000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(80000));

    expect(await xlxManager.getAumInUsdg(false)).eq(toWei(159520, 18)); // 59,820 / 300 * 400 + 59820 / 60000 * 80000

    await avax.mint(user1.address, toWei(100, 18));
    await avax.connect(user1).transfer(vault.address, toWei(100, 18));

    expect(await btc.balanceOf(user1.address)).eq(0);
    expect(await btc.balanceOf(user2.address)).eq(0);
    const tx = await vault.connect(user1).swap(avax.address, btc.address, user2.address);
    await reportGasUsed(tx, "swap gas used");

    expect(await xlxManager.getAumInUsdg(false)).eq(toWei(167520, 18)); // 159520 + (100 * 400) - 32000

    expect(await btc.balanceOf(user1.address)).eq(0);
    expect(await btc.balanceOf(user2.address)).eq(toWei(4, 7).sub("120000")); // 0.8 - 0.0012

    expect(await vault.feeReserves(avax.address)).eq("600000000000000000"); // 200 * 0.3% => 0.6
    expect(await vault.usdgAmounts(avax.address)).eq(
      toWei(100 * 400, 18)
        .add(toWei(200 * 300, 18))
        .sub(toWei(180, 18)),
    );
    expect(await vault.poolAmounts(avax.address)).eq(
      toWei(100, 18).add(toWei(200, 18)).sub("600000000000000000"),
    );

    expect(await vault.feeReserves(btc.address)).eq("420000"); // 1 * 0.3% => 0.003, 0.4 * 0.3% => 0.0012
    expect(await vault.usdgAmounts(btc.address)).eq(
      toWei(200 * 300, 18)
        .sub(toWei(180, 18))
        .sub(toWei(100 * 400, 18)),
    );
    expect(await vault.poolAmounts(btc.address)).eq(toWei(1, 8).sub("300000").sub(toWei(4, 7))); // 59700000, 0.597 BTC, 0.597 * 100,000 => 59700

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(400));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(500));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(450));

    expect(await avax.balanceOf(user0.address)).eq(0);
    expect(await avax.balanceOf(user3.address)).eq(0);
    await usdg.connect(user0).transfer(vault.address, toWei(50000, 18));
    await vault.sellUSDG(avax.address, user3.address);
    expect(await avax.balanceOf(user0.address)).eq(0);
    expect(await avax.balanceOf(user3.address)).eq("99700000000000000000"); // 99.7, 50000 / 500 * 99.7%

    await usdg.connect(user0).transfer(vault.address, toWei(50000, 18));
    await vault.sellUSDG(btc.address, user3.address);

    await usdg.connect(user0).transfer(vault.address, toWei(10000, 18));
    await expect(vault.sellUSDG(btc.address, user3.address)).to.be.revertedWith("Vault: poolAmount exceeded");
  });

  it("caps max USDG amount", async () => {
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(600));
    await ethPriceFeed.setLatestAnswer(toChainlinkPrice(3000));

    const avaxConfig: [string, BigNumberish, BigNumberish, BigNumberish, BigNumberish, boolean, boolean] = [
      avax.address, // _token
      18, // _tokenDecimals
      10000, // _tokenWeight
      75, // _minProfitBps,
      0, // _maxUsdgAmount
      false, // _isStable
      true, // _isShortable
    ];
    const ethConfig: [string, BigNumberish, BigNumberish, BigNumberish, BigNumberish, boolean, boolean] = [
      eth.address, // _token
      18, // _tokenDecimals
      10000, // _tokenWeight
      75, // _minProfitBps,
      0, // _maxUsdgAmount
      false, // _isStable
      true, // _isShortable
    ];

    avaxConfig[4] = toWei(150000, 18);
    await vault.setTokenConfig(...avaxConfig);

    ethConfig[4] = toWei(30000, 18);
    await vault.setTokenConfig(...ethConfig);

    await avax.mint(user0.address, toWei(499, 18));
    await avax.connect(user0).transfer(vault.address, toWei(499, 18));
    await vault.connect(user0).buyUSDG(avax.address, user0.address);

    await eth.mint(user0.address, toWei(10, 18));
    await eth.connect(user0).transfer(vault.address, toWei(10, 18));
    await vault.connect(user0).buyUSDG(eth.address, user1.address);

    await avax.mint(user0.address, toWei(10, 18));
    await avax.connect(user0).transfer(vault.address, toWei(10, 18));

    await expect(vault.connect(user0).buyUSDG(avax.address, user0.address)).to.be.revertedWith(
      "Vault: max USDG exceeded",
    );

    avaxConfig[4] = toWei(153000, 18);
    await vault.setTokenConfig(...avaxConfig);

    await vault.connect(user0).buyUSDG(avax.address, user0.address);

    await avax.mint(user0.address, toWei(10, 18));
    await avax.connect(user0).transfer(vault.address, toWei(10, 18));
    await expect(vault.connect(user0).swap(avax.address, eth.address, user1.address)).to.be.revertedWith(
      "Vault: max USDG exceeded",
    );

    avaxConfig[4] = toWei(299700, 18);
    await vault.setTokenConfig(...avaxConfig);
    await vault.connect(user0).swap(avax.address, eth.address, user1.address);
  });

  it("does not cap max USDG debt", async () => {
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(600));
    await ethPriceFeed.setLatestAnswer(toChainlinkPrice(3000));

    await avax.mint(user0.address, toWei(100, 18));
    await avax.connect(user0).transfer(vault.address, toWei(100, 18));
    await vault.connect(user0).buyUSDG(avax.address, user0.address);

    await eth.mint(user0.address, toWei(10, 18));

    expect(await eth.balanceOf(user0.address)).eq(toWei(10, 18));
    expect(await avax.balanceOf(user1.address)).eq(0);

    await eth.connect(user0).transfer(vault.address, toWei(10, 18));
    await vault.connect(user0).swap(eth.address, avax.address, user1.address);

    expect(await eth.balanceOf(user0.address)).eq(0);
    expect(await avax.balanceOf(user1.address)).eq("49850000000000000000");

    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));

    await eth.mint(user0.address, toWei(1, 18));
    await eth.connect(user0).transfer(vault.address, toWei(1, 18));
    await vault.connect(user0).swap(eth.address, avax.address, user1.address);
  });

  it("ensures poolAmount >= buffer", async () => {
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(600));
    await ethPriceFeed.setLatestAnswer(toChainlinkPrice(3000));

    await avax.mint(user0.address, toWei(100, 18));
    await avax.connect(user0).transfer(vault.address, toWei(100, 18));
    await vault.connect(user0).buyUSDG(avax.address, user0.address);

    await vault.setBufferAmount(avax.address, "94700000000000000000"); // 94.7

    expect(await vault.poolAmounts(avax.address)).eq("99700000000000000000"); // 99.7
    expect(await vault.poolAmounts(eth.address)).eq(0);
    expect(await avax.balanceOf(user1.address)).eq(0);
    expect(await eth.balanceOf(user1.address)).eq(0);

    await eth.mint(user0.address, toWei(1, 18));
    await eth.connect(user0).transfer(vault.address, toWei(1, 18));
    await vault.connect(user0).swap(eth.address, avax.address, user1.address);

    expect(await vault.poolAmounts(avax.address)).eq("94700000000000000000"); // 94.7
    expect(await vault.poolAmounts(eth.address)).eq(toWei(1, 18));
    expect(await avax.balanceOf(user1.address)).eq("4985000000000000000"); // 4.985
    expect(await eth.balanceOf(user1.address)).eq(0);

    await eth.mint(user0.address, toWei(1, 18));
    await eth.connect(user0).transfer(vault.address, toWei(1, 18));
    await expect(vault.connect(user0).swap(eth.address, avax.address, user1.address)).to.be.revertedWith(
      "Vault: poolAmount < buffer",
    );
  });
});
