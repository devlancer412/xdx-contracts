import { DeployFunction } from "hardhat-deploy/types";
import { Token__factory } from "../../types";
import { Ship } from "../../utils";
import { TokenData, tokens } from "../../config";

const func: DeployFunction = async (hre) => {
  const { deploy } = await Ship.init(hre);

  if (!hre.network.tags.prod) {
    for (const index in tokens.avax) {
      const token = (tokens.avax as never)[index] as TokenData;
      await deploy(Token__factory, {
        aliasName: token.name,
        args: [token.name, token.name, 18],
      });
    }
  }
};

export default func;
func.tags = ["tokens"];
