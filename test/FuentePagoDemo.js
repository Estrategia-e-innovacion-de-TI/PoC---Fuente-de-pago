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

  it("paga dos cuotas de 100 con 240 y libera los 40 restantes al terminar", async function () {
    const { contrato } = await deployFixture();
    await contrato.crearObligacion("OBL-200", 200, 120);
    await contrato.actualizarSaldoYCuota(200, 100);
    await contrato.registrarRecaudo("REC-240", 240);
    expect(await contrato.calcularReservaRequerida()).to.equal(20n);
    await contrato.evaluarYAutorizarPago();
    expect(await contrato.pagoAutorizado()).to.equal(100n);
    await contrato.confirmarPagoEjecutado("PAGO-1");
    expect(await contrato.recursosDisponibles()).to.equal(140n);
    expect(await contrato.deudaPendiente()).to.equal(100n);
    expect(await contrato.calcularReservaRequerida()).to.equal(20n);
    await contrato.evaluarYAutorizarPago();
    expect(await contrato.pagoAutorizado()).to.equal(100n);
    await contrato.confirmarPagoEjecutado("PAGO-2");
    expect(await contrato.totalPagado()).to.equal(200n);
    expect(await contrato.deudaPendiente()).to.equal(0n);
    expect(await contrato.proximaCuota()).to.equal(0n);
    expect(await contrato.recursosDisponibles()).to.equal(40n);
    expect(await contrato.calcularReservaRequerida()).to.equal(0n);
    await contrato.evaluarYAutorizarPago();
    expect(await contrato.excedentePendienteGiro()).to.equal(40n);
    await contrato.confirmarGiroExcedente("GIRO-FINAL");
    await contrato.registrarPazYSalvo();
    await contrato.cerrarObligacion();
    expect(await contrato.obligacionCerrada()).to.equal(true);
  });

  it("autoriza el pago total solo si conserva la reserva despues del pago", async function () {
    const { contrato } = await deployFixture();

    await contrato.crearObligacion("OBL-1", 1000, 120);
    await contrato.actualizarSaldoYCuota(1000, 100);
    await contrato.registrarRecaudo("REC-1", 120);

    const resultado = await contrato.evaluarYAutorizarPago.staticCall();
    expect(resultado[0]).to.equal(0); // PagoAutorizado
    expect(resultado[1]).to.equal(100n);

    await contrato.evaluarYAutorizarPago();
    expect(await contrato.pagoAutorizado()).to.equal(100n);
    expect(await contrato.calcularExcedente()).to.equal(0n);
    await contrato.confirmarPagoEjecutado("PAGO-1");
    expect(await contrato.recursosDisponibles()).to.equal(20n);
  });

  it("una cobertura del 100 por ciento paga la cuota sin reserva adicional", async function () {
    const { contrato } = await deployFixture();
    await contrato.crearObligacion("OBL-100", 200, 100);
    await contrato.actualizarSaldoYCuota(200, 100);
    await contrato.registrarRecaudo("REC-1", 100);
    expect(await contrato.calcularReservaRequerida()).to.equal(0n);
    await contrato.evaluarYAutorizarPago();
    expect(await contrato.pagoAutorizado()).to.equal(100n);
    await contrato.confirmarPagoEjecutado("PAGO-1");
    expect(await contrato.recursosDisponibles()).to.equal(0n);
    expect(await contrato.deudaPendiente()).to.equal(100n);
  });

  it("rechaza coberturas menores al 100 por ciento", async function () {
    const { contrato } = await deployFixture();
    await expect(contrato.crearObligacion("OBL-INVALIDA", 200, 99))
      .to.be.revertedWithCustomError(contrato, "ReservaInvalida");
  });

  it("autoriza pago parcial solo con recursos por encima de la reserva", async function () {
    const { contrato } = await deployFixture();

    await contrato.crearObligacion("OBL-1", 1000, 120);
    await contrato.actualizarSaldoYCuota(1000, 100);
    await contrato.registrarRecaudo("REC-1", 50);

    const resultado = await contrato.evaluarYAutorizarPago.staticCall();
    expect(resultado[0]).to.equal(1); // PagoParcialAutorizado
    expect(resultado[1]).to.equal(30n);
    await contrato.evaluarYAutorizarPago();
    expect(await contrato.calcularExcedente()).to.equal(0n);
  });

  it("no autoriza pago cuando los recursos solo cubren la reserva", async function () {
    const { contrato } = await deployFixture();

    await contrato.crearObligacion("OBL-1", 1000, 120);
    await contrato.actualizarSaldoYCuota(1000, 100);
    await contrato.registrarRecaudo("REC-1", 20);

    const resultado = await contrato.evaluarYAutorizarPago.staticCall();
    expect(resultado[0]).to.equal(2);
    expect(resultado[1]).to.equal(0n);
    await contrato.evaluarYAutorizarPago();
    expect(await contrato.recursosDisponibles()).to.equal(20n);
    expect(await contrato.pagoAutorizado()).to.equal(0n);
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
    await contrato.registrarRecaudo("REC-1", 220);
    await contrato.evaluarYAutorizarPago();

    await contrato.confirmarPagoEjecutado("PAGO-1");

    expect(await contrato.deudaPendiente()).to.equal(900n);
    expect(await contrato.pagoAutorizado()).to.equal(0n);
    expect(await contrato.totalPagado()).to.equal(100n);

    await expect(
      contrato.confirmarPagoEjecutado("PAGO-1")
    ).to.be.revertedWithCustomError(contrato, "SinAutorizacionVigente");
  });

  it("deja lista la siguiente cuota fija sin sincronizacion manual", async function () {
    const { contrato } = await deployFixture();

    await contrato.crearObligacion("OBL-1", 1000, 100);
    await contrato.actualizarSaldoYCuota(1000, 100);
    await contrato.registrarRecaudo("REC-1", 300);
    await contrato.evaluarYAutorizarPago();
    await contrato.confirmarPagoEjecutado("PAGO-1");

    expect(await contrato.deudaPendiente()).to.equal(900n);
    expect(await contrato.proximaCuota()).to.equal(100n);
    expect(await contrato.cuotaFija()).to.equal(100n);
    expect(await contrato.requiereActualizarSaldoYCuota()).to.equal(false);
    await expect(contrato.evaluarYAutorizarPago()).not.to.be.reverted;
    expect(await contrato.pagoAutorizado()).to.equal(100n);
    await contrato.confirmarPagoEjecutado("PAGO-2");
    expect(await contrato.deudaPendiente()).to.equal(800n);
    expect(await contrato.totalPagado()).to.equal(200n);
  });

  it("detecta y gira excedentes", async function () {
    const { contrato } = await deployFixture();

    await contrato.crearObligacion("OBL-1", 1000, 120);
    await contrato.actualizarSaldoYCuota(1000, 100);
    await contrato.registrarRecaudo("REC-1", 500);
    await contrato.evaluarYAutorizarPago();

    expect(await contrato.excedentePendienteGiro()).to.equal(380n);

    await contrato.confirmarGiroExcedente("GIRO-1");
    expect(await contrato.excedentePendienteGiro()).to.equal(0n);
    expect(await contrato.totalExcedentesGirados()).to.equal(380n);
  });

  it("completa los pagos parciales sin consumir la reserva ni reiniciar la cuota", async function () {
    const { contrato } = await deployFixture();
    await contrato.crearObligacion("OBL-PARCIAL", 1000, 120);
    await contrato.actualizarSaldoYCuota(1000, 100);
    await contrato.registrarRecaudo("REC-1", 50);
    await contrato.evaluarYAutorizarPago();
    await contrato.confirmarPagoEjecutado("PAGO-1");
    expect(await contrato.proximaCuota()).to.equal(70n);
    expect(await contrato.cuotaFija()).to.equal(100n);
    expect(await contrato.calcularReservaRequerida()).to.equal(20n);
    expect(await contrato.deudaPendiente()).to.equal(970n);
    const sinRecaudo = await contrato.evaluarYAutorizarPago.staticCall();
    expect(sinRecaudo[1]).to.equal(0n);
    await contrato.registrarRecaudo("REC-2", 70);
    await contrato.evaluarYAutorizarPago();
    expect(await contrato.pagoAutorizado()).to.equal(70n);
    await expect(contrato.confirmarPagoEjecutado("PAGO-2"))
      .to.emit(contrato, "SaldoYCuotaActualizados").withArgs(900n, 100n);
    expect(await contrato.proximaCuota()).to.equal(100n);
    expect(await contrato.recursosDisponibles()).to.equal(20n);
    expect(await contrato.totalPagado()).to.equal(100n);
  });

  it("ajusta la ultima cuota al saldo y elimina la cuota al terminar la deuda", async function () {
    const { contrato } = await deployFixture();
    await contrato.crearObligacion("OBL-ULTIMA", 160, 120);
    await contrato.actualizarSaldoYCuota(160, 100);
    await contrato.registrarRecaudo("REC-1", 300);
    await contrato.evaluarYAutorizarPago();
    await contrato.confirmarPagoEjecutado("PAGO-1");
    expect(await contrato.proximaCuota()).to.equal(60n);
    expect(await contrato.calcularReservaRequerida()).to.equal(12n);
    await contrato.evaluarYAutorizarPago();
    expect(await contrato.pagoAutorizado()).to.equal(60n);
    await contrato.confirmarPagoEjecutado("PAGO-2");
    expect(await contrato.deudaPendiente()).to.equal(0n);
    expect(await contrato.proximaCuota()).to.equal(0n);
    expect(await contrato.calcularReservaRequerida()).to.equal(0n);
    expect(await contrato.totalPagado()).to.equal(160n);
    const resultado = await contrato.evaluarYAutorizarPago.staticCall();
    expect(resultado[1]).to.equal(0n);
  });

  it("permite cambiar o pausar la cuota fija mediante una actualizacion externa", async function () {
    const { contrato } = await deployFixture();
    await contrato.crearObligacion("OBL-CAMBIO", 1000, 100);
    await contrato.actualizarSaldoYCuota(1000, 100);
    await contrato.registrarRecaudo("REC-1", 600);
    await contrato.evaluarYAutorizarPago();
    await contrato.confirmarPagoEjecutado("PAGO-1");
    await contrato.actualizarSaldoYCuota(900, 200);
    await contrato.evaluarYAutorizarPago();
    await contrato.confirmarPagoEjecutado("PAGO-2");
    expect(await contrato.cuotaFija()).to.equal(200n);
    expect(await contrato.proximaCuota()).to.equal(200n);
    await contrato.actualizarSaldoYCuota(700, 0);
    expect(await contrato.cuotaFija()).to.equal(0n);
    const resultado = await contrato.evaluarYAutorizarPago.staticCall();
    expect(resultado[1]).to.equal(0n);
  });

  it("cancelar o repetir una referencia no avanza la cuota ni descuenta dos veces", async function () {
    const { contrato } = await deployFixture();
    await contrato.crearObligacion("OBL-CANCELA", 1000, 100);
    await contrato.actualizarSaldoYCuota(1000, 100);
    await contrato.registrarRecaudo("REC-1", 400);
    await contrato.evaluarYAutorizarPago();
    await contrato.cancelarAutorizacion();
    expect(await contrato.proximaCuota()).to.equal(100n);
    expect(await contrato.deudaPendiente()).to.equal(1000n);
    await contrato.evaluarYAutorizarPago();
    await contrato.confirmarPagoEjecutado("PAGO-1");
    await contrato.evaluarYAutorizarPago();
    await expect(contrato.confirmarPagoEjecutado("PAGO-1"))
      .to.be.revertedWithCustomError(contrato, "PagoDuplicado");
    expect(await contrato.deudaPendiente()).to.equal(900n);
    expect(await contrato.totalPagado()).to.equal(100n);
    expect(await contrato.pagoAutorizado()).to.equal(100n);
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
    await contrato.registrarRecaudo("REC-1", 200);
    await contrato.evaluarYAutorizarPago();
    await contrato.confirmarPagoEjecutado("PAGO-1");

    await contrato.evaluarYAutorizarPago();
    expect(await contrato.excedentePendienteGiro()).to.equal(100n);
    await contrato.confirmarGiroExcedente("GIRO-1");

    await contrato.registrarPazYSalvo();
    await contrato.cerrarObligacion();

    expect(await contrato.obligacionCerrada()).to.equal(true);
  });

  it("invalida el paz y salvo si el saldo vuelve a ser positivo y no cierra bloqueada", async function () {
    const { contrato } = await deployFixture();

    await contrato.crearObligacion("OBL-1", 100, 100);
    await contrato.actualizarSaldoYCuota(0, 0);
    await contrato.registrarPazYSalvo();
    await contrato.actualizarSaldoYCuota(50, 50);

    expect(await contrato.pazYSalvoRegistrado()).to.equal(false);

    await contrato.actualizarSaldoYCuota(0, 0);
    await contrato.registrarPazYSalvo();
    await contrato.actualizarBloqueo(true, "Revision pendiente");

    await expect(
      contrato.cerrarObligacion()
    ).to.be.revertedWithCustomError(contrato, "ObligacionBloqueadaError");
  });

  it("no sobrescribe un excedente pendiente si se evalua de nuevo antes de girarlo", async function () {
    const { contrato } = await deployFixture();

    await contrato.crearObligacion("OBL-1", 1000, 120);
    await contrato.actualizarSaldoYCuota(1000, 100);
    await contrato.registrarRecaudo("REC-1", 500);
    await contrato.evaluarYAutorizarPago();
    expect(await contrato.excedentePendienteGiro()).to.equal(380n);

    await contrato.confirmarPagoEjecutado("PAGO-1");
    await contrato.registrarRecaudo("REC-2", 1000); // mas recursos, pero el excedente ya detectado no debe cambiar
    await contrato.actualizarSaldoYCuota(900, 100);
    await contrato.evaluarYAutorizarPago();

    expect(await contrato.excedentePendienteGiro()).to.equal(380n);
  });

  it("reduce el excedente pendiente si una nueva cuota requiere mas reserva", async function () {
    const { contrato } = await deployFixture();

    await contrato.crearObligacion("OBL-1", 1000, 120);
    await contrato.actualizarSaldoYCuota(1000, 100);
    await contrato.registrarRecaudo("REC-1", 500);
    await contrato.evaluarYAutorizarPago();
    expect(await contrato.excedentePendienteGiro()).to.equal(380n);

    await contrato.confirmarPagoEjecutado("PAGO-1");
    await contrato.actualizarSaldoYCuota(900, 300);

    expect(await contrato.calcularExcedente()).to.equal(340n);
    expect(await contrato.excedentePendienteGiro()).to.equal(340n);

    await expect(contrato.confirmarGiroExcedente("GIRO-1"))
      .to.emit(contrato, "ExcedenteGirado")
      .withArgs(ethers.keccak256(ethers.toUtf8Bytes("GIRO-1")), 340n);
    expect(await contrato.recursosDisponibles()).to.equal(60n);
  });

  it("no libera recursos como excedente si hay deuda pero aun no hay cuota vigente", async function () {
    const { contrato } = await deployFixture();

    await contrato.crearObligacion("OBL-1", 1000, 100);
    await contrato.actualizarSaldoYCuota(1000, 100);
    await contrato.registrarRecaudo("REC-1", 500);
    await contrato.evaluarYAutorizarPago();
    expect(await contrato.excedentePendienteGiro()).to.equal(400n);
    await contrato.confirmarPagoEjecutado("PAGO-1");

    await contrato.actualizarSaldoYCuota(900, 0);
    expect(await contrato.excedentePendienteGiro()).to.equal(0n);
    expect(await contrato.calcularExcedente()).to.equal(0n);

    const resultado = await contrato.evaluarYAutorizarPago.staticCall();
    expect(resultado[0]).to.equal(2);
    expect(resultado[1]).to.equal(0n);

    await contrato.evaluarYAutorizarPago();
    expect(await contrato.excedentePendienteGiro()).to.equal(0n);
    expect(await contrato.recursosDisponibles()).to.equal(400n);

    await contrato.actualizarSaldoYCuota(900, 100);
    await contrato.evaluarYAutorizarPago();
    expect(await contrato.pagoAutorizado()).to.equal(100n);
  });

  it("permite completar el ciclo de vida de principio a fin, incluyendo el remanente de reserva", async function () {
    const { contrato } = await deployFixture();

    await contrato.crearObligacion("OBL-E2E", 100, 120);
    await contrato.actualizarSaldoYCuota(100, 100);
    await contrato.registrarRecaudo("REC-1", 500);

    await contrato.evaluarYAutorizarPago();
    expect(await contrato.excedentePendienteGiro()).to.equal(380n);

    await contrato.confirmarPagoEjecutado("PAGO-1");
    expect(await contrato.deudaPendiente()).to.equal(0n);
    expect(await contrato.recursosDisponibles()).to.equal(400n);

    await contrato.confirmarGiroExcedente("GIRO-1");
    expect(await contrato.recursosDisponibles()).to.equal(20n);

    expect(await contrato.proximaCuota()).to.equal(0n);
    await contrato.evaluarYAutorizarPago(); // libera el remanente como excedente
    expect(await contrato.excedentePendienteGiro()).to.equal(20n);

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
