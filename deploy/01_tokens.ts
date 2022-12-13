import { DeployFunction } from "hardhat-deploy/types";
import {
  VaultPriceFeed__factory,
  Vault__factory,
  XLX__factory,
  XDX__factory,
  EsXDX__factory,
  MintableBaseToken__factory,
  USDG__factory,
} from "../types";
import { Ship } from "../utils";

const func: DeployFunction = async (hre) => {
  const { deploy } = await Ship.init(hre);
  await deploy(VaultPriceFeed__factory);
  const vault = await deploy(Vault__factory);
  await deploy(XLX__factory);
  await deploy(XDX__factory);
  await deploy(EsXDX__factory);
  await deploy(MintableBaseToken__factory, {
    aliasName: "BN_XDX",
    args: ["Bonus XDX", "bnXDX", 0],
  });
  await deploy(USDG__factory, {
    args: [vault.address],
  });
  await deploy(MintableBaseToken__factory, {
    aliasName: "ES_XDX_IOU",
    args: ["esXDX IOU", "esXDX:IOU", 0],
  });
};

export default func;
func.tags = ["tokens"];
