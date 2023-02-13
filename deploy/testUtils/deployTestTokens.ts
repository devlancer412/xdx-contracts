import { DeployFunction } from "hardhat-deploy/types";
import { PriceFeed__factory, Token__factory } from "../../types";
import { Ship } from "../../utils";
import { TokenData, tokens } from "../../config";
import { toChainlinkPrice } from "../../utils";

const func: DeployFunction = async (hre) => {
  const { deploy } = await Ship.init(hre);

  let network = hre.network.name;
  if (network != "avax" && network != "avax_test") {
    network = "avax";
  }

  if (!hre.network.tags.prod) {
    for (const index in tokens[network as "avax" | "avax_test"]) {
      if (index == "nativeToken") continue;

      const token = (tokens[network as "avax" | "avax_test"] as never)[index] as TokenData;
      await deploy(Token__factory, {
        aliasName: token.name,
        args: [token.name, token.name, token.decimals],
      });
      if (!hre.network.tags.live) {
        const priceFeed = await deploy(PriceFeed__factory, {
          aliasName: token.name + "PriceFeed",
        });
        await priceFeed.contract.setLatestAnswer(toChainlinkPrice(token.testPrice ?? 0));
        console.log(token.name, ": set price to ", token.testPrice);
      }
    }
  }
};

export default func;
func.tags = ["tokens"];
