import { DeployFunction } from "hardhat-deploy/types";
import {
  Router__factory,
  Vault__factory,
  ShortsTracker__factory,
  ReferralStorage__factory,
  Timelock__factory,
  PositionRouter__factory,
} from "../../types";
import { Ship } from "../../utils";
import { NativeToken, tokens } from "../../config";

const depositFee = 30; // 0.3%
const minExecutionFee = "100000000000000"; // 0.0001 ETH

const func: DeployFunction = async (hre) => {
  const { deploy, connect, accounts } = await Ship.init(hre);

  const nativeToken = tokens.avax.nativeToken as NativeToken;

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
    await positionRouter.contract.setDelayValues(1, 180, 30 * 60);
    await positionRouter.contract.setGov(await vault.gov());

    await shortsTracker.setHandler(positionRouter.address, true);
    await router.addPlugin(positionRouter.address);
  }
};

export default func;
func.tags = ["positionRouter"];
func.dependencies = ["vault", "shortsTracker", "router", "tokens"];
