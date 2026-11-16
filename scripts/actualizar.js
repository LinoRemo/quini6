// Proceso automático (GitHub Actions): lee el último sorteo y lo guarda en data/sorteos.json.
// Primero prueba la página de resultados; si no responde (no atiende fuera de
// Argentina), busca el PDF oficial de los sorteos siguientes al último guardado.
const fs = require("fs");
const path = require("path");
const { leerUltimoSorteo, leerSorteoPdf, sumarSorteo } = require("./extracto");

const ARCHIVO = path.join(__dirname, "..", "data", "sorteos.json");
const sinHora = o => JSON.stringify({ ...o, actualizado: undefined, fuente: undefined });

(async () => {
  let lista = [];
  try { lista = JSON.parse(fs.readFileSync(ARCHIVO, "utf8")); } catch {}
  const nuevos = [];

  try {
    nuevos.push(await leerUltimoSorteo());
  } catch (e) {
    console.log(`La página de resultados no respondió (${e.cause?.code || e.message}); pruebo con el PDF oficial.`);
    const ultimo = lista[0]?.nro;
    if (!ultimo) throw new Error("No hay ningún sorteo guardado para saber qué PDF buscar.");
    // hasta 4 sorteos por si el proceso estuvo parado un par de semanas
    for (let nro = ultimo + 1; nro <= ultimo + 4; nro++) {
      const s = await leerSorteoPdf(nro);
      if (!s) break;
      nuevos.push(s);
    }
  }

  let cambios = 0;
  for (const s of nuevos) {
    const previo = lista.find(x => x.nro === s.nro);
    if (previo && sinHora(previo) === sinHora(s)) continue;
    lista = sumarSorteo(lista, s);
    cambios++;
    console.log(`Guardado el sorteo ${s.nro} del ${s.fechaCorta}.`);
  }
  if (!cambios) {
    console.log(`Sin cambios: el último sorteo sigue siendo el ${lista[0]?.nro} (${lista[0]?.fechaCorta}).`);
    return;
  }
  fs.writeFileSync(ARCHIVO, JSON.stringify(lista, null, 2) + "\n");
})().catch(e => {
  const causa = e.cause ? ` (${e.cause.code || ""} ${e.cause.message || e.cause})` : "";
  // "::error::" deja el motivo visible en el resumen de GitHub Actions
  console.log(`::error::${e.message || e}${causa}`);
  process.exit(1);
});
