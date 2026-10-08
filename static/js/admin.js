// admin.js - Lógica del panel del negocio

const ETIQUETAS = {
  pendiente: "Pendiente",
  en_preparacion: "En preparación",
  listo: "Listo",
  entregado: "Entregado",
  cancelado: "Cancelado",
};
// estado actual -> [siguiente estado, texto del botón]
const SIGUIENTE = {
  pendiente: ["en_preparacion", "Empezar a preparar"],
  en_preparacion: ["listo", "Marcar como listo"],
  listo: ["entregado", "Marcar como entregado"],
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const pesos = (n) => "$" + Number(n).toLocaleString("es-AR");

function esc(texto) {
  const d = document.createElement("div");
  d.textContent = texto;
  return d.innerHTML;
}

function hoyLocal() {
  const d = new Date();
  const dos = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

let pedidos = [];
let productos = [];
let conocidos = new Set();
let primeraCarga = true;
let editandoId = null;
let audioCtx = null;
const tituloOriginal = document.title;

// ---------------------------------------------------------------------------
// Navegación por pestañas
// ---------------------------------------------------------------------------
$$(".tab").forEach((btn) =>
  btn.addEventListener("click", () => {
    $$(".tab").forEach((b) => b.classList.toggle("activo", b === btn));
    $$(".vista").forEach((v) => (v.hidden = v.id !== "vista-" + btn.dataset.vista));
    if (btn.dataset.vista === "productos") cargarProductos();
  })
);

// ---------------------------------------------------------------------------
// Sonido de aviso (se activa con el primer clic en la página)
// ---------------------------------------------------------------------------
document.addEventListener("click", () => {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
});

function sonido() {
  if (!audioCtx) return;
  [880, 1175].forEach((freq, i) => {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    o.connect(g);
    g.connect(audioCtx.destination);
    const t = audioCtx.currentTime + i * 0.25;
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.start(t);
    o.stop(t + 0.4);
  });
}

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------
async function cargarPedidos() {
  try {
    const r = await fetch("/api/pedidos");
    if (r.status === 401) return (window.location = "/admin/login");
    pedidos = await r.json();
  } catch (e) {
    return; // sin conexión: reintenta en el próximo ciclo
  }

  const nuevos = pedidos.filter((p) => p.estado === "pendiente" && !conocidos.has(p.id));
  pedidos.forEach((p) => conocidos.add(p.id));
  if (nuevos.length && !primeraCarga) {
    sonido();
    document.title = `(${nuevos.length}) Nuevo pedido - ${tituloOriginal}`;
    setTimeout(() => (document.title = tituloOriginal), 6000);
  }
  primeraCarga = false;

  renderTablero();
  renderStats();
  renderHistorial();
}

function tarjetaPedido(p) {
  const items = p.items.map((i) => `<li>${i.cantidad} × ${esc(i.nombre)}</li>`).join("");
  const sig = SIGUIENTE[p.estado];
  return `
    <article class="tarjeta-pedido">
      <div class="tarjeta-cabecera">
        <strong>Pedido n.º ${p.numero}</strong>
        <span class="hora">${esc(p.fecha.slice(11, 16))}</span>
      </div>
      <p class="tarjeta-cliente">${esc(p.cliente)}</p>
      <ul class="tarjeta-items">${items}</ul>
      ${p.nota ? `<p class="tarjeta-nota">Nota: ${esc(p.nota)}</p>` : ""}
      <div class="tarjeta-pie">
        <span class="precio">${pesos(p.total)}</span>
      </div>
      <div class="tarjeta-botones">
        ${sig ? `<button class="btn btn-primario" type="button" data-estado="${sig[0]}" data-id="${p.id}">${sig[1]}</button>` : ""}
        <button class="btn btn-peligro" type="button" data-estado="cancelado" data-id="${p.id}" data-num="${p.numero}">Cancelar</button>
      </div>
    </article>`;
}

function renderTablero() {
  for (const estado of ["pendiente", "en_preparacion", "listo"]) {
    const lista = pedidos
      .filter((p) => p.estado === estado)
      .sort((a, b) => a.fecha.localeCompare(b.fecha)); // el más viejo primero
    $("#col-" + estado).innerHTML = lista.length
      ? lista.map(tarjetaPedido).join("")
      : '<p class="vacio">Sin pedidos</p>';
    $("#cuenta-" + estado).textContent = lista.length;
  }
}

function renderStats() {
  const hoy = hoyLocal();
  const deHoy = pedidos.filter((p) => p.fecha.startsWith(hoy));
  const ventas = deHoy.filter((p) => p.estado !== "cancelado").reduce((s, p) => s + p.total, 0);
  const pendientes = pedidos.filter((p) => p.estado === "pendiente").length;
  $("#st-pedidos").textContent = deHoy.length;
  $("#st-ventas").textContent = pesos(ventas);
  $("#st-pendientes").textContent = pendientes;
  const badge = $("#badge-pendientes");
  badge.textContent = pendientes;
  badge.hidden = pendientes === 0;
}

async function cambiarEstado(id, estado) {
  const r = await fetch(`/api/pedidos/${encodeURIComponent(id)}/estado`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ estado }),
  });
  if (!r.ok) alert("No se pudo cambiar el estado del pedido.");
  cargarPedidos();
}

$("#vista-pedidos").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-estado]");
  if (!btn) return;
  if (btn.dataset.estado === "cancelado" && !confirm(`¿Cancelar el pedido n.º ${btn.dataset.num}?`)) return;
  cambiarEstado(btn.dataset.id, btn.dataset.estado);
});

// ---------------------------------------------------------------------------
// Historial
// ---------------------------------------------------------------------------
function renderHistorial() {
  const filtro = $("#filtro-estado").value;
  const lista = pedidos.filter((p) => filtro === "todos" || p.estado === filtro);
  $("#tabla-historial").innerHTML = lista.length
    ? lista
        .map(
          (p) => `
      <tr>
        <td>${p.numero}</td>
        <td>${esc(p.fecha.replace("T", " "))}</td>
        <td>${esc(p.cliente)}</td>
        <td>${p.items.map((i) => `${i.cantidad} × ${esc(i.nombre)}`).join(", ")}</td>
        <td class="der">${pesos(p.total)}</td>
        <td><span class="insignia estado-${p.estado}">${ETIQUETAS[p.estado]}</span></td>
      </tr>`
        )
        .join("")
    : '<tr><td colspan="6" class="vacio">No hay pedidos con ese filtro.</td></tr>';
}
$("#filtro-estado").addEventListener("change", renderHistorial);

// ---------------------------------------------------------------------------
// Productos (alta, edición, baja)
// ---------------------------------------------------------------------------
async function cargarProductos() {
  const r = await fetch("/api/productos?todos=1");
  if (r.status === 401) return (window.location = "/admin/login");
  productos = await r.json();
  renderProductos();
}

function renderProductos() {
  $("#lista-categorias").innerHTML = [...new Set(productos.map((p) => p.categoria))]
    .map((c) => `<option value="${esc(c)}"></option>`)
    .join("");

  $("#tabla-productos").innerHTML = productos.length
    ? productos
        .map(
          (p) => `
      <tr>
        <td>${esc(p.nombre)}</td>
        <td>${esc(p.categoria)}</td>
        <td class="der">${pesos(p.precio)}</td>
        <td class="der ${p.stock <= 5 ? "stock-bajo" : ""}">${p.stock}</td>
        <td><input type="checkbox" data-visible="${p.id}" ${p.disponible ? "checked" : ""} aria-label="Visible en la tienda"></td>
        <td class="acciones">
          <button class="btn-texto" type="button" data-editar="${p.id}">Editar</button>
          <button class="btn-texto peligro" type="button" data-borrar="${p.id}">Eliminar</button>
        </td>
      </tr>`
        )
        .join("")
    : '<tr><td colspan="6" class="vacio">Todavía no cargaste productos.</td></tr>';
}

function limpiarFormulario() {
  editandoId = null;
  $("#form-producto").reset();
  $("#p-disponible").checked = true;
  $("#form-titulo").textContent = "Agregar producto";
  $("#p-guardar").textContent = "Guardar producto";
  $("#p-cancelar").hidden = true;
  mensajeProducto("");
}

function mensajeProducto(texto, esError = true) {
  const m = $("#p-mensaje");
  m.textContent = texto;
  m.className = "mensaje " + (esError ? "error" : "ok");
  m.hidden = !texto;
}

$("#form-producto").addEventListener("submit", async (e) => {
  e.preventDefault();
  const datos = {
    nombre: $("#p-nombre").value,
    categoria: $("#p-categoria").value,
    precio: $("#p-precio").value,
    stock: $("#p-stock").value,
    disponible: $("#p-disponible").checked,
  };
  const r = await fetch(editandoId ? `/api/productos/${editandoId}` : "/api/productos", {
    method: editandoId ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(datos),
  });
  const resp = await r.json();
  if (!r.ok) return mensajeProducto(resp.error || "No se pudo guardar el producto.");
  limpiarFormulario();
  mensajeProducto("Producto guardado.", false);
  setTimeout(() => mensajeProducto(""), 2500);
  cargarProductos();
});

$("#p-cancelar").addEventListener("click", limpiarFormulario);

$("#tabla-productos").addEventListener("click", async (e) => {
  const editar = e.target.closest("[data-editar]");
  const borrar = e.target.closest("[data-borrar]");
  if (editar) {
    const p = productos.find((x) => x.id === editar.dataset.editar);
    editandoId = p.id;
    $("#p-nombre").value = p.nombre;
    $("#p-categoria").value = p.categoria;
    $("#p-precio").value = p.precio;
    $("#p-stock").value = p.stock;
    $("#p-disponible").checked = p.disponible;
    $("#form-titulo").textContent = "Editar producto";
    $("#p-guardar").textContent = "Guardar cambios";
    $("#p-cancelar").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (borrar) {
    const p = productos.find((x) => x.id === borrar.dataset.borrar);
    if (!confirm(`¿Eliminar «${p.nombre}»? Esta acción no se puede deshacer.`)) return;
    await fetch(`/api/productos/${p.id}`, { method: "DELETE" });
    if (editandoId === p.id) limpiarFormulario();
    cargarProductos();
  }
});

// Casilla "Visible": actualiza el producto al instante
$("#tabla-productos").addEventListener("change", async (e) => {
  const check = e.target.closest("[data-visible]");
  if (!check) return;
  const p = productos.find((x) => x.id === check.dataset.visible);
  await fetch(`/api/productos/${p.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...p, disponible: check.checked }),
  });
  cargarProductos();
});

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
cargarPedidos();
setInterval(cargarPedidos, 3000); // "tiempo real": consulta la base de datos cada 3 s
