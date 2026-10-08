"""
app.py - Servidor Flask del sistema de pedidos.

Ejecutar con:  python app.py
Tienda para clientes:  http://127.0.0.1:5000
Panel del negocio:     http://127.0.0.1:5000/admin
"""
import os
from functools import wraps

from flask import Flask, jsonify, redirect, render_template, request, session, url_for

from db import MODO, ErrorPedido, backend

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "cambia-esta-clave-secreta")

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
NOMBRE_NEGOCIO = os.environ.get("NOMBRE_NEGOCIO", "Kiosco Don Pepe")
ESTADOS = ("pendiente", "en_preparacion", "listo", "entregado", "cancelado")


# ---------------------------------------------------------------------------
# Protección del panel de administración
# ---------------------------------------------------------------------------
def solo_admin(f):
    @wraps(f)
    def envoltura(*args, **kwargs):
        if not session.get("admin"):
            if request.path.startswith("/api/"):
                return jsonify({"error": "No autorizado"}), 401
            return redirect(url_for("login"))
        return f(*args, **kwargs)

    return envoltura


# ---------------------------------------------------------------------------
# Páginas
# ---------------------------------------------------------------------------
@app.get("/")
def tienda():
    return render_template("cliente.html", negocio=NOMBRE_NEGOCIO)


@app.route("/admin/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        if request.form.get("password") == ADMIN_PASSWORD:
            session["admin"] = True
            return redirect(url_for("panel"))
        error = "Contraseña incorrecta. Probá de nuevo."
    return render_template("admin_login.html", negocio=NOMBRE_NEGOCIO, error=error)


@app.get("/admin/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.get("/admin")
@solo_admin
def panel():
    return render_template("admin.html", negocio=NOMBRE_NEGOCIO)


# ---------------------------------------------------------------------------
# API de productos
# ---------------------------------------------------------------------------
def limpiar_producto(d):
    """Valida los datos de un producto. Lanza ValueError si hay algo mal."""
    nombre = str(d.get("nombre", "")).strip()
    categoria = str(d.get("categoria", "")).strip() or "General"
    if not nombre or len(nombre) > 60:
        raise ValueError("El nombre es obligatorio (máximo 60 caracteres).")
    if len(categoria) > 30:
        raise ValueError("La categoría puede tener hasta 30 caracteres.")
    try:
        precio = int(round(float(d.get("precio"))))
        stock = int(d.get("stock"))
    except (TypeError, ValueError):
        raise ValueError("Precio y stock deben ser números.")
    if precio < 0 or stock < 0:
        raise ValueError("Precio y stock no pueden ser negativos.")
    return {
        "nombre": nombre,
        "categoria": categoria,
        "precio": precio,
        "stock": stock,
        "disponible": bool(d.get("disponible", True)),
    }


@app.get("/api/productos")
def api_productos():
    productos = backend.listar_productos()
    if request.args.get("todos") and session.get("admin"):
        return jsonify(productos)
    # Los clientes solo ven lo que está disponible
    return jsonify([p for p in productos if p.get("disponible", True)])


@app.post("/api/productos")
@solo_admin
def api_crear_producto():
    try:
        datos = limpiar_producto(request.get_json(silent=True) or {})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(backend.crear_producto(datos)), 201


@app.put("/api/productos/<pid>")
@solo_admin
def api_actualizar_producto(pid):
    try:
        datos = limpiar_producto(request.get_json(silent=True) or {})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    producto = backend.actualizar_producto(pid, datos)
    if not producto:
        return jsonify({"error": "Producto no encontrado."}), 404
    return jsonify(producto)


@app.delete("/api/productos/<pid>")
@solo_admin
def api_eliminar_producto(pid):
    if not backend.eliminar_producto(pid):
        return jsonify({"error": "Producto no encontrado."}), 404
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# API de pedidos
# ---------------------------------------------------------------------------
@app.post("/api/pedidos")
def api_crear_pedido():
    d = request.get_json(silent=True) or {}
    cliente = str(d.get("cliente", "")).strip()
    nota = str(d.get("nota", "")).strip()
    if not cliente or len(cliente) > 50:
        return jsonify({"error": "Escribí tu nombre (máximo 50 caracteres)."}), 400
    if len(nota) > 200:
        return jsonify({"error": "La nota puede tener hasta 200 caracteres."}), 400
    try:
        pedido = backend.crear_pedido(cliente, nota, d.get("items"))
    except ErrorPedido as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(pedido), 201


@app.get("/api/pedidos")
@solo_admin
def api_pedidos():
    return jsonify(backend.listar_pedidos())


@app.get("/api/pedidos/<pid>")
def api_pedido(pid):
    """Consulta pública (para que el cliente siga su pedido): datos limitados."""
    p = backend.obtener_pedido(pid)
    if not p:
        return jsonify({"error": "Pedido no encontrado."}), 404
    return jsonify({k: p[k] for k in ("id", "numero", "cliente", "estado", "total", "fecha")})


@app.put("/api/pedidos/<pid>/estado")
@solo_admin
def api_cambiar_estado(pid):
    estado = (request.get_json(silent=True) or {}).get("estado")
    if estado not in ESTADOS:
        return jsonify({"error": "Estado inválido."}), 400
    p = backend.cambiar_estado(pid, estado)
    if not p:
        return jsonify({"error": "Pedido no encontrado."}), 404
    return jsonify(p)


@app.errorhandler(500)
def error_interno(_e):
    return jsonify({"error": "Error interno del servidor. Revisá la terminal."}), 500


if __name__ == "__main__":
    # Con el recargador de Flask el programa arranca dos veces; imprimimos una sola
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        print(f"\n  Datos:  {MODO}")
        print("  Tienda: http://127.0.0.1:5000")
        print("  Panel:  http://127.0.0.1:5000/admin\n")

    app.run(host='0.0.0.0', port=5000, debug=True)