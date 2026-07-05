/* ============================================================
   Ana Lucía · Dashboard primera enfermedad
   Fuente de datos: Google Sheet (en vivo)
   ============================================================ */

/* ---- Configuración del Sheet ---- */
const SHEET_ID  = "1ZDmOxWcYoFA85VNkAaNc3tviXTdxhylDgJdWK_STtNU";
const SHEET_TAB = "Detalle";

/* Orden esperado de columnas en la pestaña "Detalle":
   Comprobante | N° Nota | Fecha | Categoría | Descripción | Cantidad | Importe (Bs.) */
const COL = { comprobante:0, nota:1, fecha:2, categoria:3, descripcion:4, cantidad:5, importe:6 };

/* Paleta por categoría (tonos crema/rosa) */
const CAT_COLORS = {
  "Laboratorio":     "#e98aa0",
  "Hospitalización": "#d38fb0",
  "Medicamentos":    "#f2b5c4",
  "Imagenología":    "#f4c99e",
  "Insumos":         "#b98cc4",
  "Sueros":          "#eaa0ae",
  "Procedimientos":  "#cbb2d6"
};
const FALLBACK_COLORS = ["#e98aa0","#f2b5c4","#d38fb0","#f4c99e","#b98cc4","#eaa0ae","#cbb2d6","#f0a9b8"];

/* ---------- utilidades ---------- */
const fmt = new Intl.NumberFormat("es-BO",{minimumFractionDigits:2,maximumFractionDigits:2});
const money = n => "Bs. " + fmt.format(n||0);

function parseBs(v){
  if(typeof v === "number") return v;
  if(v == null) return 0;
  let s = String(v).trim().replace(/[^\d.,-]/g,"");
  if(s.includes(".") && s.includes(",")) s = s.replace(/\./g,"").replace(",",".");
  else if(s.includes(",")) s = s.replace(",",".");
  return parseFloat(s) || 0;
}

function colorFor(cat, i){ return CAT_COLORS[cat] || FALLBACK_COLORS[i % FALLBACK_COLORS.length]; }

function parseFecha(f){
  // dd/mm/yyyy -> Date; devuelve {label, ts}
  const m = String(f).trim().match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if(!m) return { label:String(f), ts:0 };
  let [,d,mo,y] = m; if(y.length===2) y = "20"+y;
  return { label:`${d.padStart(2,"0")}/${mo.padStart(2,"0")}/${y}`, ts:new Date(+y,+mo-1,+d).getTime() };
}

/* ---------- carga desde Google Sheet (gviz) ---------- */
async function loadData(){
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(SHEET_TAB)}`;
  const res = await fetch(url);
  const txt = await res.text();
  const json = JSON.parse(txt.replace(/^[\s\S]*?setResponse\(/, "").replace(/\);?\s*$/, ""));
  const rows = json.table.rows || [];

  const items = [];
  for(const r of rows){
    const c = r.c || [];
    const cell = i => (c[i] ? (c[i].f != null ? c[i].f : c[i].v) : "");
    const descripcion = String(cell(COL.descripcion) || "").trim();
    const importe = parseBs(c[COL.importe] ? c[COL.importe].v : cell(COL.importe));
    if(!descripcion && !importe) continue;                       // fila vacía
    if(/^total/i.test(descripcion)) continue;                    // fila de total, por si acaso
    items.push({
      comprobante: String(cell(COL.comprobante) || "—").trim(),
      nota:        String(cell(COL.nota) || "").trim(),
      fecha:       parseFecha(cell(COL.fecha)),
      categoria:   String(cell(COL.categoria) || "Otros").trim(),
      descripcion,
      cantidad:    parseBs(c[COL.cantidad] ? c[COL.cantidad].v : cell(COL.cantidad)) || "",
      importe
    });
  }
  return items;
}

/* ---------- agregaciones ---------- */
function groupSum(items, keyFn){
  const m = new Map();
  for(const it of items){ const k = keyFn(it); m.set(k, (m.get(k)||0) + it.importe); }
  return m;
}

/* ---------- animación de números ---------- */
function animateNumber(el, target, prefix="Bs. "){
  const dur = 900, start = performance.now();
  function step(t){
    const p = Math.min(1,(t-start)/dur), e = 1-Math.pow(1-p,3);
    el.textContent = prefix + fmt.format(target*e);
    if(p<1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ---------- estado de gráficos/filtros ---------- */
let CHARTS = {};
let STATE = { items:[], catOff:new Set(), filterCat:null, search:"" };

/* ---------- render KPIs ---------- */
function renderKPIs(items){
  const total = items.reduce((s,i)=>s+i.importe,0);
  const comps = new Set(items.map(i=>i.comprobante));
  document.getElementById("kpiItems").textContent = items.length;
  document.getElementById("kpiComps").textContent = comps.size;
  animateNumber(document.getElementById("kpiTotal"), total);

  const byDay = [...groupSum(items,i=>i.fecha.label)].sort((a,b)=>b[1]-a[1]);
  const byCat = [...groupSum(items,i=>i.categoria)].sort((a,b)=>b[1]-a[1]);

  if(byDay[0]){
    document.getElementById("kpiTopDay").textContent = byDay[0][0];
    document.getElementById("kpiTopDayVal").textContent = money(byDay[0][1]);
  }
  if(byCat[0]){
    document.getElementById("kpiTopCat").textContent = byCat[0][0];
    document.getElementById("kpiTopCatVal").textContent = money(byCat[0][1]);
  }
  const avg = comps.size ? total/comps.size : 0;
  animateNumber(document.getElementById("kpiAvg"), avg);
  document.getElementById("kpiComps2").textContent = comps.size;
}

/* ---------- gráfico dona por categoría ---------- */
function renderCat(items){
  const entries = [...groupSum(items,i=>i.categoria)].sort((a,b)=>b[1]-a[1]);
  const total = entries.reduce((s,e)=>s+e[1],0);
  const labels = entries.map(e=>e[0]);
  const data = entries.map(e=>e[1]);
  const colors = labels.map((c,i)=>colorFor(c,i));

  CHARTS.cat?.destroy();
  CHARTS.cat = new Chart(document.getElementById("chartCat"),{
    type:"doughnut",
    data:{ labels, datasets:[{ data, backgroundColor:colors, borderColor:"#fff", borderWidth:3, hoverOffset:8 }] },
    options:{
      responsive:true, maintainAspectRatio:false, cutout:"62%",
      plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=>` ${c.label}: ${money(c.raw)} (${Math.round(c.raw/total*100)}%)` } } },
      onClick:(e,el)=>{ if(el[0]) toggleCatFilter(labels[el[0].index]); }
    }
  });

  const leg = document.getElementById("legendCat");
  leg.innerHTML = "";
  entries.forEach(([cat,val],i)=>{
    const li = document.createElement("li");
    li.innerHTML = `<span class="swatch" style="background:${colorFor(cat,i)}"></span>
      <span class="lg-name">${cat}</span>
      <span class="lg-val">${money(val)}</span>
      <span class="lg-pct">${Math.round(val/total*100)}%</span>`;
    li.onclick = ()=> toggleCatFilter(cat);
    if(STATE.filterCat && STATE.filterCat!==cat) li.classList.add("off");
    leg.appendChild(li);
  });
}

/* ---------- gráfico barras por comprobante ---------- */
function renderComp(items){
  const entries = [...groupSum(items,i=>i.comprobante)];
  CHARTS.comp?.destroy();
  CHARTS.comp = new Chart(document.getElementById("chartComp"),{
    type:"bar",
    data:{ labels:entries.map(e=>e[0]), datasets:[{ data:entries.map(e=>e[1]),
      backgroundColor:"#f2b5c4", hoverBackgroundColor:"#e98aa0", borderRadius:8, maxBarThickness:46 }] },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=>` ${money(c.raw)}` } } },
      scales:{
        x:{ grid:{display:false}, ticks:{ color:"#7a6d72", font:{size:10}, maxRotation:0, callback:function(v){ const l=this.getLabelForValue(v); return l.length>14?l.slice(0,13)+"…":l; } } },
        y:{ grid:{color:"#f0e3dc"}, ticks:{ color:"#7a6d72", callback:v=>fmt.format(v) } }
      }
    }
  });
}

/* ---------- gráfico línea/barras por día ---------- */
function renderDay(items){
  const entries = [...groupSum(items,i=>i.fecha.label)]
    .map(([label,val])=>({label,val,ts:parseFecha(label).ts}))
    .sort((a,b)=>a.ts-b.ts);
  CHARTS.day?.destroy();
  CHARTS.day = new Chart(document.getElementById("chartDay"),{
    type:"bar",
    data:{ labels:entries.map(e=>e.label), datasets:[{ data:entries.map(e=>e.val),
      backgroundColor:"#d38fb0", hoverBackgroundColor:"#b96f95", borderRadius:8, maxBarThickness:60 }] },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=>` ${money(c.raw)}` } } },
      scales:{
        x:{ grid:{display:false}, ticks:{ color:"#7a6d72" } },
        y:{ grid:{color:"#f0e3dc"}, ticks:{ color:"#7a6d72", callback:v=>fmt.format(v) } }
      }
    }
  });
}

/* ---------- tabla + filtros ---------- */
function renderChips(items){
  const cats = [...new Set(items.map(i=>i.categoria))];
  const cont = document.getElementById("chips");
  cont.innerHTML = "";
  const mk = (label,cat)=>{
    const b = document.createElement("button");
    b.className = "chip" + ((STATE.filterCat===cat)||(!STATE.filterCat&&cat===null)?" active":"");
    b.textContent = label;
    b.onclick = ()=>{ STATE.filterCat = cat; refresh(); };
    return b;
  };
  cont.appendChild(mk("Todas", null));
  cats.forEach(c=>cont.appendChild(mk(c,c)));
}

function toggleCatFilter(cat){ STATE.filterCat = (STATE.filterCat===cat)?null:cat; refresh(); }

function renderTable(items){
  const tbody = document.getElementById("tbody");
  const s = STATE.search.toLowerCase();
  const rows = items.filter(i=>{
    const okCat = !STATE.filterCat || i.categoria===STATE.filterCat;
    const okSearch = !s || (i.descripcion+" "+i.categoria+" "+i.comprobante).toLowerCase().includes(s);
    return okCat && okSearch;
  });
  tbody.innerHTML = "";
  let sum = 0;
  rows.forEach((i,idx)=>{
    sum += i.importe;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i.comprobante}</td>
      <td>${i.fecha.label}</td>
      <td><span class="cat-tag" style="background:${colorFor(i.categoria,idx)}">${i.categoria}</span></td>
      <td>${i.descripcion}</td>
      <td class="num">${i.cantidad||""}</td>
      <td class="num">${fmt.format(i.importe)}</td>`;
    tbody.appendChild(tr);
  });
  document.getElementById("tfootLabel").textContent = STATE.filterCat ? `Total ${STATE.filterCat}` : "Total mostrado";
  document.getElementById("tfootVal").textContent = fmt.format(sum);
}

/* ---------- refresh (aplica filtros a tabla) ---------- */
function refresh(){
  renderChips(STATE.items);
  renderTable(STATE.items);
  // resaltar categoría activa en la leyenda de la dona
  const leg = document.getElementById("legendCat");
  [...leg.children].forEach(li=>{
    const name = li.querySelector(".lg-name")?.textContent;
    li.classList.toggle("off", !!STATE.filterCat && STATE.filterCat!==name);
  });
}

/* ---------- estado de la fuente (pie) ---------- */
function setStatus(kind, text){
  const el = document.getElementById("status");
  el.className = "status " + kind;
  document.getElementById("statusText").textContent = text;
}

/* ---------- scroll reveal ---------- */
function initReveal(){
  const io = new IntersectionObserver((es)=>{
    es.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add("in"); io.unobserve(e.target); } });
  },{threshold:.12});
  document.querySelectorAll(".reveal").forEach(el=>io.observe(el));
}

/* ---------- lightbox (galería + radiografía) ---------- */
function initLightbox(){
  const lb = document.getElementById("lightbox");
  const lbImg = lb.querySelector("img");
  document.querySelectorAll(".zoom img, #xrayFrame img").forEach(img=>{
    img.style.cursor = "zoom-in";
    img.addEventListener("click", e=>{ e.stopPropagation(); lbImg.src = img.src; lb.classList.add("open"); });
  });
  lb.addEventListener("click", ()=> lb.classList.remove("open"));
  document.addEventListener("keydown", e=>{ if(e.key==="Escape") lb.classList.remove("open"); });
}

/* ---------- init ---------- */
async function init(){
  initReveal();
  initLightbox();
  document.getElementById("filter").addEventListener("input", e=>{ STATE.search = e.target.value; renderTable(STATE.items); });

  try{
    setStatus("", "Cargando datos…");
    const items = await loadData();
    if(!items.length) throw new Error("Sheet vacío");
    STATE.items = items;

    renderKPIs(items);
    renderCat(items);
    renderComp(items);
    renderDay(items);
    refresh();
    setStatus("live", "Fuente: Google Sheet · en vivo");
  }catch(err){
    console.error(err);
    setStatus("err", "No se pudo leer el Google Sheet. Verifica que esté compartido como «Cualquiera con el vínculo».");
  }
}
document.addEventListener("DOMContentLoaded", init);
