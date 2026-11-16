// Proceso automático (GitHub Actions): lee el último sorteo y lo guarda en data/sorteos.json.
const fs = require("fs");
const path = require("path");
const { leerUltimoSorteo, sumarSorteo } = require("./extracto");

const ARCHIVO = path.join(__dirname, "..", "data", "sorteos.json");

(async () => {
  const s = await leerUltimoSorteo();
  let lista = [];
  try { lista = JSON.parse(fs.readFileSync(ARCHIVO, "utf8")); } catch {}
  const previo = lista.find(x => x.nro === s.nro);
  // no reescribir si solo cambió la hora de lectura
  const sinHora = o => JSON.stringify({ ...o, actualizado: undefined });
  if (previo && sinHora(previo) === sinHora(s)) {
    console.log(`Sin cambios: el último sorteo sigue siendo el ${s.nro} (${s.fechaCorta}).`);
    return;
  }
  fs.writeFileSync(ARCHIVO, JSON.stringify(sumarSorteo(lista, s), null, 2) + "\n");
  console.log(`Guardado el sorteo ${s.nro} del ${s.fechaCorta}.`);
})().catch(e => {
  const causa = e.cause ? ` (${e.cause.code || ""} ${e.cause.message || e.cause})` : "";
  // "::error::" deja el motivo visible en el resumen de GitHub Actions
  console.log(`::error::${e.message || e}${causa}`);
  process.exit(1);
});
