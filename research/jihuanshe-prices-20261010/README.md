# Jihuanshe Tracker

Aplicación local para importar órdenes de Jihuanshe desde Android mediante ADB, revisar sus cartas, calcular el coste aterrizado de cada una y gestionar inventario y ventas.

El proyecto utiliza FastAPI, SQLAlchemy y SQLite en el backend, y React con Vite en el frontend. El alcance y las decisiones técnicas están documentados en [PLAN.md](PLAN.md).

## Funcionalidad

- **Importar** órdenes de Jihuanshe por ADB (detección, scroll, recorte de imágenes).
- **Catálogo de cartas** (`Cartas`): una fila por carta única (`juego + set + número`), con nombre chino e inglés, búsqueda y ordenación. El inglés se traduce una sola vez (online) y se reutiliza.
- **Órdenes** con nombre personalizado y tipo de cambio congelado.
- **Conversión de divisas**: tipo de cambio histórico de la fecha de compra (ECB) o tasa fija configurable, con cargo real de tarjeta opcional y marca de estimado/confirmado.
- **Envíos CN→ES**: coste total en EUR + desglose por categorías (en EUR o CNY) que debe cuadrar, con seguro (prima + cobertura) y categorías propias.
- **Inventario** con lotes, división, grading y alta manual de cartas (compradas fuera de Jihuanshe) con imagen opcional.
- **Ventas** con listados, beneficio y ROI.

## Requisitos

- Python 3.12 o posterior.
- Node.js 18 o posterior.
- Android Platform Tools (`adb`).
- Un dispositivo Android con depuración USB habilitada y Jihuanshe abierto en el detalle de una orden.

## Instalación

```powershell
git clone <URL_DEL_REPOSITORIO>
cd jihuanshe_tracker
python -m pip install -e ".[dev]"
cd frontend
npm install
```

La aplicación busca `adb` en este orden: variable `JIHUANSHE_ADB`, archivo
`.env`, carpeta `platform-tools/` del proyecto y, por último, el `PATH` del
sistema. La forma más sencilla es copiar la plantilla y editar la ruta:

```powershell
Copy-Item .env.example .env
notepad .env
```

Las demás opciones disponibles también aparecen en [.env.example](.env.example).
La aplicación lee el archivo `.env` automáticamente; las variables de entorno
reales tienen prioridad sobre él.

## Ejecución

Backend, desde la raíz del proyecto:

```powershell
uvicorn app.main:app --reload
```

Frontend, en otra terminal:

```powershell
cd frontend
npm run dev
```

Abre la dirección que muestra Vite, normalmente `http://localhost:5173`.

## Pruebas y compilación

```powershell
pytest
ruff check .
cd frontend
npm run build
```

## Datos locales

La base de datos, las imágenes y los dumps XML se guardan en `data/`. Ese directorio, los archivos `.env` y los volcados del dispositivo están excluidos de Git para evitar publicar datos personales.

