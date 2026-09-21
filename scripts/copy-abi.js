// Copia los ABI compilados a frontend/abi para que el front (sin bundler)
// pueda importarlos directamente como JSON estatico.
const fs = require("fs");
const path = require("path");

const artifactsDir = path.join(__dirname, "..", "artifacts", "contracts");
const outDir = path.join(__dirname, "..", "frontend", "abi");

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const contratos = [
  { archivo: "FuentePagoDemo.sol/FuentePagoDemo.json", nombre: "FuentePagoDemo.json" },
  { archivo: "FuentePagoFactory.sol/FuentePagoFactory.json", nombre: "FuentePagoFactory.json" },
];

for (const { archivo, nombre } of contratos) {
  const origen = path.join(artifactsDir, archivo);
  const { abi } = JSON.parse(fs.readFileSync(origen, "utf8"));
  fs.writeFileSync(path.join(outDir, nombre), JSON.stringify(abi, null, 2));
  console.log("ABI copiado:", nombre);
}
