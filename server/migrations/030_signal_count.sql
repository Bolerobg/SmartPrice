-- Броят независими сигнали за една и съща оферта (различни хора, същият обект и цена).
-- Когато втори/трети човек сигнализира същото нещо, не правим нова оферта, а вдигаме брояча.
alter table posts add column if not exists signal_count integer not null default 1;
comment on column posts.signal_count is 'Брой независими сигнали (Facebook групи и др.) за тази оферта';
