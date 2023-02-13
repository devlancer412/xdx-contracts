import { DeployFunction } from "hardhat-deploy/types";
import {
  PositionRouter__factory,
  FastPriceFeed__factory,
  FastPriceEvents__factory,
  VaultPriceFeed__factory,
  PriceFeedTimelock__factory,
  Vault__factory,
  USDG__factory,
  Router__factory,
  PriceFeed,
} from "../../types";
import { Ship, toUsd, toWei } from "../../utils";
import { TokenData, tokens, signers as configSigners, updaters as configUpdaters } from "../../config";

const func: DeployFunction = async (hre) => {
  const { deploy, connect, accounts } = await Ship.init(hre);

  const { signer1, signer2, deployer, updater1, updater2 } = accounts;

  let network = hre.network.name;
  if (network != "avax" && network != "avax_test") {
    network = "avax";
  }
  const { avax, btc, btcb, eth, usdce, usdc } = tokens[network as "avax" | "avax_test"];
  const tokenArr = [avax, btc, btcb, eth, usdce, usdc];
  const fastPriceTokens = [avax, btc, btcb, eth];

  let signers: string[];
  let updaters: string[];

  if (hre.network.tags.prod) {
    signers = configSigners;
    updaters = configUpdaters;
  } else {
    signers = [signer1.address, signer2.address];
    updaters = [updater1.address, updater2.address];

    for (const token of tokenArr) {
      const tokenContract = await connect(token.name);
      token.address = tokenContract.address;
      if (!hre.network.tags.live) {
        const priceFeedContract = (await connect(token.name + "PriceFeed")) as PriceFeed;
        token.priceFeed = priceFeedContract.address;
      }
    }
  }

  if (fastPriceTokens.find((t) => !t.fastPricePrecision)) {
    throw new Error("Invalid price precision");
  }

  if (fastPriceTokens.find((t) => !t.maxCumulativeDeltaDiff)) {
    throw new Error("Invalid price maxCumulativeDeltaDiff");
  }

  const vault = await connect(Vault__factory);
  const usdg = await connect(USDG__factory);
  const router = await connect(Router__factory);
  const positionRouter = await connect(PositionRouter__factory);
  const priceFeedTimelock = await connect(PriceFeedTimelock__factory);

  const fastPriceEvents = await deploy(FastPriceEvents__factory);

  const fastPriceFeed = await deploy(FastPriceFeed__factory, {
    args: [
      5 * 60, // _priceDuration
      60 * 60, // _maxPriceUpdateDelay
      1, // _minBlockInterval
      250, // _maxDeviationBasisPoints
      fastPriceEvents.address, // _fastPriceEvents
      deployer.address, // _tokenManager
      positionRouter.address,
    ],
  });
  const vaultPriceFeed = await deploy(VaultPriceFeed__factory);

  if (fastPriceFeed.newlyDeployed || vaultPriceFeed.newlyDeployed) {
    let tx = await vaultPriceFeed.contract.setSecondaryPriceFeed(fastPriceFeed.address);
    console.log("Set secondary price feed to VaultPriceFeed  at", tx.hash);
    await tx.wait();

    tx = await fastPriceFeed.contract.setVaultPriceFeed(vaultPriceFeed.address);
    console.log("Set vault price feed to FastPriceFeed  at", tx.hash);
    await tx.wait();
  }

  if (fastPriceEvents.newlyDeployed || fastPriceFeed.newlyDeployed) {
    const tx = await fastPriceEvents.contract.setIsPriceFeed(fastPriceFeed.address, true);
    console.log("Set price feed to FastPriceEvents at", tx.hash);
    await tx.wait();
  }
  if (fastPriceFeed.newlyDeployed) {
    let tx = await fastPriceFeed.contract.initialize(signers.length, signers, updaters);
    console.log("Initialize FastPriceFeed at", tx.hash);
    await tx.wait();

    tx = await fastPriceFeed.contract.setTokens(
      fastPriceTokens.map((t) => t.address),
      fastPriceTokens.map((t) => t.fastPricePrecision),
    );
    console.log("Set tokens to FastPriceFeed at", tx.hash);
    await tx.wait();

    tx = await fastPriceFeed.contract.setMaxTimeDeviation(60 * 60);
    console.log("Set max time deviation to FastPriceFeed at", tx.hash);
    await tx.wait();

    tx = await fastPriceFeed.contract.setSpreadBasisPointsIfInactive(50);
    console.log("Set spread points if inactive to FastPriceFeed at", tx.hash);
    await tx.wait();

    tx = await fastPriceFeed.contract.setSpreadBasisPointsIfChainError(500);
    console.log("Set spread basis points if chain error to FastPriceFeed at", tx.hash);
    await tx.wait();

    tx = await fastPriceFeed.contract.setMaxCumulativeDeltaDiffs(
      fastPriceTokens.map((t) => t.address),
      fastPriceTokens.map((t) => t.maxCumulativeDeltaDiff),
    );
    console.log("Set max cumulative delta diffs to FastPriceFeed at", tx.hash);
    await tx.wait();

    tx = await fastPriceFeed.contract.setPriceDataInterval(1 * 60);
    console.log("Set price data interval to FastPriceFeed at", tx.hash);
    await tx.wait();

    tx = await positionRouter.setPositionKeeper(fastPriceFeed.address, true);
    console.log("Set FastPriceFeed to position keeper of PositionRouter at", tx.hash);
    await tx.wait();

    if (hre.network.tags.live) {
      tx = await fastPriceFeed.contract.setGov(priceFeedTimelock.address);
      console.log("Set gov to FastPriceFeed at", tx.hash);
      await tx.wait();
    }
    console.log("FastPriceFeeed: initialized");
  }

  if (vaultPriceFeed.newlyDeployed) {
    let tx = await vaultPriceFeed.contract.setMaxStrictPriceDeviation(toWei(1, 28));
    console.log("Set set max strict price deviation to VaultPriceFeed at", tx.hash);
    await tx.wait();

    tx = await vaultPriceFeed.contract.setPriceSampleSpace(3);
    console.log("Set price sample space to VaultPriceFeed at", tx.hash);
    await tx.wait();

    tx = await vaultPriceFeed.contract.setIsAmmEnabled(false);
    console.log("Set set amm enabled to VaultPriceFeed at", tx.hash);
    await tx.wait();

    tx = await vault.initialize(
      router.address, // router
      usdg.address, // usdg
      vaultPriceFeed.address, // priceFeed
      hre.network.tags.live ? toUsd(2) : toUsd(5), // liquidationFeeUsd
      100, // fundingRateFactor
      100, // stableFundingRateFactor
    );
    console.log("Initialize vault at", tx.hash);
    await tx.wait();

    for (const tokenItem of tokenArr) {
      const token = tokenItem as TokenData;
      if (token.spreadBasisPoints !== undefined) {
        const tx = await vaultPriceFeed.contract.setSpreadBasisPoints(
          tokenItem.address, // _token
          token.spreadBasisPoints, // _spreadBasisPoints
        );
        console.log("Set spread basis points of", tokenItem.name, " to VaultPriceFeed at", tx.hash);
        await tx.wait();
      }
    }

    for (const token of tokenArr) {
      let tx = await vaultPriceFeed.contract.setTokenConfig(
        token.address, // _token
        token.priceFeed, // _priceFeed
        token.priceDecimals, // _priceDecimals
        token.isStrictStable, // _isStrictStable
      );
      console.log("Set token config of", token.name, " to VaultPriceFeed at", tx.hash);
      await tx.wait();

      tx = await vault.setTokenConfig(
        token.address, // _token
        token.decimals, // _tokenDecimals
        token.tokenWeight, // _tokenWeight
        hre.network.tags.live ? token.minProfitBps : 75, // _minProfitBps
        toWei(token.maxUsdgAmount, 30), // _maxUsdgAmount
        token.isStable, // _isStable
        token.isShortable, // _isShortable
      );
      console.log("Set token config of", token.name, " to vault at", tx.hash);
      await tx.wait();
    }

    if (hre.network.tags.live) {
      const tx = await vaultPriceFeed.contract.setGov(priceFeedTimelock.address);
      console.log("Set gov to vault at", tx.hash);
      await tx.wait();
    }
    console.log("VaultPriceFeeed: initialized");
  }
};

export default func;
func.tags = ["fastPriceFeed", "vaultPriceFeed", "fastPriceEvents"];
func.dependencies = ["positionRouter", "priceFeedTimelock", "tokens", "vault", "usdg", "router"];
