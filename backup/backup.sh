#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BUCKET:?BUCKET is required}"
: "${ENDPOINT:?ENDPOINT is required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
FILE="ditaessencepos-${STAMP}.dump"

echo "Creating encrypted-transport PostgreSQL backup ${FILE}..."
pg_dump "$DATABASE_URL" --format=custom --compress=9 --no-owner --no-acl --file="/tmp/${FILE}"

echo "Validating the generated backup before upload..."
pg_restore --list "/tmp/${FILE}" >/dev/null

echo "Uploading backup to private object storage..."
aws s3 cp "/tmp/${FILE}" "s3://${BUCKET}/${FILE}" --endpoint-url "$ENDPOINT" --only-show-errors

echo "Keeping the 35 newest automatic backups..."
OLD_KEYS="$(aws s3api list-objects-v2 --bucket "$BUCKET" --endpoint-url "$ENDPOINT" --query 'reverse(sort_by(Contents,&LastModified))[35:].Key' --output text 2>/dev/null || true)"
for KEY in $OLD_KEYS; do
  [ "$KEY" = "None" ] || aws s3 rm "s3://${BUCKET}/${KEY}" --endpoint-url "$ENDPOINT" --only-show-errors
done

rm -f "/tmp/${FILE}"
echo "Backup completed successfully."
