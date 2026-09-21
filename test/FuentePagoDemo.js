const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FuentePagoDemo", function () {
  async function deployFixture() {
    const [admin, otro] = await ethers.getSigners();
    const FuentePagoDemo = await ethers.getContractFactory("FuentePagoDemo");
    const contrato = await FuentePagoDemo.deploy(admin.address);
    await contrato.waitForDeployment();
    return { contrato, admin, otro };
  }

  it("crea la obligacion solo una vez y solo el administrador", async function () {
    const { contrato, otro } = await deployFixture();

    await expect(
      contrato.connect(otro).crearObligacion("OBL-1", 1000, 120)
    ).to.be.revertedWithCustomError(contrato, "NoAutorizado");

    await contrato.crearObligacion("OBL-1", 1000, 120);
    expect(await contrato.obligacionCreada()).to.equal(true);

    await expect(
      contrato.crearObligacion("OBL-1", 1000, 120)
    ).to.be.revertedWithCustomError(contrato, "ObligacionYaExiste");
  });

  it("autoriza pago total cuando la reserva se cumple", async function () {
    const { contrato } = await deployFixture();

    await contrato.crearObligacion("OBL-1", 1000, 120);
    await contrato.actualizarSaldoYCuota(1000, 100);
    await contrato.registrarRecaudo("REC-1", 200); // reserva requerida = 100*120/100 = 120

    const resultado = await contrato.evaluarYAutorizarPago.staticCall();
    expect(resultado[0]).to.equal(0); // PagoAutorizado
    expect(resultado[1]).to.equal(100n);

    await contrato.evaluarYAutorizarPago();
    expect(await contrato.pagoAutorizado()).to.equal(100n);
  });

  it("autoriza pago parcial cuando la reserva no se cumple pero hay recursos", async function () {
    const { contrato } = await deployFixture();

    await contrato.crearObligacion("OBL-1", 1000, 120);
    await contrato.actualizarSaldoYCuota(1000, 100);
    await contrato.registrarRecaudo("REC-1", 50); // reserva requerida = 120, no se cumple

    const resultado = await contrato.evaluarYAutorizarPago.staticCall();
    expect(resultado[0]).to.equal(1); // PagoParcialAutorizado
    expect(resultado[1]).to.equal(50n);
  });

  it("no autoriza pago si no hay recursos", async function () {
    const { contrato } = await deployFixture();

    await contrato.crearObligacion("OBL-1", 1000, 120);
    await contrato.actualizarSaldoYCuota(1000, 100);

    const resultado = await contrato.evaluarYAutorizarPago.staticCall();
    expect(resultado[0]).to.equal(2); // PagoNoAutorizado
    expect(resultado[1]).to.equal(0n);
  });

  it("requiere revision manual cuando la obligacion esta bloqueada", async function () {
    const { contrato } = await deployFixture();

    await contrato.crearObligacion("OBL-1", 1000, 120);
    await contrato.actualizarSaldoYCuota(1000, 100);
    await contrato.registrarRecaudo("REC-1", 200);
    await contrato.actualizarBloqueo(true, "Revision de cumplimiento");

    const resultado = await contrato.evaluarYAutorizarPago.staticCall();
    expect(resultado[0]).to.equal(3); // RevisionManualRequerida
    expect(resultado[1]).to.equal(0n);
  });

  it("confirma el pago ejecutado y actualiza saldos", async function () {
    const { contrato } = await deployFixture();

    await contrato.crearObligacion("OBL-1", 1000, 120);
    await contrato.actualizarSaldoYCuota(1000, 100);
    await contrato.registrarRecaudo("REC-1", 200);
    await contrato.evaluarYAutorizarPago();

    await contrato.confirmarPagoEjecutado("PAGO-1");

    expect(await contrato.deudaPendiente()).to.equal(900n);
    expect(await contrato.pagoAutorizado()).to.equal(0n);
    expect(await contrato.totalPagado()).to.equal(100n);

    await expect(
      contrato.confirmarPagoEjecutado("PAGO-1")
    ).to.be.revertedWithCustomError(contrato, "SinAutorizacionVigente");
  });

  it("detecta y gira excedentes", async function () {
    const { contrato } = await deployFixture();

    await contrato.crearObligacion("OBL-1", 1000, 120);
    await contrato.actualizarSaldoYCuota(1000, 100);
    // reserva requerida = 120, recursos = 500 -> excedente tras autorizar 100 de pago = 500 - (120+100) = 280
    await contrato.registrarRecaudo("REC-1", 500);
    await contrato.evaluarYAutorizarPago();

    expect(await contrato.excedentePendienteGiro()).to.equal(280n);

    await contrato.confirmarGiroExcedente("GIRO-1");
    expect(await contrato.excedentePendienteGiro()).to.equal(0n);
    expect(await contrato.totalExcedentesGirados()).to.equal(280n);
  });

  it("registra evidencia sin duplicados", async function () {
    const { contrato } = await deployFixture();
    await contrato.crearObligacion("OBL-1", 1000, 120);

    const hash = ethers.keccak256(ethers.toUtf8Bytes("contrato-pdf"));
    await contrato.registrarEvidencia(hash, "contrato");

    await expect(
      contrato.registrarEvidencia(hash, "contrato")
    ).to.be.revertedWithCustomError(contrato, "EvidenciaDuplicada");
  });

  it("cierra la obligacion cuando se cumplen todas las condiciones", async function () {
    const { contrato } = await deployFixture();

    await contrato.crearObligacion("OBL-1", 100, 100);
    await contrato.actualizarSaldoYCuota(100, 100);
    await contrato.registrarRecaudo("REC-1", 100);
    await contrato.evaluarYAutorizarPago();
    await contrato.confirmarPagoEjecutado("PAGO-1");

    await contrato.registrarPazYSalvo();
    await contrato.cerrarObligacion();

    expect(await contrato.obligacionCerrada()).to.equal(true);
  });

  it("no sobrescribe un excedente pendiente si se evalua de nuevo antes de girarlo", async function () {
    const { contrato } = await deployFixture();

    await contrato.crearObligacion("OBL-1", 1000, 120);
    await contrato.actualizarSaldoYCuota(1000, 100);
    await contrato.registrarRecaudo("REC-1", 500); // excedente = 500 - (120+100) = 280
    await contrato.evaluarYAutorizarPago();
    expect(await contrato.excedentePendienteGiro()).to.equal(280n);

    await contrato.confirmarPagoEjecutado("PAGO-1");
    await contrato.registrarRecaudo("REC-2", 1000); // mas recursos, pero el excedente ya detectado no debe cambiar
    await contrato.actualizarSaldoYCuota(900, 100);
    await contrato.evaluarYAutorizarPago();

    expect(await contrato.excedentePendienteGiro()).to.equal(280n);
  });

  it("permite completar el ciclo de vida de principio a fin, incluyendo el remanente de reserva", async function () {
    const { contrato } = await deployFixture();

    await contrato.crearObligacion("OBL-E2E", 100, 100);
    await contrato.actualizarSaldoYCuota(100, 100);
    await contrato.registrarRecaudo("REC-1", 500);

    // reservaRequerida = 100, pago autorizado = 100 -> excedente = 500 - 200 = 300
    await contrato.evaluarYAutorizarPago();
    expect(await contrato.excedentePendienteGiro()).to.equal(300n);

    await contrato.confirmarPagoEjecutado("PAGO-1");
    expect(await contrato.deudaPendiente()).to.equal(0n);
    // recursosDisponibles = 500 - 100 = 400 (100 de reserva + 300 de excedente)
    expect(await contrato.recursosDisponibles()).to.equal(400n);

    await contrato.confirmarGiroExcedente("GIRO-1");
    // queda atrapado el remanente de reserva (100) porque la cuota sigue en 100
    expect(await contrato.recursosDisponibles()).to.equal(100n);

    // el backend informa que ya no hay cuota pendiente (deuda cubierta)
    await contrato.actualizarSaldoYCuota(0, 0);
    await contrato.evaluarYAutorizarPago(); // libera el remanente como excedente
    expect(await contrato.excedentePendienteGiro()).to.equal(100n);

    await contrato.confirmarGiroExcedente("GIRO-2");
    expect(await contrato.recursosDisponibles()).to.equal(0n);

    await contrato.registrarPazYSalvo();
    await contrato.cerrarObligacion();

    expect(await contrato.obligacionCerrada()).to.equal(true);
  });
});

describe("FuentePagoFactory", function () {
  it("despliega obligaciones y evita identificadores duplicados", async function () {
    const [owner, backend] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("FuentePagoFactory");
    const factory = await Factory.deploy();

    await factory.crearFuentePago("OBL-1", backend.address);
    expect(await factory.totalObligaciones()).to.equal(1n);

    await expect(
      factory.crearFuentePago("OBL-1", backend.address)
    ).to.be.revertedWithCustomError(factory, "IdentificadorDuplicado");
  });
});
