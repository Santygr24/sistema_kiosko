// cliente.js - Lógica de la tienda (menú, carrito, envío y seguimiento)

const MENSAJES_ESTADO = {
  pendiente: "Recibimos tu pedido. En un momento empezamos a prepararlo.",
  en_preparacion: "Estamos preparando tu pedido.",
  listo: "¡Tu pedido está listo! Pasá a retirarlo.",
  entregado: "Pedido entregado. ¡Gracias por tu compra!",
  cancelado: "El negocio canceló este pedido. Consultá en el local.",
};
const PASOS = [
  ["pendiente", "Recibido"],
  ["en_preparacion", "Preparando"],
  ["listo", "Listo"],
  ["entregado", "Entregado"],
];

const $ = (sel) => document.querySelector(sel);
const pesos = (n) => "$" + Number(n).toLocaleString("es-AR");

function esc(texto) {
  const d = document.createElement("div");
  d.textContent = texto;
  return d.innerHTML;
}

let productos = [];
let carrito = {}; // { idProducto: cantidad }
let categoriaActual = "Todas";
let timerSeguimiento = null;

// ---------------------------------------------------------------------------
// Menú
// ---------------------------------------------------------------------------
async function cargarProductos() {
  try {
    const r = await fetch("/api/productos");
    productos = await r.json();
    // Si algo del carrito ya no existe o bajó el stock, lo ajustamos
    for (const id of Object.keys(carrito)) {
      const p = productos.find((x) => x.id === id);
      if (!p || p.stock < 1) delete carrito[id];
      else if (carrito[id] > p.stock) carrito[id] = p.stock;
    }
    renderCategorias();
    renderProductos();
    renderCarrito();
  } catch (e) {
    $("#productos").innerHTML = '<p class="vacio">No se pudo cargar el menú. Revisá que el servidor esté activo.</p>';
  }
}

function renderCategorias() {
  const cats = ["Todas", ...new Set(productos.map((p) => p.categoria))];
  if (!cats.includes(categoriaActual)) categoriaActual = "Todas";
  $("#categorias").innerHTML = cats
    .map(
      (c) =>
        `<button type="button" class="chip ${c === categoriaActual ? "activo" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`
    )
    .join("");
}

function renderProductos() {
  const texto = $("#buscador").value.trim().toLowerCase();
  const lista = productos.filter(
    (p) =>
      (categoriaActual === "Todas" || p.categoria === categoriaActual) &&
      p.nombre.toLowerCase().includes(texto)
  );
  if (!lista.length) {
    $("#productos").innerHTML = '<p class="vacio">No encontramos productos con ese filtro.</p>';
    return;
  }
  $("#productos").innerHTML = lista
    .map((p) => {
      const enCarrito = carrito[p.id] || 0;
      const sinStock = p.stock < 1;
      const alLimite = !sinStock && enCarrito >= p.stock;
      const aviso = sinStock ? "Sin stock" : p.stock <= 5 ? `Quedan ${p.stock}` : "";
      return `
        <article class="producto ${sinStock ? "agotado" : ""}">
          <div>
            <h3>${esc(p.nombre)}</h3>
            <p class="categoria">${esc(p.categoria)}</p>
          </div>
          <div class="producto-pie">
            <span class="precio">${pesos(p.precio)}</span>
            <button type="button" class="btn btn-secundario" data-agregar="${p.id}" ${sinStock || alLimite ? "disabled" : ""}>
              ${sinStock ? "Sin stock" : alLimite ? "Máximo" : "Agregar"}
            </button>
          </div>
          ${aviso && !sinStock ? `<p class="aviso">${aviso}</p>` : ""}
        </article>`;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Carrito
// ---------------------------------------------------------------------------
function totalCarrito() {
  return Object.entries(carrito).reduce((suma, [id, cant]) => {
    const p = productos.find((x) => x.id === id);
    return suma + (p ? p.precio * cant : 0);
  }, 0);
}

function renderCarrito() {
  const ids = Object.keys(carrito);
  $("#carrito-vacio").hidden = ids.length > 0;
  $("#carrito-lista").innerHTML = ids
    .map((id) => {
      const p = productos.find((x) => x.id === id);
      if (!p) return "";
      return `
        <li class="carrito-fila">
          <div class="carrito-info">
            <span class="carrito-nombre">${esc(p.nombre)}</span>
            <span class="carrito-sub">${pesos(p.precio * carrito[id])}</span>
          </div>
          <div class="cantidad">
            <button type="button" aria-label="Quitar uno" data-menos="${id}">−</button>
            <span>${carrito[id]}</span>
            <button type="button" aria-label="Agregar uno" data-mas="${id}">+</button>
          </div>
        </li>`;
    })
    .join("");
  $("#carrito-total").textContent = pesos(totalCarrito());
}

function cambiarCantidad(id, delta) {
  const p = productos.find((x) => x.id === id);
  if (!p) return;
  const nueva = (carrito[id] || 0) + delta;
  if (nueva <= 0) delete carrito[id];
  else if (nueva <= p.stock) carrito[id] = nueva;
  renderProductos();
  renderCarrito();
}

function mostrarMensaje(texto, esError = true) {
  const m = $("#mensaje");
  m.textContent = texto;
  m.className = "mensaje " + (esError ? "error" : "ok");
  m.hidden = !texto;
}

async function enviarPedido() {
  const cliente = $("#cliente").value.trim();
  const nota = $("#nota").value.trim();
  const items = Object.entries(carrito).map(([id, cantidad]) => ({ id, cantidad }));

  if (!items.length) return mostrarMensaje("Agregá al menos un producto al pedido.");
  if (!cliente) return mostrarMensaje("Escribí tu nombre para saber de quién es el pedido.");

  const btn = $("#btn-enviar");
  btn.disabled = true;
  btn.textContent = "Enviando...";
  try {
    const r = await fetch("/api/pedidos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cliente, nota, items }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "No se pudo enviar el pedido.");

    localStorage.setItem("pedidoId", data.id);
    carrito = {};
    $("#nota").value = "";
    mostrarMensaje("");
    await cargarProductos();
    iniciarSeguimiento();
  } catch (e) {
    mostrarMensaje(e.message);
    cargarProductos();
  } finally {
    btn.disabled = false;
    btn.textContent = "Enviar pedido";
  }
}

// ---------------------------------------------------------------------------
// Seguimiento del pedido (se actualiza solo cada 3 segundos)
// ---------------------------------------------------------------------------
function iniciarSeguimiento() {
  clearInterval(timerSeguimiento);
  if (!localStorage.getItem("pedidoId")) return;
  consultarPedido();
  timerSeguimiento = setInterval(consultarPedido, 3000);
}

function cerrarSeguimiento() {
  clearInterval(timerSeguimiento);
  localStorage.removeItem("pedidoId");
  $("#seguimiento").hidden = true;
}

async function consultarPedido() {
  const id = localStorage.getItem("pedidoId");
  if (!id) return;
  try {
    const r = await fetch("/api/pedidos/" + encodeURIComponent(id));
    if (!r.ok) return cerrarSeguimiento();
    renderSeguimiento(await r.json());
  } catch (e) {
    /* sin conexión: reintenta en el próximo ciclo */
  }
}

function renderSeguimiento(p) {
  $("#seguimiento").hidden = false;
  $("#seguimiento").dataset.estado = p.estado;
  $("#seg-titulo").textContent = `Pedido n.º ${p.numero} · ${p.cliente}`;
  $("#seg-mensaje").textContent = `${MENSAJES_ESTADO[p.estado] || ""} Total: ${pesos(p.total)}`;

  const actual = PASOS.findIndex(([clave]) => clave === p.estado);
  $("#seg-pasos").innerHTML =
    p.estado === "cancelado"
      ? ""
      : PASOS.map(
          ([, nombre], i) =>
            `<li class="${i < actual ? "hecho" : i === actual ? "actual" : ""}">${nombre}</li>`
        ).join("");

  if (p.estado === "entregado" || p.estado === "cancelado") clearInterval(timerSeguimiento);
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------
document.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-cat]");
  if (chip) {
    categoriaActual = chip.dataset.cat;
    renderCategorias();
    return renderProductos();
  }
  const agregar = e.target.closest("[data-agregar]");
  if (agregar) return cambiarCantidad(agregar.dataset.agregar, 1);
  const mas = e.target.closest("[data-mas]");
  if (mas) return cambiarCantidad(mas.dataset.mas, 1);
  const menos = e.target.closest("[data-menos]");
  if (menos) return cambiarCantidad(menos.dataset.menos, -1);
});

$("#buscador").addEventListener("input", renderProductos);
$("#btn-enviar").addEventListener("click", enviarPedido);
$("#seg-cerrar").addEventListener("click", cerrarSeguimiento);

cargarProductos();
iniciarSeguimiento();
setInterval(cargarProductos, 15000); // refresca stock y precios
