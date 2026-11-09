// Direcciones desplegadas (ver salida de `npx hardhat run scripts/deploy.js --network localhost`)
// Actualiza estos valores cada vez que redespliegues los contratos.
window.APP_CONFIG = {
  RPC_URL: "http://127.0.0.1:8545",
  FACTORY_ADDRESS: "0xE6E340D132b5f46d1e472DebcD681B2aBc16e57E",
  OBLIGACION_ADDRESS: "0x4F57F9239eFCBf43e5920f579D03B3849C588396",
  // Red esperada (Hardhat local por defecto). Cambia el chainId si usas testnet.
  CHAIN_ID_ESPERADO: 31337,
};
