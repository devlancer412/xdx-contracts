import { DeployFunction } from "hardhat-deploy/types";
import {
  Router__factory,
  ShortsTracker__factory,
  USDG__factory,
  VaultErrorController__factory,
  VaultUtils__factory,
  Vault__factory,
  XlxManager__factory,
  XLX__factory,
} from "../../types";
import { Ship, toUsd } from "../../utils";
import { tokens, errors, NativeToken } from "../../config";

const func: DeployFunction = async (hre) => {
  const { deploy, connect, accounts } = await Ship.init(hre);

  const { deployer } = accounts;

  let network = hre.network.name;
  if (network != "avax" && network != "avax_test") {
    network = "avax";
  }
  const nativeToken = tokens[network as "avax" | "avax_test"].nativeToken as NativeToken;

  if (!hre.network.tags.prod) {
    const nativeTokenContract = await connect(nativeToken.name);
    nativeToken.address = nativeTokenContract.address;
  }

  const vault = await deploy(Vault__factory);
  const usdg = await deploy(USDG__factory, {
    args: [vault.address],
  });
  await deploy(Router__factory, {
    args: [vault.address, usdg.address, nativeToken.address],
  });

  const xlx = await deploy(XLX__factory);
  if (xlx.newlyDeployed) {
    const tx = await xlx.contract.setInPrivateTransferMode(true);
    console.log("Set InPrivateTransferMode to xlx at ", tx.hash);
    await tx.wait();
  }

  const shortsTracker = await deploy(ShortsTracker__factory, {
    args: [vault.address],
  });
  if (shortsTracker.newlyDeployed) {
    const tx = await shortsTracker.contract.setGov(deployer.address);
    console.log("Set gov to ShortsTracker at ", tx.hash);
    await tx.wait();
  }

  const xlxManager = await deploy(XlxManager__factory, {
    args: [vault.address, usdg.address, xlx.address, shortsTracker.address, "900"], // 900 = 60 * 15
  });
  if (xlxManager.newlyDeployed) {
    const tx = await xlxManager.contract.setInPrivateMode(true);
    console.log("SetPrivateMode to XlxManager at ", tx.hash);
    await tx.wait();
  }
  if (xlxManager.newlyDeployed || xlx.newlyDeployed) {
    const tx = await xlx.contract.setMinter(xlxManager.address, true);
    console.log("XLX: set minter to XlxManager at ", tx.hash);
    await tx.wait();
  }
  if (xlxManager.newlyDeployed || usdg.newlyDeployed) {
    const tx = await usdg.contract.addVault(xlxManager.address);
    console.log("USDG: add vault to XlxManger at ", tx.hash);
    await tx.wait();
  }

  if (vault.newlyDeployed) {
    let tx = await vault.contract.setFundingRate(60 * 60, 100, 100);
    console.log("Set funding rate to vault", tx.hash);
    await tx.wait();
    tx = await vault.contract.setInManagerMode(true);
    console.log("Set InManagerMode to true", tx.hash);
    await tx.wait();
    tx = await vault.contract.setFees(
      10, // _taxBasisPoints
      5, // _stableTaxBasisPoints
      25, // _mintBurnFeeBasisPoints
      20, // _swapFeeBasisPoints
      1, // _stableSwapFeeBasisPoints
      10, // _marginFeeBasisPoints
      toUsd(5), // _liquidationFeeUsd
      3 * 60 * 60, // _minProfitTime
      true, // _hasDynamicFees
    );
    console.log("Set fees to vault", tx.hash);
    await tx.wait();
  }

  if (vault.newlyDeployed || xlxManager.newlyDeployed) {
    const tx = await vault.contract.setManager(xlxManager.address, true);
    console.log("Set manager to vault at ", tx.hash);
    await tx.wait();
  }

  const vaultErrorController = await deploy(VaultErrorController__factory);
  if (vaultErrorController.newlyDeployed || vault.newlyDeployed) {
    let tx = await vault.contract.setErrorController(vaultErrorController.address);
    console.log("Set ErrorController to vault at ", tx.hash);
    await tx.wait();
    tx = await vaultErrorController.contract.setErrors(vault.address, errors);
    console.log("Set errors to vault at ", tx.hash);
    await tx.wait();
  }

  const vaultUtils = await deploy(VaultUtils__factory, {
    args: [vault.address],
  });
  if (vault.newlyDeployed || vaultUtils.newlyDeployed) {
    const tx = await vault.contract.setVaultUtils(vaultUtils.address);
    console.log("Set vaultUtils at ", tx.hash);
    await tx.wait();
  }
};

export default func;
func.tags = [
  "vault",
  "usdg",
  "router",
  "xlx",
  "shortsTracker",
  "xlxManager",
  "vaultErrorController",
  "vaultUtils",
  "nativeToken",
];
func.dependencies = ["tokens"];
