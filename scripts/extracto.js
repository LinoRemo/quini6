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
  const L = htmlATexto(html.slice(ini));
  const dia = +srt[2], mi = MESES.indexOf(mes[1].toLowerCase()) + 1, anio = +mes[2], nro = +srt[3];
  const out = {
    nro, fecha: `${anio}-${f2(mi)}-${f2(dia)}`, fechaCorta: `${f2(dia)}/${f2(mi)}/${anio}`,
    fechaTexto: `${srt[1].toLowerCase()} ${f2(dia)}/${f2(mi)}/${anio}`,
    fuente: "Lotería de Santa Fe – extracto oficial", actualizado: new Date().toISOString()
  };
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

// Agrega o reemplaza el sorteo en la lista, del más nuevo al más viejo.
function sumarSorteo(lista, s) {
  return [s, ...lista.filter(x => x.nro !== s.nro)].sort((a, b) => b.nro - a.nro).slice(0, 200);
}

module.exports = { URL_EXTRACTO, parseExtracto, leerUltimoSorteo, sumarSorteo };
