import { DeployFunction } from "hardhat-deploy/types";
import {
  Vault__factory,
  VaultErrorController__factory,
  Router__factory,
  USDG__factory,
  VaultPriceFeed__factory,
  VaultUtils__factory,
} from "../types";
import { Ship, toUsd } from "../utils";
import { errors } from "../config/vaultErrors";

const func: DeployFunction = async (hre) => {
  const { deploy, connect } = await Ship.init(hre);

  const vault = await connect(Vault__factory);
  const router = await connect(Router__factory);
  const usdg = await connect(USDG__factory);
  const priceFeed = await connect(VaultPriceFeed__factory);

  await vault.initialize(
    router.address, // router
    usdg.address, // usdg
    priceFeed.address, // priceFeed
    toUsd(5), // liquidationFeeUsd
    600, // fundingRateFactor
    600, // stableFundingRateFactor
  );

  const vaultUtils = await deploy(VaultUtils__factory, {
    args: [vault.address],
  });
  await vault.setVaultUtils(vaultUtils.address);

  const vaultErrorController = await deploy(VaultErrorController__factory);

  await vault.setErrorController(vaultErrorController.address);
  await vaultErrorController.contract.setErrors(vault.address, errors);
};

export default func;
func.tags = ["initVault"];
func.dependencies = ["tokens", "router"];
