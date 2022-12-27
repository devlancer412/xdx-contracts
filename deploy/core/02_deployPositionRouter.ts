import { DeployFunction } from "hardhat-deploy/types";
import {
  Router__factory,
  Vault__factory,
  ShortsTracker__factory,
  PositionRouter__factory,
} from "../../types";
import { Ship } from "../../utils";
import { NativeToken, tokens } from "../../config";

const depositFee = 30; // 0.3%
const minExecutionFee = "100000000000000"; // 0.0001 ETH

const func: DeployFunction = async (hre) => {
  const { deploy, connect } = await Ship.init(hre);

  const nativeToken = tokens[hre.network.name as "avax" | "avax_test"].nativeToken as NativeToken;

  if (!hre.network.tags.prod) {
    const nativeTokenContract = await connect(nativeToken.name);
    nativeToken.address = nativeTokenContract.address;
  }

  const vault = await connect(Vault__factory);
  const router = await connect(Router__factory);
  const shortsTracker = await connect(ShortsTracker__factory);

  const positionRouter = await deploy(PositionRouter__factory, {
    args: [
      vault.address,
      router.address,
      nativeToken.address,
      shortsTracker.address,
      depositFee,
      minExecutionFee,
    ],
  });

  if (positionRouter.newlyDeployed) {
    let tx = await positionRouter.contract.setDelayValues(1, 180, 30 * 60);
    console.log("Set delay value to PositionRouter at ", tx.hash);
    await tx.wait();
    // await positionRouter.contract.setGov(await vault.gov());

    tx = await shortsTracker.setHandler(positionRouter.address, true);
    console.log("Set PositionRouter to handler of ShortsTracker at ", tx.hash);
    await tx.wait();
    tx = await router.addPlugin(positionRouter.address);
    console.log("Add PositionRouter to plugin of router at ", tx.hash);
    await tx.wait();
  }
};

export default func;
func.tags = ["positionRouter"];
func.dependencies = ["vault", "shortsTracker", "router", "tokens"];
