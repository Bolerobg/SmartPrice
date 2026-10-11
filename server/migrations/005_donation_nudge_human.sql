-- ============================================================================
-- 005 — По-човешко подсещане за дарение
--
-- Проблемът преди: подсещането идваше след 3 действия и с пауза само 90
-- секунди (плюс таймер в приложението на всеки 35 с). Това е досадно и
-- подтиква потребителя да откаже.
--
-- Какво правим:
--   1. Добавяме saved_milestone_step — кой „спестен“ праг вече сме отбелязали.
--      Така подсещаме СМИСЛЕНО: „спести 50 € благодарение на общността —
--      помогни да расте“.
--   2. Връщаме прага на 8 действия и пауза от 3 дни (виж community.ts).
-- ============================================================================

alter table profiles
  add column if not exists saved_milestone_step int not null default 0;

comment on column profiles.saved_milestone_step is
  'Кой праг на спестени пари вече сме отбелязали (0 = още нищо). '
  'Използва се, за да не подсещаме повторно за същия праг.';

-- Ограничение: не може да е отрицателно
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_saved_milestone_step_range'
  ) then
    alter table profiles
      add constraint profiles_saved_milestone_step_range
      check (saved_milestone_step between 0 and 20);
  end if;
end $$;