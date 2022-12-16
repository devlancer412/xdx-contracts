import { DeployFunction } from "hardhat-deploy/types";
import { EsXdxBatchSender__factory, EsXDX__factory, Timelock__factory, Vester } from "../../types";
import { Ship } from "../../utils";

const func: DeployFunction = async (hre) => {
  const { deploy, connect } = await Ship.init(hre);

  const esXdx = await connect(EsXDX__factory);
  const esXdxGov = await connect(Timelock__factory, await esXdx.gov());
  const xdxVester = (await connect("XdxVester")) as Vester;
  const xdxVesterGov = await connect(Timelock__factory, await xdxVester.gov());
  const xlxVester = (await connect("XlxVester")) as Vester;
  const xlxVesterGov = await connect(Timelock__factory, await xlxVester.gov());

  const esXdxBatchSender = await deploy(EsXdxBatchSender__factory, {
    args: [esXdx.address],
  });

  if (esXdxBatchSender.newlyDeployed) {
    await esXdxGov.signalSetHandler(esXdx.address, esXdxBatchSender.address, true);
    await xdxVesterGov.signalSetHandler(esXdx.address, esXdxBatchSender.address, true);
    await xlxVesterGov.signalSetHandler(esXdx.address, esXdxBatchSender.address, true);
  }
};

export default func;
func.tags = ["esXdxBatchSender"];
func.dependencies = ["esXdx", "xdxVester", "xlxVester", "timelock"];
