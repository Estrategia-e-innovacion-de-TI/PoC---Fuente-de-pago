// Servidor estatico minimo para frontend/ (sin dependencias externas).
const http = require("http");
const fs = require("fs");
const path = require("path");

const RAIZ = __dirname;
const PUERTO = 5173;

const TIPOS_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const servidor = http.createServer((req, res) => {
  let rutaSolicitada;
  try {
    rutaSolicitada = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400);
    res.end("Solicitud invalida");
    return;
  }

  if (rutaSolicitada === "/") {
    rutaSolicitada = "/index.html";
  }

  const rutaAbsoluta = path.resolve(RAIZ, `.${rutaSolicitada}`);
  const rutaRelativa = path.relative(RAIZ, rutaAbsoluta);
  if (
    rutaRelativa === ".." ||
    rutaRelativa.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rutaRelativa)
  ) {
    res.writeHead(403);
    res.end("Prohibido");
    return;
  }

  fs.readFile(rutaAbsoluta, (error, contenido) => {
    if (error) {
      res.writeHead(404);
      res.end("No encontrado");
      return;
    }
    const ext = path.extname(rutaAbsoluta);
    res.writeHead(200, { "Content-Type": TIPOS_MIME[ext] || "application/octet-stream" });
    res.end(contenido);
  });
});

servidor.listen(PUERTO, () => {
  console.log(`Frontend disponible en http://localhost:${PUERTO}`);
});
