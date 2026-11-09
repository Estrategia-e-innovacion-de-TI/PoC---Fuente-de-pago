const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

describe("Conexion del frontend", function () {
  function preparar({ sinContrato = false, chainIdRpc = 31337n, errorCreacion,
    owner = "0x0000000000000000000000000000000000000001", registros, creada = true } = {}) {
    const elementos = new Map();
    const handlers = {};
    const cuenta = "0x0000000000000000000000000000000000000001";
    const fuentes = registros || [{ direccion: cuenta, identificador: "OBL-PRUEBA", creada, administrador: cuenta }];
    const llamadas = [];
    function elemento(id) {
      if (!elementos.has(id)) {
        elementos.set(id, {
          textContent: "", disabled: false, value: "", dataset: {}, children: [],
          addEventListener(evento, handler) { this[evento] = handler; }, prepend() {},
          replaceChildren() { this.textContent = ""; this.children = []; this.value = ""; },
          append(child) { this.children.push(child); },
        });
      }
      return elementos.get(id);
    }
    const valores = [elemento("v-id"), elemento("v-deuda")];
    const botones = [elemento("accion"), elemento("inicializar")];
    botones[0].dataset.accion = "registrarRecaudo";
    botones[1].dataset.accion = "crearObligacion";
    class BrowserProvider {
      async send() {}
      async getNetwork() { return { chainId: 31337n }; }
      async getSigner() { return { getAddress: async () => cuenta }; }
      async call() { throw new Error("Received invalid block tag 7. Latest block number is 2"); }
      async getCode() { throw new Error("No consultar codigo mediante MetaMask"); }
      destroy() { llamadas.push("wallet destruida"); }
    }
    class JsonRpcProvider {
      constructor(url) { assert.equal(url, "http://127.0.0.1:8545"); }
      async getNetwork() { return { chainId: chainIdRpc }; }
      async getCode(address, bloque) {
        assert.equal(bloque, "latest");
        return sinContrato ? "0x" : "0x1234";
      }
      destroy() { llamadas.push("rpc destruido"); }
    }
    class Contract {
      constructor(address, abi, runner) {
        this.runner = runner;
        this.address = address;
        this.crearFuentePago = async (id, administrador) => {
          assert.ok(!(this.runner instanceof JsonRpcProvider));
          llamadas.push("despliegue wallet");
          const nueva = { direccion: "0x0000000000000000000000000000000000000002", identificador: id, administrador, creada: false };
          return { wait: async () => {
            fuentes.push(nueva);
            return { logs: [{ name: "ObligacionDesplegada", args: { contratoObligacion: nueva.direccion, identificador: id } }] };
          } };
        };
        this.crearFuentePago.staticCall = async (id, administrador, opciones) => {
          this.validarLectura(opciones);
          assert.equal(opciones.from, cuenta);
          llamadas.push("despliegue simulacion rpc");
          if (fuentes.some((fuente) => fuente.identificador === id)) throw new Error("IdentificadorDuplicado()");
        };
        this.interface = { parseLog(log) { return log; } };
        this.crearObligacion = async (id) => {
          assert.ok(!(this.runner instanceof JsonRpcProvider));
          llamadas.push("crear wallet");
          llamadas.push({ metodo: "crearObligacion", direccion: address, id });
          return { wait: async () => { this.fuente().creada = true; } };
        };
        this.crearObligacion.staticCall = async (id, deuda, reserva, opciones) => {
          this.validarLectura(opciones);
          assert.equal(opciones.from, cuenta);
          assert.equal(id, this.fuente().identificador);
          assert.equal(deuda, "1000");
          assert.equal(reserva, "120");
          llamadas.push("crear simulacion rpc");
          if (errorCreacion) throw errorCreacion;
        };
        this.evaluarYAutorizarPago = async () => {
          assert.ok(!(this.runner instanceof JsonRpcProvider));
          llamadas.push("transaccion wallet");
          return { wait: async () => {} };
        };
        this.evaluarYAutorizarPago.staticCall = async (opciones) => {
          this.validarLectura(opciones);
          assert.equal(opciones.from, cuenta);
          llamadas.push("simulacion rpc");
          return [0n, 100n];
        };
        this.registrarRecaudo = async () => {
          llamadas.push({ metodo: "registrarRecaudo", direccion: address });
          return { wait: async () => {} };
        };
      }
      fuente() { return fuentes.find((fuente) => fuente.direccion === this.address) || fuentes[0]; }
      connect(runner) { return new Contract(this.address, [], runner); }
      validarLectura(opciones) {
        assert.ok(this.runner instanceof JsonRpcProvider, "Lectura enviada a MetaMask");
        assert.equal(opciones.blockTag, "latest");
      }
      async administrador(opciones) { this.validarLectura(opciones); return this.fuente().administrador; }
      async obligacionCreada(opciones) { this.validarLectura(opciones); return this.fuente().creada; }
      async owner(opciones) { this.validarLectura(opciones); return owner; }
      async queryFilter() { return fuentes.map((fuente) => ({ args: { contratoObligacion: fuente.direccion, identificador: fuente.identificador } })); }
      async consultarEstado(opciones) {
        this.validarLectura(opciones);
        return { id: this.fuente().creada ? "CASO-ACTUAL" : "", deuda: 0n };
      }
      on() { assert.ok(this.runner instanceof JsonRpcProvider); }
      async removeAllListeners() { llamadas.push("eventos eliminados"); }
    }
    const contexto = vm.createContext({
      console: { error(...datos) { llamadas.push(datos); } },
      ethers: { BrowserProvider, JsonRpcProvider, Contract, isAddress: require("ethers").isAddress, ZeroAddress: require("ethers").ZeroAddress },
      window: {
        ethereum: { on(evento, handler) { handlers[evento] = handler; } },
        APP_CONFIG: { RPC_URL: "http://127.0.0.1:8545", CHAIN_ID_ESPERADO: 31337, OBLIGACION_ADDRESS: cuenta, FACTORY_ADDRESS: "0xfactory" },
      },
      document: {
        getElementById: elemento,
        querySelectorAll(selector) { return selector === "[data-accion]" ? botones : selector === ".grid-acciones input" ? ["co-id", "co-deuda", "co-reserva", "rr-ref", "rr-valor"].map(elemento) : valores; },
        createElement() { return { textContent: "", value: "" }; },
      },
      fetch: async () => ({ ok: true, json: async () => [] }),
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../frontend/app.js"), "utf8"), contexto);
    return { contexto, elemento, handlers, llamadas, botones, fuentes, cuenta };
  }

  it("conecta y lee por RPC aunque la wallet rechace consultas a bloques antiguos", async function () {
    const { contexto, elemento } = preparar();
    await contexto.conectarWallet();
    assert.equal(elemento("v-id").textContent, "CASO-ACTUAL");
    assert.equal(elemento("mensaje-global").className, "ok");
    await contexto.limpiarConexion();
  });

  it("recupera causas profundas, datos JSON y errores circulares", function () {
    const { contexto } = preparar();
    const error = { shortMessage: "could not coalesce error", error: {
      code: -32603, message: "Internal JSON-RPC error.",
      data: JSON.stringify({ cause: { message: "Nonce too high" } }),
    }, payload: { method: "eth_sendTransaction" } };
    error.cause = error;
    assert.match(contexto.extraerMensajeError(error), /Nonce too high/);
    assert.match(contexto.extraerMensajeError(error), /codigo RPC: -32603/);
    assert.match(contexto.extraerMensajeError(error), /metodo RPC: eth_sendTransaction/);
  });

  it("conserva una causa no enumerable antes de la conversion de BrowserProvider", async function () {
    const { BrowserProvider } = require("ethers");
    const { contexto } = preparar();
    const original = new Error("Internal JSON-RPC error.", { cause: new Error("Nonce too high") });
    original.code = -32603;
    original.data = { message: "Internal JSON-RPC error.", data: "0x1234" };
    const wallet = contexto.transporteWallet({ async request(payload) {
      if (payload.method === "eth_chainId") return "0x7a69";
      throw original;
    } });
    const provider = new BrowserProvider(wallet);
    try {
      await assert.rejects(provider.send("eth_sendTransaction", [{}]), (error) => {
        const mensaje = contexto.extraerMensajeError(error);
        assert.match(mensaje, /Nonce too high/);
        assert.equal(mensaje.split("codigo RPC: -32603").length, 2);
        assert.equal(error.error.data.data, "0x1234");
        return true;
      });
    } finally {
      provider.destroy();
    }
  });

  it("simula por RPC con el administrador pero envia la transaccion por la wallet", async function () {
    const { contexto, llamadas } = preparar();
    await contexto.conectarWallet();
    await contexto.ejecutarAccion("evaluarYAutorizarPago");
    assert.ok(llamadas.includes("simulacion rpc"));
    assert.ok(llamadas.includes("transaccion wallet"));
    await contexto.limpiarConexion();
  });

  it("cambia de contrato limpiando los eventos de la obligacion anterior", async function () {
    const { contexto, llamadas, elemento } = preparar();
    await contexto.conectarWallet();
    await contexto.seleccionarObligacion("0x5678");
    assert.ok(llamadas.includes("eventos eliminados"));
    assert.equal(elemento("v-id").textContent, "CASO-ACTUAL");
    assert.equal(elemento("registro-eventos").textContent, "");
    await contexto.limpiarConexion();
  });

  it("limpia datos, eventos y ambos proveedores al cambiar de red", async function () {
    const { contexto, elemento, handlers, llamadas, botones } = preparar();
    await contexto.conectarWallet();
    await handlers.chainChanged();
    assert.equal(elemento("v-id").textContent, "-");
    assert.equal(botones[0].disabled, true);
    assert.ok(llamadas.includes("eventos eliminados"));
    assert.ok(llamadas.includes("wallet destruida"));
    assert.ok(llamadas.includes("rpc destruido"));
  });

  it("simula crear con los valores del formulario antes de enviar por MetaMask", async function () {
    const { contexto, elemento, llamadas } = preparar({ creada: false });
    await contexto.conectarWallet();
    elemento("co-id").value = "OBL-PRUEBA";
    elemento("co-deuda").value = "1000";
    elemento("co-reserva").value = "120";
    await contexto.ejecutarAccion("crearObligacion");
    assert.ok(llamadas.indexOf("crear simulacion rpc") >= 0);
    assert.ok(llamadas.indexOf("crear wallet") > llamadas.indexOf("crear simulacion rpc"));
    assert.equal(elemento("mensaje-global").textContent, "Transaccion confirmada.");
    await contexto.limpiarConexion();
  });

  it("no envia una creacion rechazada y conserva el error completo para diagnostico", async function () {
    const errorCreacion = new Error("ObligacionYaExiste()");
    const { contexto, elemento, llamadas } = preparar({ errorCreacion, creada: false });
    await contexto.conectarWallet();
    elemento("co-id").value = "OBL-PRUEBA";
    elemento("co-deuda").value = "1000";
    elemento("co-reserva").value = "120";
    await contexto.ejecutarAccion("crearObligacion");
    assert.ok(!llamadas.includes("crear wallet"));
    assert.match(elemento("mensaje-global").textContent, /ObligacionYaExiste/);
    assert.ok(llamadas.some((datos) => Array.isArray(datos) && datos[1] === errorCreacion));
    await contexto.limpiarConexion();
  });

  it("rechaza un RPC distinto de la red de la wallet", async function () {
    const { contexto, elemento } = preparar({ chainIdRpc: 1n });
    await contexto.conectarWallet();
    assert.match(elemento("mensaje-global").textContent, /misma red/);
    assert.equal(elemento("v-id").textContent, "-");
  });

  it("despliega, selecciona e inicializa una nueva obligacion sin reemplazar la anterior", async function () {
    const { contexto, elemento, fuentes, cuenta, llamadas, botones } = preparar();
    await contexto.conectarWallet();
    elemento("nueva-id").value = "OBL-SEGUNDA";
    assert.equal(elemento("nueva-admin").value, cuenta);
    await contexto.desplegarObligacion();
    assert.equal(fuentes.length, 2);
    assert.equal(fuentes[0].identificador, "OBL-PRUEBA");
    assert.equal(fuentes[0].creada, true);
    assert.equal(elemento("obligacion-select").value, fuentes[1].direccion);
    assert.equal(elemento("obligacion-select").children.length, 2);
    assert.equal(elemento("co-id").value, "OBL-SEGUNDA");
    assert.equal(elemento("estado-inicializacion").textContent, "Pendiente de inicializar");
    assert.equal(botones[0].disabled, true);
    assert.equal(botones[1].disabled, false);
    elemento("co-deuda").value = "1000";
    elemento("co-reserva").value = "120";
    await contexto.ejecutarAccion("crearObligacion");
    assert.equal(fuentes[1].creada, true);
    assert.equal(botones[1].disabled, true);
    assert.equal(botones[0].disabled, false);
    assert.ok(llamadas.some((dato) => dato.metodo === "crearObligacion" && dato.direccion === fuentes[1].direccion));
    await contexto.seleccionarObligacion(fuentes[0].direccion);
    assert.equal(elemento("co-id").value, "OBL-PRUEBA");
    assert.equal(elemento("co-deuda").value, "");
    assert.equal(elemento("co-reserva").value, "");
    await contexto.limpiarConexion();
  });

  it("no envia despliegues con identificadores duplicados", async function () {
    const { contexto, elemento, fuentes, llamadas } = preparar();
    await contexto.conectarWallet();
    elemento("nueva-id").value = "OBL-PRUEBA";
    await contexto.desplegarObligacion();
    assert.equal(fuentes.length, 1);
    assert.ok(!llamadas.includes("despliegue wallet"));
    assert.match(elemento("mensaje-global").textContent, /IdentificadorDuplicado/);
    assert.equal(elemento("btn-desplegar").disabled, false);
    await contexto.limpiarConexion();
  });

  it("impide desplegar a quien no es owner aunque sea administrador", async function () {
    const { contexto, elemento, llamadas, botones } = preparar({ owner: "0xotro" });
    await contexto.conectarWallet();
    assert.equal(elemento("btn-desplegar").disabled, true);
    assert.equal(botones[0].disabled, false);
    await contexto.desplegarObligacion();
    assert.ok(!llamadas.includes("despliegue wallet"));
    assert.match(elemento("mensaje-global").textContent, /propietario/);
    await contexto.limpiarConexion();
  });

  it("selecciona obligaciones de otros administradores en modo consulta", async function () {
    const { contexto, elemento, botones, cuenta } = preparar();
    await contexto.conectarWallet();
    elemento("nueva-id").value = "OBL-OTRO";
    elemento("nueva-admin").value = "0x0000000000000000000000000000000000000003";
    await contexto.desplegarObligacion();
    assert.ok(botones.every((boton) => boton.disabled));
    assert.equal(elemento("btn-desplegar").disabled, false);
    assert.match(elemento("mensaje-global").textContent, /Su administrador/);
    await contexto.seleccionarObligacion(cuenta);
    assert.equal(botones[0].disabled, false);
    await contexto.limpiarConexion();
  });

  it("rechaza direcciones invalidas y cero antes de abrir la wallet", async function () {
    const { contexto, elemento, llamadas } = preparar();
    await contexto.conectarWallet();
    elemento("nueva-id").value = "OBL-NUEVA";
    for (const direccion of ["direccion-invalida", require("ethers").ZeroAddress]) {
      elemento("nueva-admin").value = direccion;
      await contexto.desplegarObligacion();
      assert.match(elemento("mensaje-global").textContent, /direccion Ethereum valida/);
    }
    assert.ok(!llamadas.includes("despliegue wallet"));
    await contexto.limpiarConexion();
  });

  it("evita duplicar despliegues por doble clic", async function () {
    const { contexto, elemento, llamadas } = preparar();
    await contexto.conectarWallet();
    elemento("nueva-id").value = "OBL-NUEVA";
    const pendiente = contexto.desplegarObligacion();
    assert.equal(elemento("obligacion-select").disabled, true);
    await contexto.desplegarObligacion();
    await pendiente;
    assert.equal(llamadas.filter((dato) => dato === "despliegue wallet").length, 1);
    await contexto.limpiarConexion();
  });

  it("envia las operaciones al contrato seleccionado y no a la direccion configurada", async function () {
    const { contexto, elemento, llamadas, fuentes } = preparar();
    await contexto.conectarWallet();
    elemento("nueva-id").value = "OBL-NUEVA";
    await contexto.desplegarObligacion();
    elemento("co-deuda").value = "1000";
    elemento("co-reserva").value = "120";
    await contexto.ejecutarAccion("crearObligacion");
    elemento("rr-ref").value = "REC-002";
    elemento("rr-valor").value = "100";
    await contexto.ejecutarAccion("registrarRecaudo");
    assert.ok(llamadas.some((dato) => dato.metodo === "registrarRecaudo" && dato.direccion === fuentes[1].direccion));
    await contexto.limpiarConexion();
  });

  it("no permite operaciones antes de inicializar ni inicializar dos veces", async function () {
    const { contexto, elemento, llamadas } = preparar({ creada: false });
    await contexto.conectarWallet();
    await contexto.ejecutarAccion("registrarRecaudo");
    assert.match(elemento("mensaje-global").textContent, /Inicializa/);
    elemento("co-deuda").value = "1000";
    elemento("co-reserva").value = "120";
    await contexto.ejecutarAccion("crearObligacion");
    await contexto.ejecutarAccion("crearObligacion");
    assert.match(elemento("mensaje-global").textContent, /ya esta inicializada/);
    assert.equal(llamadas.filter((dato) => dato === "crear wallet").length, 1);
    await contexto.limpiarConexion();
  });

  it("permite conectar y desplegar cuando la factory esta vacia", async function () {
    const { contexto, elemento } = preparar({ registros: [] });
    await contexto.conectarWallet();
    assert.equal(elemento("obligacion-select").disabled, true);
    assert.equal(elemento("btn-desplegar").disabled, false);
    assert.match(elemento("mensaje-global").textContent, /aun no tiene obligaciones/);
    elemento("nueva-id").value = "PRIMERA";
    await contexto.desplegarObligacion();
    assert.equal(elemento("co-id").value, "PRIMERA");
    await contexto.limpiarConexion();
  });

  it("muestra el despliegue faltante sin recuperar un caso anterior", async function () {
    const { contexto, elemento } = preparar({ sinContrato: true });
    await contexto.conectarWallet();
    assert.match(elemento("mensaje-global").textContent, /No hay contrato/);
    assert.equal(elemento("v-id").textContent, "-");
  });
});