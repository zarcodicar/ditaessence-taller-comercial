# Actualización segura a la versión original

Estado: **preparada, no ejecutada**.

## Origen y destino

- Origen validado: `codex/discounts-test`, commit `ce3f319`.
- Destino previsto: la rama publicada de la versión original (`github/main`).
- Esta preparación **no incluye ni copia** datos de prueba: ventas, caja, inventario, clientes, usuarios, órdenes ni liquidaciones.

## Funciones que se trasladarán

- Órdenes de servicio: recepción, abonos, proceso técnico, entrega, comprobantes y fotos.
- Flujo de técnicos: comisión personalizada, liquidación pagada al crearla e historial inalterable.
- Caja actualizada por los cobros y pagos de taller.
- Reportes de taller, ventas de mercancía y comisiones por técnico.
- Edición de categorías, navegación reorganizada y marca CellHouse.
- Código corto numérico de órdenes y sugerencias de marca/modelo según registros previos.

## Protección de datos

La actualización solo despliega código. Las migraciones son aditivas y crean tablas, índices o columnas cuando faltan; no importan información desde la prueba ni reinician tablas existentes.

Antes de publicar se hará un respaldo verificable de la base original y se comprobará el total de: productos, ventas, movimientos de caja, clientes/usuarios, órdenes y liquidaciones. Los mismos totales se revisarán inmediatamente después del despliegue.

## Punto de control obligatorio

La función de códigos simples transforma los códigos históricos de órdenes de servicio a números (`001`, `002`, ...), conservando las órdenes y sus relaciones. Esto no borra información, pero **sí cambia el texto visible del código**. Antes de activar la actualización se debe confirmar que se desea ese cambio también para órdenes antiguas; si no, se excluye esa migración de la publicación.

## Orden de ejecución cuando se autorice

1. Confirmar que no haya una operación crítica en curso y hacer respaldo de la base original.
2. Registrar los conteos y saldos previos para comparar después.
3. Crear una etiqueta de respaldo del código publicado y preparar la rama de lanzamiento desde `github/main`.
4. Fusionar únicamente los commits funcionales aprobados desde `codex/discounts-test`; no se incluirán los archivos locales, respaldos `.tar.gz` ni datos de prueba.
5. Compilar y ejecutar la prueba de taller en el paquete final.
6. Desplegar y esperar la verificación saludable.
7. Comprobar inicio de sesión, inventario, una venta histórica, caja, reportes y una orden existente sin editarla.
8. Registrar el resultado y conservar el respaldo para reversión.

## Validación realizada en la versión de prueba

- `pnpm run build` — correcto.
- `node tests/workshop-flow.mjs` con base aislada — correcto.

No ejecutar esta guía ni fusionar a `github/main` hasta que el dueño autorice explícitamente la actualización.
