"""
db.py - Capa de datos del sistema de pedidos.

- Si existe el archivo "serviceAccountKey.json" -> usa Firebase (Firestore).
- Si NO existe -> usa un archivo local "datos_local.json" (para probar sin Firebase).

El resto del programa (app.py) usa siempre las mismas funciones,
sin importar cuál de los dos modos esté activo.
"""
import json
import os
import threading
import uuid
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
KEY_PATH = os.path.join(BASE, "serviceAccountKey.json")
LOCAL_PATH = os.path.join(BASE, "datos_local.json")

PRODUCTOS_INICIALES = [
    {"nombre": "Alfajor triple", "precio": 1200, "categoria": "Golosinas", "stock": 40, "disponible": True},
    {"nombre": "Chocolate con leche", "precio": 1800, "categoria": "Golosinas", "stock": 25, "disponible": True},
    {"nombre": "Caramelos surtidos (x10)", "precio": 500, "categoria": "Golosinas", "stock": 60, "disponible": True},
    {"nombre": "Gaseosa 500 ml", "precio": 1500, "categoria": "Bebidas", "stock": 30, "disponible": True},
    {"nombre": "Agua mineral 500 ml", "precio": 1000, "categoria": "Bebidas", "stock": 30, "disponible": True},
    {"nombre": "Jugo en caja", "precio": 900, "categoria": "Bebidas", "stock": 20, "disponible": True},
    {"nombre": "Papas fritas", "precio": 1600, "categoria": "Snacks", "stock": 18, "disponible": True},
    {"nombre": "Palitos salados", "precio": 1100, "categoria": "Snacks", "stock": 18, "disponible": True},
    {"nombre": "Sándwich de miga (x3)", "precio": 2500, "categoria": "Comidas", "stock": 12, "disponible": True},
    {"nombre": "Tostado de jamón y queso", "precio": 3200, "categoria": "Comidas", "stock": 10, "disponible": True},
    {"nombre": "Café", "precio": 1300, "categoria": "Calientes", "stock": 50, "disponible": True},
    {"nombre": "Medialuna", "precio": 700, "categoria": "Calientes", "stock": 24, "disponible": True},
]


class ErrorPedido(Exception):
    """Error de validación al crear un pedido (se muestra al cliente)."""


def ahora():
    return datetime.now().isoformat(timespec="seconds")


def armar_pedido(productos, cliente, nota, items_in):
    """
    Valida el pedido y calcula el total usando los PRECIOS DEL SERVIDOR
    (nunca confiamos en los precios que manda el navegador).
    Devuelve (pedido, descuentos) donde descuentos = {id_producto: cantidad}.
    """
    if not isinstance(items_in, list) or not items_in:
        raise ErrorPedido("El pedido está vacío.")

    items = []
    descuentos = {}
    total = 0
    for it in items_in:
        if not isinstance(it, dict):
            raise ErrorPedido("Pedido inválido.")
        pid = str(it.get("id", ""))
        try:
            cantidad = int(it.get("cantidad", 0))
        except (TypeError, ValueError):
            raise ErrorPedido("Cantidad inválida.")
        if cantidad < 1 or cantidad > 50:
            raise ErrorPedido("La cantidad debe estar entre 1 y 50.")

        prod = productos.get(pid)
        if not prod or not prod.get("disponible", True):
            raise ErrorPedido("Uno de los productos ya no está disponible. Actualizá la página.")

        descuentos[pid] = descuentos.get(pid, 0) + cantidad
        if descuentos[pid] > int(prod.get("stock", 0)):
            raise ErrorPedido(f"No hay stock suficiente de «{prod['nombre']}».")

        items.append({
            "id": pid,
            "nombre": prod["nombre"],
            "precio": prod["precio"],
            "cantidad": cantidad,
        })
        total += prod["precio"] * cantidad

    pedido = {
        "cliente": cliente,
        "nota": nota,
        "items": items,
        "total": total,
        "estado": "pendiente",
        "fecha": ahora(),
    }
    return pedido, descuentos


# ---------------------------------------------------------------------------
# MODO LOCAL (archivo JSON)
# ---------------------------------------------------------------------------
class LocalDB:
    nombre = "Local (archivo datos_local.json)"

    def __init__(self, ruta=LOCAL_PATH):
        self.ruta = ruta
        self.lock = threading.RLock()
        if not os.path.exists(self.ruta):
            self._guardar({"productos": [], "pedidos": [], "contador": 0})

    def _cargar(self):
        with open(self.ruta, "r", encoding="utf-8") as f:
            return json.load(f)

    def _guardar(self, datos):
        with open(self.ruta, "w", encoding="utf-8") as f:
            json.dump(datos, f, ensure_ascii=False, indent=2)

    # --- productos ---
    def listar_productos(self):
        with self.lock:
            productos = self._cargar()["productos"]
        return sorted(productos, key=lambda p: (p["categoria"].lower(), p["nombre"].lower()))

    def crear_producto(self, datos):
        with self.lock:
            db = self._cargar()
            producto = {**datos, "id": uuid.uuid4().hex[:8]}
            db["productos"].append(producto)
            self._guardar(db)
        return producto

    def actualizar_producto(self, pid, datos):
        with self.lock:
            db = self._cargar()
            for p in db["productos"]:
                if p["id"] == pid:
                    p.update(datos)
                    self._guardar(db)
                    return p
        return None

    def eliminar_producto(self, pid):
        with self.lock:
            db = self._cargar()
            antes = len(db["productos"])
            db["productos"] = [p for p in db["productos"] if p["id"] != pid]
            self._guardar(db)
            return len(db["productos"]) < antes

    # --- pedidos ---
    def crear_pedido(self, cliente, nota, items):
        with self.lock:
            db = self._cargar()
            productos = {p["id"]: p for p in db["productos"]}
            pedido, descuentos = armar_pedido(productos, cliente, nota, items)
            for pid, cant in descuentos.items():
                productos[pid]["stock"] -= cant
            db["contador"] += 1
            pedido["numero"] = db["contador"]
            pedido["id"] = uuid.uuid4().hex[:10]
            db["pedidos"].append(pedido)
            self._guardar(db)
        return pedido

    def listar_pedidos(self):
        with self.lock:
            pedidos = self._cargar()["pedidos"]
        return sorted(pedidos, key=lambda p: p["fecha"], reverse=True)[:300]

    def obtener_pedido(self, pid):
        with self.lock:
            for p in self._cargar()["pedidos"]:
                if p["id"] == pid:
                    return p
        return None

    def cambiar_estado(self, pid, estado):
        with self.lock:
            db = self._cargar()
            for p in db["pedidos"]:
                if p["id"] == pid:
                    p["estado"] = estado
                    p["actualizado"] = ahora()
                    self._guardar(db)
                    return p
        return None


# ---------------------------------------------------------------------------
# MODO FIREBASE (Firestore)
# ---------------------------------------------------------------------------
class FirebaseDB:
    nombre = "Firebase (Firestore)"

    def __init__(self):
        import firebase_admin
        from firebase_admin import credentials, firestore

        self._firestore = firestore
        if not firebase_admin._apps:
            firebase_admin.initialize_app(credentials.Certificate(KEY_PATH))
        self.db = firestore.client()

    # --- productos ---
    def listar_productos(self):
        docs = self.db.collection("productos").stream()
        productos = [{**d.to_dict(), "id": d.id} for d in docs]
        return sorted(productos, key=lambda p: (p["categoria"].lower(), p["nombre"].lower()))

    def crear_producto(self, datos):
        ref = self.db.collection("productos").document()
        ref.set(datos)
        return {**datos, "id": ref.id}

    def actualizar_producto(self, pid, datos):
        ref = self.db.collection("productos").document(pid)
        if not ref.get().exists:
            return None
        ref.update(datos)
        return {**ref.get().to_dict(), "id": pid}

    def eliminar_producto(self, pid):
        ref = self.db.collection("productos").document(pid)
        if not ref.get().exists:
            return False
        ref.delete()
        return True

    # --- pedidos ---
    def crear_pedido(self, cliente, nota, items):
        productos = {p["id"]: p for p in self.listar_productos()}
        pedido, descuentos = armar_pedido(productos, cliente, nota, items)

        # Número de pedido correlativo (1, 2, 3...)
        contador = self.db.collection("meta").document("contador")
        contador.set({"valor": self._firestore.Increment(1)}, merge=True)
        pedido["numero"] = contador.get().to_dict()["valor"]

        ref = self.db.collection("pedidos").document()
        lote = self.db.batch()
        lote.set(ref, pedido)
        for pid, cant in descuentos.items():
            lote.update(
                self.db.collection("productos").document(pid),
                {"stock": self._firestore.Increment(-cant)},
            )
        lote.commit()
        return {**pedido, "id": ref.id}

    def listar_pedidos(self):
        consulta = (
            self.db.collection("pedidos")
            .order_by("fecha", direction=self._firestore.Query.DESCENDING)
            .limit(300)
        )
        return [{**d.to_dict(), "id": d.id} for d in consulta.stream()]

    def obtener_pedido(self, pid):
        doc = self.db.collection("pedidos").document(pid).get()
        return {**doc.to_dict(), "id": doc.id} if doc.exists else None

    def cambiar_estado(self, pid, estado):
        ref = self.db.collection("pedidos").document(pid)
        if not ref.get().exists:
            return None
        ref.update({"estado": estado, "actualizado": ahora()})
        return {**ref.get().to_dict(), "id": pid}


# ---------------------------------------------------------------------------
# Selección automática del modo
# ---------------------------------------------------------------------------
if os.path.exists(KEY_PATH):
    backend = FirebaseDB()
else:
    backend = LocalDB()

MODO = backend.nombre

# Si no hay productos, cargamos unos de ejemplo para que el menú no quede vacío
if not backend.listar_productos():
    for _p in PRODUCTOS_INICIALES:
        backend.crear_producto(dict(_p))
