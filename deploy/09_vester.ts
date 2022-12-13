import { DeployFunction } from "hardhat-deploy/types";
import { EsXDX__factory, Vester__factory, XDX__factory } from "../types";
import { Ship } from "../utils";

const func: DeployFunction = async (hre) => {
  const { deploy, connect } = await Ship.init(hre);

  const esXdx = await connect(EsXDX__factory);
  const xdx = await connect(XDX__factory);
  const feeXdxTracker = await connect("FeeXdxTracker");
  const stakedXdxTracker = await connect("StakedXdxTracker");
  const stakedXlxTracker = await connect("StakedXlxTracker");

  await deploy(Vester__factory, {
    aliasName: "XdxVester",
    args: [
      "Vested XDX",
      "vXDX",
      31536000,
      esXdx.address,
      feeXdxTracker.address,
      xdx.address,
      stakedXdxTracker.address,
    ],
  });

  await deploy(Vester__factory, {
    aliasName: "XlxVester",
    args: [
      "Vested XLX",
      "vXLX",
      31536000,
      esXdx.address,
      stakedXlxTracker.address,
      xdx.address,
      stakedXdxTracker.address,
    ],
  });
};

export default func;
func.tags = ["vester"];
func.dependencies = ["rewardTracker"];
