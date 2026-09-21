const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Desplegando contratos con la cuenta:", deployer.address);

  const Factory = await hre.ethers.getContractFactory("FuentePagoFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();

  const factoryAddress = await factory.getAddress();
  console.log("FuentePagoFactory desplegada en:", factoryAddress);

  // Obligacion de demostracion, administrada por el mismo deployer (backend demo)
  const tx = await factory.crearFuentePago("OBLIGACION-DEMO-001", deployer.address);
  const receipt = await tx.wait();

  const evento = receipt.logs
    .map((log) => {
      try {
        return factory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed && parsed.name === "ObligacionDesplegada");

  const obligacionAddress = evento.args.contratoObligacion;
  console.log("FuentePagoDemo (demo) desplegada en:", obligacionAddress);

  console.log("\n=== Copia estos valores en frontend/config.js ===");
  console.log("FACTORY_ADDRESS =", factoryAddress);
  console.log("OBLIGACION_ADDRESS =", obligacionAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
