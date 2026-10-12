-- ============================================================================
-- 009_upload_storage.sql
--
-- Снимките може да живеят на две места: на диска на сървъра (както досега)
-- или в S3-съвместимо хранилище (Cloudflare R2). За да знаем откъде да
-- прочетем даден файл (например OCR-ът трябва да го изтегли), пазим къде
-- е качен.
--
-- Старите редове остават 'local' — точно каквото са.
-- ============================================================================

alter table uploads
  add column if not exists storage text not null default 'local';

alter table uploads
  drop constraint if exists uploads_storage_check;

alter table uploads
  add constraint uploads_storage_check check (storage in ('local', 's3'));

comment on column uploads.storage is
  'Къде е файлът: local (диск на сървъра) или s3 (R2/S3-съвместимо хранилище).';

-- Полезно при прехвърляне: бързо се вижда колко файла още са на диска.
create index if not exists idx_uploads_storage on uploads (storage, created_at desc);
