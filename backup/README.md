# Respaldo automático de DitaEssencePos

Este servicio ejecuta `pg_dump`, guarda la copia en un bucket S3 privado y conserva las 35 copias más recientes.

Variables requeridas: `DATABASE_URL`, `BUCKET`, `ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` y `AWS_DEFAULT_REGION`.

En Railway se configura como trabajo cron diario con `0 8 * * *` (03:00 en Colombia/México central durante UTC-5).
