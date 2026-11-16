// Lectura del extracto oficial del Quini 6 (Lotería de Santa Fe).
// Lo usan el programa de la PC (server.js) y el proceso automático de GitHub (actualizar.js).
const URL_EXTRACTO = "https://apps.loteriasantafe.gov.ar:8443/Extractos/paginas/mostrarQuini6.xhtml?display=0";
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const f2 = n => String(n).padStart(2, "0");

const decode = s => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const toNum = s => { const t = String(s || "").replace(/[^\d,.]/g, ""); return t ? parseFloat(t.replace(/\./g, "").replace(",", ".")) : null; };

function opcionElegida(html, selectId) {
  const i = html.indexOf(`id="${selectId}"`);
  if (i < 0) return null;
  const sel = html.slice(i, html.indexOf("</select>", i));
  // sin opción marcada, la página muestra la primera (el sorteo más reciente)
  const m = sel.match(/<option[^>]*selected="selected"[^>]*>([^<]*)<\/option>/) || sel.match(/<option[^>]*>([^<]*)<\/option>/);
  return m ? decode(m[1]).trim() : null;
}

function htmlATexto(html) {
  return decode(html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<\/(tr|div|h\d|p|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, ""))
    .split("\n")
    .map(l => l.split("\t").map(c => c.replace(/\s+/g, " ").trim()).filter(Boolean).join("\t"))
    .filter(Boolean);
}

function parseExtracto(html) {
  const mes = (opcionElegida(html, "form:mesSeleccionado_input") || "").match(/^([A-Za-z]+)\s+(\d{4})$/);
  const srt = (opcionElegida(html, "form:sorteoSeleccionado_input") || "").match(/^([A-Za-zÁÉÍÓÚáéíóú]+)\s+(\d{1,2})\s*-\s*(\d+)$/);
  if (!mes || !srt || !MESES.includes(mes[1].toLowerCase())) return null;
  const ini = html.indexOf('id="extractos"');
  if (ini < 0) return null;
  const dia = +srt[2], mi = MESES.indexOf(mes[1].toLowerCase()) + 1, anio = +mes[2], nro = +srt[3];
  return parseSecciones(htmlATexto(html.slice(ini)), {
    nro, fecha: `${anio}-${f2(mi)}-${f2(dia)}`, fechaCorta: `${f2(dia)}/${f2(mi)}/${anio}`,
    fechaTexto: `${srt[1].toLowerCase()} ${f2(dia)}/${f2(mi)}/${anio}`,
    fuente: "Lotería de Santa Fe – extracto oficial", actualizado: new Date().toISOString()
  });
}

// Recibe el extracto como renglones con las celdas separadas por tabulador
// (igual en la página web y en el PDF) y completa las 5 modalidades.
function parseSecciones(L, out) {
  const heads = [["tradicional", /^TRADICIONAL PRIMER SORTEO$/i], ["segunda", /^TRADICIONAL LA SEGUNDA/i], ["revancha", /^REVANCHA$/i],
    ["siempreSale", /^SIEMPRE SALE$/i], ["pozoExtra", /^(PREMIO|POZO) EXTRA$/i]];
  const idx = heads.map(([k, re]) => [k, L.findIndex(l => re.test(l))]);
  if (idx.some(([, i]) => i < 0)) return null;
  const orden = idx.slice().sort((a, b) => a[1] - b[1]);
  for (const [k, i] of idx) {
    const sig = orden.find(([, j]) => j > i);
    const blk = L.slice(i + 1, sig ? sig[1] : L.length);
    const nums = [];
    for (const l of blk) { if (/^\d{1,2}$/.test(l)) nums.push(+l); else if (nums.length) break; }
    const filas = blk.map(l => l.split("\t")).filter(c => /^\d° Premio$/i.test(c[0]));
    if (k === "pozoExtra") {
      const hi = blk.findIndex(l => /^POZO \$/i.test(l));
      const c = hi >= 0 && blk[hi + 1] ? blk[hi + 1].split("\t") : [];
      out[k] = { nums: [...new Set(nums)].sort((a, b) => a - b), ganadores: toNum(c[1]), premio: toNum(c[2]) };
      if (out[k].nums.length < 6) return null;
    } else if (k === "siempreSale") {
      const c = filas[0] || [];
      out[k] = { nums, aciertos: toNum(c[2]), ganadores: toNum(c[3]), premio: toNum(c[4]) };
    } else {
      const map = { "1": 6, "2": 5, "3": 4 }, premios = {};
      for (const c of filas) {
        const a = map[c[0][0]]; if (!a) continue;
        const vac = /VACANTE/i.test(c[2] || "");
        premios[a] = { ganadores: vac ? "VACANTE" : toNum(c[2]), premio: vac ? null : toNum(c[3]) };
      }
      out[k] = { nums, premios };
    }
    if (k !== "pozoExtra" && out[k].nums.length !== 6) return null;
  }
  return out;
}

async function leerUltimoSorteo() {
  const r = await fetch(URL_EXTRACTO, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`La Lotería respondió ${r.status}`);
  const s = parseExtracto(await r.text());
  if (!s) throw new Error("No pude leer el extracto: la página de la Lotería cambió o vino incompleta.");
  return s;
}

// ---- extracto oficial en PDF ----
// La página de resultados (puerto 8443) no responde fuera de Argentina, así
// que el proceso automático de GitHub usa el PDF que la Lotería publica en
// su sitio principal. Necesita pdfjs-dist (solo se instala en GitHub).
const URL_PDF = nro => `https://loteriasantafe.gov.ar/uploads/extractosdigitales/Extracto_Sorteo_Q6_${nro}.pdf`;
const DIAS = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];

// Agrupa las palabras del PDF en renglones (misma altura), de arriba hacia
// abajo y de izquierda a derecha, con las celdas separadas por tabulador.
async function pdfARenglones(data) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: new Uint8Array(data), verbosity: 0 }).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  const filas = new Map();
  for (const it of tc.items) {
    const s = it.str.replace(/\s+/g, " ").trim();
    if (!s) continue;
    const y = Math.round(it.transform[5]);
    if (!filas.has(y)) filas.set(y, []);
    filas.get(y).push({ x: it.transform[4], s });
  }
  return [...filas.entries()].sort((a, b) => b[0] - a[0])
    .map(([, cs]) => cs.sort((a, b) => a.x - b.x).map(c => c.s))
    // la fila de bolillas viene en un solo renglón: una por renglón, como en la web
    .flatMap(cs => cs.every(c => /^\d{2}$/.test(c)) ? cs : [cs.join("\t")]);
}

function parseExtractoPdf(L) {
  const nro = L.map(l => l.match(/CONCURSO\s+N\S*\s*(\d+)/i)).find(Boolean);
  const fecha = L.map(l => l.match(/SORTEO REALIZADO EL (\d{2})\/(\d{2})\/(\d{4})/i)).find(Boolean);
  if (!nro || !fecha) return null;
  const [, d, m, a] = fecha;
  const dia = DIAS[new Date(Date.UTC(+a, +m - 1, +d)).getUTCDay()];
  return parseSecciones(L, {
    nro: +nro[1], fecha: `${a}-${m}-${d}`, fechaCorta: `${d}/${m}/${a}`, fechaTexto: `${dia} ${d}/${m}/${a}`,
    fuente: "Lotería de Santa Fe – extracto oficial (PDF)", actualizado: new Date().toISOString()
  });
}

// Devuelve el sorteo nro si su PDF ya está publicado, o null si todavía no.
async function leerSorteoPdf(nro) {
  const r = await fetch(URL_PDF(nro), { signal: AbortSignal.timeout(30000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`El PDF del sorteo ${nro} respondió ${r.status}`);
  const s = parseExtractoPdf(await pdfARenglones(await r.arrayBuffer()));
  if (!s || s.nro !== nro) throw new Error(`No pude leer el PDF del sorteo ${nro}: el formato cambió.`);
  return s;
}

// Agrega o reemplaza el sorteo en la lista, del más nuevo al más viejo.
function sumarSorteo(lista, s) {
  return [s, ...lista.filter(x => x.nro !== s.nro)].sort((a, b) => b.nro - a.nro).slice(0, 200);
}

module.exports = { URL_EXTRACTO, parseExtracto, leerUltimoSorteo, leerSorteoPdf, sumarSorteo };
