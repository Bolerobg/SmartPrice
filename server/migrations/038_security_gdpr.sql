-- 038: Двуфакторна защита за админа (TOTP) + право на забравяне (GDPR)
alter table profiles add column if not exists totp_secret        text;
alter table profiles add column if not exists totp_enabled       boolean not null default false;
alter table profiles add column if not exists totp_confirmed_at  timestamptz;
alter table profiles add column if not exists anonymized_at      timestamptz;
alter table profiles add column if not exists erasure_requested_at timestamptz;
comment on column profiles.totp_secret is 'База32 тайна за Google Authenticator (TOTP, RFC 6238)';
comment on column profiles.anonymized_at is 'Кога профилът е обезличен по GDPR (необратимо)';
create index if not exists idx_profiles_role_active on profiles (role) where deleted_at is null;
