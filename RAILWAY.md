# Despliegue seguro en Railway

CellHouse se publicará como un proyecto independiente de DitaPOS. Su proyecto
de Railway tendrá una base de datos PostgreSQL propia; nunca compartirá la base
ni las variables de DitaPOS.

## Regla para actualizar

1. Los cambios se desarrollan en una rama y se verifican antes de fusionarse a
   `main`.
2. Las migraciones de base de datos son aditivas: crean tablas o columnas sin
   borrar datos existentes.
3. Railway ejecuta las migraciones antes de cambiar la versión publicada. Si una
   migración falla, la versión anterior sigue siendo la activa.
4. Cada despliegue se hará desde este repositorio privado y quedará registrado
   en GitHub y Railway.

## Estado de la migración

La etiqueta `cloudflare-baseline-2026-09-04` conserva la versión que hoy está
publicada en Sites. La rama `codex/railway-postgres` se utiliza para preparar
la migración a PostgreSQL sin modificar esa versión ni DitaPOS.

Antes de habilitar Railway se deben persistir en PostgreSQL productos, ventas,
líneas de venta, caja, usuarios y notificaciones. No se debe publicar una
versión que conserve ventas o inventario solo en memoria del navegador.
