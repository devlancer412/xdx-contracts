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
  Router,
  Router__factory,
  VaultUtils__factory,
  VaultUtils,
  VaultErrorController__factory,
  VaultErrorController,
  Token__factory,
  PriceFeed__factory,
} from "../../../types";
import { deployments } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { Ship, toChainlinkPrice, toUsd } from "../../../utils";
import { BigNumberish } from "ethers";

chai.use(solidity);
const { expect } = chai;

let ship: Ship;
let vault: Vault;
let vaultPriceFeed: VaultPriceFeed;
let vaultUtils: VaultUtils;
let vaultErrorController: VaultErrorController;
let router: Router;
let usdg: USDG;
let btc: Token;
let avax: Token;
let avaxPriceFeed: PriceFeed;

let newToken: Token;
let newTokenPriceFeed: PriceFeed;

let deployer: SignerWithAddress;
let alice: SignerWithAddress;
let bob: SignerWithAddress;

const setup = deployments.createFixture(async (hre) => {
  ship = await Ship.init(hre);
  const { accounts, users } = ship;
  await deployments.fixture(["vault", "vaultPriceFeed", "usdg", "tokens", "router"]);

  return {
    ship,
    accounts,
    users,
  };
});

describe("Vault.settings", function () {
  beforeEach(async function () {
    const { accounts } = await setup();

    deployer = accounts.deployer;
    alice = accounts.alice;
    bob = accounts.bob;

    vault = await ship.connect(Vault__factory);
    vaultPriceFeed = await ship.connect(VaultPriceFeed__factory);
    vaultUtils = await ship.connect(VaultUtils__factory);
    vaultErrorController = await ship.connect(VaultErrorController__factory);
    router = await ship.connect(Router__factory);
    usdg = await ship.connect(USDG__factory);

    newToken = (
      await ship.deploy(Token__factory, {
        args: ["Token", "Token", 18],
      })
    ).contract;
    newTokenPriceFeed = (await ship.deploy(PriceFeed__factory)).contract;

    btc = (await ship.connect("btc")) as Token;
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

    await vaultPriceFeed.setIsSecondaryPriceEnabled(false);

    await vault.setInManagerMode(false);

    vaultPriceFeed.setTokenConfig(newToken.address, newTokenPriceFeed.address, 8, false);
  });

  it("inits", async () => {
    expect(await usdg.gov()).eq(deployer.address);
    expect(await usdg.vaults(vault.address)).eq(true);
    expect(await usdg.vaults(alice.address)).eq(false);

    expect(await vault.gov()).eq(deployer.address);
    expect(await vault.isInitialized()).eq(true);
    expect(await vault.router()).eq(router.address);
    expect(await vault.usdg()).eq(usdg.address);
    expect(await vault.priceFeed()).eq(vaultPriceFeed.address);
    expect(await vault.liquidationFeeUsd()).eq(toUsd(5));
    expect(await vault.fundingRateFactor()).eq(600);
    expect(await vault.stableFundingRateFactor()).eq(600);
  });

  it("setVaultUtils", async () => {
    await expect(vault.connect(alice).setVaultUtils(bob.address)).to.be.revertedWith("Vault: forbidden");

    await vault.setGov(alice.address);

    expect(await vault.vaultUtils()).eq(vaultUtils.address);
    await vault.connect(alice).setVaultUtils(bob.address);
    expect(await vault.vaultUtils()).eq(bob.address);
  });

  it("setMaxGlobalShortSize", async () => {
    await expect(vault.connect(alice).setMaxGlobalShortSize(avax.address, 1000)).to.be.revertedWith(
      "Vault: forbidden",
    );

    await vault.setGov(alice.address);

    expect(await vault.maxGlobalShortSizes(avax.address)).eq(0);
    expect(await vault.maxGlobalShortSizes(btc.address)).eq(0);
    await vault.connect(alice).setMaxGlobalShortSize(avax.address, 1000);
    await vault.connect(alice).setMaxGlobalShortSize(btc.address, 7000);
    expect(await vault.maxGlobalShortSizes(avax.address)).eq(1000);
    expect(await vault.maxGlobalShortSizes(btc.address)).eq(7000);
  });

  it("setInManagerMode", async () => {
    await expect(vault.connect(alice).setInManagerMode(true)).to.be.revertedWith("Vault: forbidden");

    await vault.setGov(alice.address);

    expect(await vault.inManagerMode()).eq(false);
    await vault.connect(alice).setInManagerMode(true);
    expect(await vault.inManagerMode()).eq(true);
  });

  it("setManager", async () => {
    await expect(vault.connect(alice).setManager(bob.address, true)).to.be.revertedWith("Vault: forbidden");

    await vault.setGov(alice.address);

    expect(await vault.isManager(bob.address)).eq(false);
    await vault.connect(alice).setManager(bob.address, true);
    expect(await vault.isManager(bob.address)).eq(true);
  });

  it("setInPrivateLiquidationMode", async () => {
    await expect(vault.connect(alice).setInPrivateLiquidationMode(true)).to.be.revertedWith(
      "Vault: forbidden",
    );

    await vault.setGov(alice.address);

    expect(await vault.inPrivateLiquidationMode()).eq(false);
    await vault.connect(alice).setInPrivateLiquidationMode(true);
    expect(await vault.inPrivateLiquidationMode()).eq(true);
  });

  it("setIsSwapEnabled", async () => {
    await expect(vault.connect(alice).setIsSwapEnabled(false)).to.be.revertedWith("Vault: forbidden");

    await vault.setGov(alice.address);

    expect(await vault.isSwapEnabled()).eq(true);
    await vault.connect(alice).setIsSwapEnabled(false);
    expect(await vault.isSwapEnabled()).eq(false);
  });

  it("setIsLeverageEnabled", async () => {
    await expect(vault.connect(alice).setIsLeverageEnabled(false)).to.be.revertedWith("Vault: forbidden");

    await vault.setGov(alice.address);

    expect(await vault.isLeverageEnabled()).eq(true);
    await vault.connect(alice).setIsLeverageEnabled(false);
    expect(await vault.isLeverageEnabled()).eq(false);
  });

  it("setMaxGasPrice", async () => {
    await expect(vault.connect(alice).setMaxGasPrice(20)).to.be.revertedWith("Vault: forbidden");

    await vault.setGov(alice.address);

    expect(await vault.maxGasPrice()).eq(0);
    await vault.connect(alice).setMaxGasPrice(20);
    expect(await vault.maxGasPrice()).eq(20);
  });

  it("setGov", async () => {
    await expect(vault.connect(alice).setGov(bob.address)).to.be.revertedWith("Vault: forbidden");

    expect(await vault.gov()).eq(deployer.address);

    await vault.setGov(alice.address);
    expect(await vault.gov()).eq(alice.address);

    await vault.connect(alice).setGov(bob.address);
    expect(await vault.gov()).eq(bob.address);
  });

  it("setPriceFeed", async () => {
    await expect(vault.connect(alice).setPriceFeed(bob.address)).to.be.revertedWith("Vault: forbidden");

    await vault.setGov(alice.address);

    expect(await vault.priceFeed()).eq(vaultPriceFeed.address);
    await vault.connect(alice).setPriceFeed(bob.address);
    expect(await vault.priceFeed()).eq(bob.address);
  });

  it("setMaxLeverage", async () => {
    await expect(vault.connect(alice).setMaxLeverage(10000)).to.be.revertedWith("Vault: forbidden");

    await vault.setGov(alice.address);

    await expect(vault.connect(alice).setMaxLeverage(10000)).to.be.revertedWith(
      "Vault: invalid _maxLeverage",
    );

    expect(await vault.maxLeverage()).eq(50 * 10000);
    await vault.connect(alice).setMaxLeverage(10001);
    expect(await vault.maxLeverage()).eq(10001);
  });

  it("setBufferAmount", async () => {
    await expect(vault.connect(alice).setBufferAmount(avax.address, 700)).to.be.revertedWith(
      "Vault: forbidden",
    );

    await vault.setGov(alice.address);

    expect(await vault.bufferAmounts(avax.address)).eq(0);
    await vault.connect(alice).setBufferAmount(avax.address, 700);
    expect(await vault.bufferAmounts(avax.address)).eq(700);
  });

  it("setFees", async () => {
    await expect(
      vault.connect(alice).setFees(
        90, // _taxBasisPoints
        91, // _stableTaxBasisPoints
        92, // _mintBurnFeeBasisPoints
        93, // _swapFeeBasisPoints
        94, // _stableSwapFeeBasisPoints
        95, // _marginFeeBasisPoints
        toUsd(8), // _liquidationFeeUsd
        96, // _minProfitTime
        true, // _hasDynamicFees
      ),
    ).to.be.revertedWith("Vault: forbidden");

    await vault.setGov(alice.address);

    expect(await vault.taxBasisPoints()).eq(50);
    expect(await vault.stableTaxBasisPoints()).eq(20);
    expect(await vault.mintBurnFeeBasisPoints()).eq(30);
    expect(await vault.swapFeeBasisPoints()).eq(30);
    expect(await vault.stableSwapFeeBasisPoints()).eq(4);
    expect(await vault.marginFeeBasisPoints()).eq(10);
    expect(await vault.liquidationFeeUsd()).eq(toUsd(5));
    expect(await vault.minProfitTime()).eq(3600);
    expect(await vault.hasDynamicFees()).eq(false);
    await vault.connect(alice).setFees(
      90, // _taxBasisPoints
      91, // _stableTaxBasisPoints
      92, // _mintBurnFeeBasisPoints
      93, // _swapFeeBasisPoints
      94, // _stableSwapFeeBasisPoints
      95, // _marginFeeBasisPoints
      toUsd(8), // _liquidationFeeUsd
      96, // _minProfitTime
      true, // _hasDynamicFees
    );
    expect(await vault.taxBasisPoints()).eq(90);
    expect(await vault.stableTaxBasisPoints()).eq(91);
    expect(await vault.mintBurnFeeBasisPoints()).eq(92);
    expect(await vault.swapFeeBasisPoints()).eq(93);
    expect(await vault.stableSwapFeeBasisPoints()).eq(94);
    expect(await vault.marginFeeBasisPoints()).eq(95);
    expect(await vault.liquidationFeeUsd()).eq(toUsd(8));
    expect(await vault.minProfitTime()).eq(96);
    expect(await vault.hasDynamicFees()).eq(true);
  });

  it("setFundingRate", async () => {
    await expect(vault.connect(alice).setFundingRate(59 * 60, 10001, 10001)).to.be.revertedWith(
      "Vault: forbidden",
    );

    await vault.setGov(alice.address);

    await expect(vault.connect(alice).setFundingRate(59 * 60, 10001, 10001)).to.be.revertedWith(
      "Vault: invalid _fundingInterval",
    );

    await expect(vault.connect(alice).setFundingRate(60 * 60, 10001, 10001)).to.be.revertedWith(
      "Vault: invalid _fundingRateFactor",
    );

    await expect(vault.connect(alice).setFundingRate(60 * 60, 10000, 10001)).to.be.revertedWith(
      "Vault: invalid _stableFundingRateFactor",
    );

    expect(await vault.fundingInterval()).eq(60 * 60);
    expect(await vault.fundingRateFactor()).eq(600);
    expect(await vault.stableFundingRateFactor()).eq(600);
    await vault.connect(alice).setFundingRate(60 * 60, 10000, 10000);
    expect(await vault.fundingInterval()).eq(60 * 60);
    expect(await vault.fundingRateFactor()).eq(10000);
    expect(await vault.stableFundingRateFactor()).eq(10000);

    await vault.connect(alice).setFundingRate(120 * 60, 1000, 2000);
    expect(await vault.fundingInterval()).eq(120 * 60);
    expect(await vault.fundingRateFactor()).eq(1000);
    expect(await vault.stableFundingRateFactor()).eq(2000);
  });

  it("setTokenConfig", async () => {
    const params: [string, BigNumberish, BigNumberish, BigNumberish, BigNumberish, boolean, boolean] = [
      newToken.address, // _token
      18, // _tokenDecimals
      10000, // _tokenWeight
      75, // _minProfitBps
      0, // _maxUsdgAmount
      true, // _isStable
      true, // _isShortable
    ];

    await expect(vault.connect(alice).setTokenConfig(...params)).to.be.revertedWith("Vault: forbidden");

    await expect(vault.setTokenConfig(...params)).to.be.revertedWith("VaultPriceFeed: could not fetch price");

    await newTokenPriceFeed.setLatestAnswer(toChainlinkPrice(300));

    expect(await vault.whitelistedTokenCount()).eq(7);
    expect(await vault.whitelistedTokens(newToken.address)).eq(false);
    expect(await vault.tokenDecimals(newToken.address)).eq(0);
    expect(await vault.tokenWeights(newToken.address)).eq(0);
    expect(await vault.totalTokenWeights()).eq(100001);
    expect(await vault.minProfitBasisPoints(newToken.address)).eq(0);
    expect(await vault.maxUsdgAmounts(newToken.address)).eq(0);
    expect(await vault.stableTokens(newToken.address)).eq(false);
    expect(await vault.shortableTokens(newToken.address)).eq(false);
    expect(await vault.allWhitelistedTokensLength()).eq(7);

    await vault.setTokenConfig(...params);

    expect(await vault.whitelistedTokenCount()).eq(8);
    expect(await vault.whitelistedTokens(newToken.address)).eq(true);
    expect(await vault.tokenDecimals(newToken.address)).eq(18);
    expect(await vault.tokenWeights(newToken.address)).eq(10000);
    expect(await vault.totalTokenWeights()).eq(110001);
    expect(await vault.minProfitBasisPoints(newToken.address)).eq(75);
    expect(await vault.maxUsdgAmounts(newToken.address)).eq(0);
    expect(await vault.stableTokens(newToken.address)).eq(true);
    expect(await vault.shortableTokens(newToken.address)).eq(true);
    expect(await vault.allWhitelistedTokensLength()).eq(8);
  });

  it("clearTokenConfig", async () => {
    const params: [string, BigNumberish, BigNumberish, BigNumberish, BigNumberish, boolean, boolean] = [
      newToken.address, // _token
      18, // _tokenDecimals
      7000, // _tokenWeight
      75, // _minProfitBps
      500, // _maxUsdgAmount
      true, // _isStable
      true, // _isShortable
    ];

    await newTokenPriceFeed.setLatestAnswer(toChainlinkPrice(300));

    expect(await vault.whitelistedTokenCount()).eq(7);
    expect(await vault.whitelistedTokens(newToken.address)).eq(false);
    expect(await vault.tokenDecimals(newToken.address)).eq(0);
    expect(await vault.tokenWeights(newToken.address)).eq(0);
    expect(await vault.totalTokenWeights()).eq(100001);
    expect(await vault.minProfitBasisPoints(newToken.address)).eq(0);
    expect(await vault.maxUsdgAmounts(newToken.address)).eq(0);
    expect(await vault.stableTokens(newToken.address)).eq(false);
    expect(await vault.shortableTokens(newToken.address)).eq(false);

    await vault.setTokenConfig(...params);

    expect(await vault.whitelistedTokenCount()).eq(8);
    expect(await vault.whitelistedTokens(newToken.address)).eq(true);
    expect(await vault.tokenDecimals(newToken.address)).eq(18);
    expect(await vault.tokenWeights(newToken.address)).eq(7000);
    expect(await vault.totalTokenWeights()).eq(107001);
    expect(await vault.minProfitBasisPoints(newToken.address)).eq(75);
    expect(await vault.maxUsdgAmounts(newToken.address)).eq(500);
    expect(await vault.stableTokens(newToken.address)).eq(true);
    expect(await vault.shortableTokens(newToken.address)).eq(true);

    await expect(vault.connect(alice).clearTokenConfig(newToken.address)).to.be.revertedWith(
      "Vault: forbidden",
    );

    await vault.clearTokenConfig(newToken.address);

    expect(await vault.whitelistedTokenCount()).eq(7);
    expect(await vault.whitelistedTokens(newToken.address)).eq(false);
    expect(await vault.tokenDecimals(newToken.address)).eq(0);
    expect(await vault.tokenWeights(newToken.address)).eq(0);
    expect(await vault.totalTokenWeights()).eq(100001);
    expect(await vault.minProfitBasisPoints(newToken.address)).eq(0);
    expect(await vault.maxUsdgAmounts(newToken.address)).eq(0);
    expect(await vault.stableTokens(newToken.address)).eq(false);
    expect(await vault.shortableTokens(newToken.address)).eq(false);

    await expect(vault.clearTokenConfig(newToken.address)).to.be.revertedWith("Vault: token not whitelisted");
  });

  it("addRouter", async () => {
    expect(await vault.approvedRouters(alice.address, bob.address)).eq(false);
    await vault.connect(alice).addRouter(bob.address);
    expect(await vault.approvedRouters(alice.address, bob.address)).eq(true);
  });

  it("removeRouter", async () => {
    expect(await vault.approvedRouters(alice.address, bob.address)).eq(false);
    await vault.connect(alice).addRouter(bob.address);
    expect(await vault.approvedRouters(alice.address, bob.address)).eq(true);
    await vault.connect(alice).removeRouter(bob.address);
    expect(await vault.approvedRouters(alice.address, bob.address)).eq(false);
  });

  it("setUsdgAmount", async () => {
    await avaxPriceFeed.setLatestAnswer(toChainlinkPrice(300));
    await avax.mint(alice.address, 100);
    await avax.connect(alice).transfer(vault.address, 100);
    await vault.connect(alice).buyUSDG(avax.address, bob.address);

    expect(await vault.usdgAmounts(avax.address)).eq(29700);

    await expect(vault.connect(alice).setUsdgAmount(avax.address, 50000)).to.be.revertedWith(
      "Vault: forbidden",
    );

    await vault.setGov(alice.address);

    expect(await vault.usdgAmounts(avax.address)).eq(29700);
    await vault.connect(alice).setUsdgAmount(avax.address, 50000);
    expect(await vault.usdgAmounts(avax.address)).eq(50000);

    await vault.connect(alice).setUsdgAmount(avax.address, 10000);
    expect(await vault.usdgAmounts(avax.address)).eq(10000);
  });

  it("upgradeVault", async () => {
    await avax.mint(vault.address, 1000);

    await expect(vault.connect(alice).upgradeVault(bob.address, avax.address, 1000)).to.be.revertedWith(
      "Vault: forbidden",
    );

    await vault.setGov(alice.address);

    expect(await avax.balanceOf(vault.address)).eq(1000);
    expect(await avax.balanceOf(bob.address)).eq(0);
    await vault.connect(alice).upgradeVault(bob.address, avax.address, 1000);
    expect(await avax.balanceOf(vault.address)).eq(0);
    expect(await avax.balanceOf(bob.address)).eq(1000);
  });

  it("setErrorController", async () => {
    await expect(vault.connect(alice).setErrorController(vaultErrorController.address)).to.be.revertedWith(
      "Vault: forbidden",
    );

    await vault.setGov(alice.address);

    await vault.connect(alice).setErrorController(vaultErrorController.address);
    expect(await vault.errorController()).eq(vaultErrorController.address);

    expect(await vault.errors(0)).eq("Vault: zero error");
    expect(await vault.errors(1)).eq("Vault: already initialized");
    expect(await vault.errors(2)).eq("Vault: invalid _maxLeverage");

    await expect(
      vaultErrorController.connect(alice).setErrors(vault.address, ["Example Error 1", "Example Error 2"]),
    ).to.be.revertedWith("Governable: forbidden");

    await vaultErrorController.setErrors(vault.address, ["Example Error 1", "Example Error 2"]);

    expect(await vault.errors(0)).eq("Example Error 1");
    expect(await vault.errors(1)).eq("Example Error 2");
    expect(await vault.errors(2)).eq("Vault: invalid _maxLeverage");
  });
});
